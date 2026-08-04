import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AibaError } from "./errors.js";
import { inspectProject } from "./inspect.js";
import {
  loadCapabilitySolution,
  loadProjectLock,
  loadProjectManifest,
} from "./loaders.js";
import { validateCapabilityPlan } from "./add.js";
import { checkSolution, resolveSolution } from "./solution.js";
import { verifyProject, type VerificationIssue } from "./verify.js";

export type SolutionWorkflowPhase =
  | "ready-to-prepare"
  | "awaiting-agent"
  | "complete";

export interface SolutionWorkflowStatus {
  scope: "solution-workflow";
  phase: SolutionWorkflowPhase;
  solution: { id: string; version: string; title: string };
  progress: { completed: number; total: number };
  installationOrder: string[];
  currentCapability?: { id: string; version: string; index: number };
  remainingCapabilities: string[];
  planPath?: string;
  nextAction: {
    command: "continue" | "continue-finalize" | "none";
    reason: string;
  };
}

export interface SolutionStatusOptions {
  solutionId: string;
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function solutionStatus(
  options: SolutionStatusOptions,
): Promise<SolutionWorkflowStatus> {
  const root = resolve(options.projectRoot);
  const packs = resolve(options.packsDirectory);
  const solutions = resolve(options.solutionsDirectory);
  const solution = await loadCapabilitySolution(solutions, options.solutionId);
  const resolvedCapabilities = await resolveSolution(solution, packs);
  const project = await loadProjectManifest(root);
  const installed = new Map(project.capabilities.map((item) => [item.id, item.version]));
  const installationOrder = resolvedCapabilities.map(({ entry }) => entry.id);

  for (const { entry } of resolvedCapabilities) {
    const installedVersion = installed.get(entry.id);
    if (installedVersion === undefined) continue;
    if (installedVersion !== entry.version) {
      throw new AibaError(
        `Project installs ${entry.id}@${installedVersion}, solution requires ${entry.version}`,
        "SOLUTION_PROJECT_VERSION_MISMATCH",
      );
    }
    const verification = await verifyProject({
      projectRoot: root,
      packsDirectory: packs,
      capabilityId: entry.id,
    });
    if (!verification.ok) {
      throw new AibaError(
        `Installed Solution capability ${entry.id} is invalid: ${verification.issues.map((item) => item.code).join(", ")}`,
        "SOLUTION_INSTALLED_CAPABILITY_INVALID",
      );
    }
  }

  const missing = resolvedCapabilities.filter(({ entry }) => !installed.has(entry.id));
  const total = resolvedCapabilities.length;
  if (missing.length === 0) {
    const verification = await checkSolution({
      solutionId: options.solutionId,
      projectRoot: root,
      packsDirectory: packs,
      solutionsDirectory: solutions,
    });
    if (!verification.ok) {
      throw new AibaError("Installed Solution failed final verification", "INSTALLED_SOLUTION_INVALID");
    }
    return {
      scope: "solution-workflow",
      phase: "complete",
      solution: { id: solution.metadata.id, version: solution.metadata.version, title: solution.metadata.title },
      progress: { completed: total, total },
      installationOrder,
      remainingCapabilities: [],
      nextAction: { command: "none", reason: "All constituents pass evidence and provenance verification." },
    };
  }

  const next = missing[0]!;
  const index = resolvedCapabilities.findIndex(({ entry }) => entry.id === next.entry.id) + 1;
  const planPath = `.aiba/plans/${next.entry.id}.yaml`;
  const base = {
    scope: "solution-workflow" as const,
    solution: { id: solution.metadata.id, version: solution.metadata.version, title: solution.metadata.title },
    progress: { completed: total - missing.length, total },
    installationOrder,
    currentCapability: { id: next.entry.id, version: next.entry.version, index },
    remainingCapabilities: missing.map(({ entry }) => entry.id),
  };
  if (await exists(join(root, planPath))) {
    const validated = await validateCapabilityPlan({
      projectRoot: root,
      packsDirectory: packs,
      capabilityId: next.entry.id,
    });
    return {
      ...base,
      phase: "awaiting-agent",
      planPath: validated.planPath,
      nextAction: {
        command: "continue-finalize",
        reason: "An exact validated plan is waiting for implementation evidence and explicit finalization.",
      },
    };
  }
  return {
    ...base,
    phase: "ready-to-prepare",
    nextAction: {
      command: "continue",
      reason: "The next dependency is verified and no pending plan exists.",
    },
  };
}

export interface DoctorCheck {
  id: string;
  status: "pass" | "warning" | "fail";
  message: string;
  issues?: VerificationIssue[];
}

export interface DoctorReport {
  ok: boolean;
  scope: "project-doctor";
  root: string;
  checks: DoctorCheck[];
  summary: { passed: number; warnings: number; failed: number };
}

export async function doctorProject(options: {
  projectRoot: string;
  packsDirectory: string;
}): Promise<DoctorReport> {
  const root = resolve(options.projectRoot);
  const checks: DoctorCheck[] = [];
  const inspection = await inspectProject(root);
  checks.push({
    id: "project-inspection",
    status: inspection.truncated ? "warning" : "pass",
    message: inspection.truncated
      ? `Inspection reached its file limit after ${inspection.filesScanned} files.`
      : `Inspected ${inspection.filesScanned} files; detected ${inspection.languages.map((item) => item.name).join(", ") || "no source language"}.`,
  });
  if (!inspection.aiba.initialized) {
    checks.push({ id: "aiba-state", status: "fail", message: "Project is not initialized; run aiba init." });
  } else {
    try {
      const [manifest, lock] = await Promise.all([loadProjectManifest(root), loadProjectLock(root)]);
      checks.push({
        id: "aiba-state",
        status: "pass",
        message: `Loaded ${manifest.capabilities.length} installed capabilities and ${lock.capabilities.length} lock entries.`,
      });
      const report = await verifyProject({ projectRoot: root, packsDirectory: resolve(options.packsDirectory) });
      checks.push({
        id: "evidence-provenance",
        status: report.ok ? "pass" : "fail",
        message: report.ok
          ? `Verified ${report.verifiedCapabilities.length} capability receipts.`
          : `${report.issues.length} evidence or provenance issues require repair.`,
        ...(!report.ok ? { issues: report.issues } : {}),
      });
      const plansDirectory = join(root, ".aiba", "plans");
      const plans = await readdir(plansDirectory, { withFileTypes: true }).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      const installed = new Set(manifest.capabilities.map((item) => item.id));
      const pending = plans.filter((entry) =>
        entry.isFile()
        && entry.name.endsWith(".yaml")
        && !entry.name.endsWith(".upgrade.yaml")
        && !installed.has(entry.name.slice(0, -".yaml".length)),
      );
      checks.push({
        id: "pending-plans",
        status: pending.length > 0 ? "warning" : "pass",
        message: pending.length > 0
          ? `${pending.length} plan files exist; use aiba status <solution> to identify the active step.`
          : "No pending operation plans.",
      });
    } catch (error) {
      checks.push({
        id: "aiba-state",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const summary = {
    passed: checks.filter((item) => item.status === "pass").length,
    warnings: checks.filter((item) => item.status === "warning").length,
    failed: checks.filter((item) => item.status === "fail").length,
  };
  return { ok: summary.failed === 0, scope: "project-doctor", root, checks, summary };
}
