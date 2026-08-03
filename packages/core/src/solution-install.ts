import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AibaError } from "./errors.js";
import {
  finalizeCapability,
  prepareCapability,
  validateCapabilityPlan,
  type FinalizeCapabilityResult,
} from "./add.js";
import { loadCapabilitySolution, loadProjectManifest } from "./loaders.js";
import {
  checkSolution,
  resolveSolution,
  type SolutionCheckReport,
} from "./solution.js";
import { verifyProject } from "./verify.js";

export type SolutionInstallStatus =
  | "prepared"
  | "awaiting-finalization"
  | "finalized"
  | "evidence-verified";

export interface AdvanceSolutionInstallationOptions {
  solutionId: string;
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
  mode?: "prepare" | "finalize";
  recipeId?: string;
  agent?: string;
  now?: () => Date;
}

export interface SolutionInstallResult {
  status: SolutionInstallStatus;
  solution: {
    id: string;
    version: string;
    title: string;
  };
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
  progress: {
    completed: number;
    total: number;
  };
  installationOrder: string[];
  currentCapability?: {
    id: string;
    version: string;
    index: number;
  };
  remainingCapabilities: string[];
  planPath?: string;
  finalization?: FinalizeCapabilityResult;
  verification?: SolutionCheckReport;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return false;
    throw error;
  }
}

export async function advanceSolutionInstallation(
  options: AdvanceSolutionInstallationOptions,
): Promise<SolutionInstallResult> {
  const projectRoot = resolve(options.projectRoot);
  const packsDirectory = resolve(options.packsDirectory);
  const solutionsDirectory = resolve(options.solutionsDirectory);
  const solution = await loadCapabilitySolution(solutionsDirectory, options.solutionId);
  const resolvedCapabilities = await resolveSolution(solution, packsDirectory);
  const project = await loadProjectManifest(projectRoot);
  const installed = new Map(project.capabilities.map((item) => [item.id, item.version]));
  const installationOrder = resolvedCapabilities.map(({ entry }) => entry.id);
  const total = resolvedCapabilities.length;

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
      projectRoot,
      packsDirectory,
      capabilityId: entry.id,
    });
    if (!verification.ok) {
      throw new AibaError(
        `Installed solution capability ${entry.id}@${entry.version} failed verification: ${verification.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
        "SOLUTION_INSTALLED_CAPABILITY_INVALID",
      );
    }
  }

  const missingIndex = resolvedCapabilities.findIndex(({ entry }) => !installed.has(entry.id));
  const base = {
    solution: {
      id: solution.metadata.id,
      version: solution.metadata.version,
      title: solution.metadata.title,
    },
    projectRoot,
    packsDirectory,
    solutionsDirectory,
    installationOrder,
  };

  if (missingIndex === -1) {
    const verification = await checkSolution({
      solutionId: options.solutionId,
      projectRoot,
      packsDirectory,
      solutionsDirectory,
    });
    if (!verification.ok) {
      throw new AibaError(
        "Installed solution failed final verification",
        "INSTALLED_SOLUTION_INVALID",
      );
    }
    return {
      status: "evidence-verified",
      ...base,
      progress: { completed: total, total },
      remainingCapabilities: [],
      verification,
    };
  }

  const current = resolvedCapabilities[missingIndex];
  if (!current) {
    throw new AibaError("Cannot resolve the next solution capability", "SOLUTION_STATE_INVALID");
  }
  const currentCapability = {
    id: current.entry.id,
    version: current.entry.version,
    index: missingIndex + 1,
  };
  const remainingBeforeAction = resolvedCapabilities
    .filter(({ entry }) => !installed.has(entry.id))
    .map(({ entry }) => entry.id);
  const completedBeforeAction = total - remainingBeforeAction.length;

  if ((options.mode ?? "prepare") === "prepare") {
    const expectedPlanPath = join(
      projectRoot,
      ".aiba",
      "plans",
      `${current.entry.id}.yaml`,
    );
    if (await pathExists(expectedPlanPath)) {
      const existing = await validateCapabilityPlan({
        projectRoot,
        packsDirectory,
        capabilityId: current.entry.id,
      });
      return {
        status: "awaiting-finalization",
        ...base,
        progress: { completed: completedBeforeAction, total },
        currentCapability,
        remainingCapabilities: remainingBeforeAction,
        planPath: existing.planPath,
      };
    }

    const prepared = await prepareCapability({
      projectRoot,
      packsDirectory,
      capabilityId: current.entry.id,
      ...(options.recipeId ? { recipeId: options.recipeId } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    return {
      status: "prepared",
      ...base,
      progress: { completed: completedBeforeAction, total },
      currentCapability,
      remainingCapabilities: remainingBeforeAction,
      planPath: prepared.planPath,
    };
  }

  const finalization = await finalizeCapability({
    projectRoot,
    packsDirectory,
    capabilityId: current.entry.id,
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const remainingCapabilities = resolvedCapabilities
    .filter(({ entry }) => entry.id !== current.entry.id && !installed.has(entry.id))
    .map(({ entry }) => entry.id);

  if (remainingCapabilities.length > 0) {
    return {
      status: "finalized",
      ...base,
      progress: { completed: total - remainingCapabilities.length, total },
      currentCapability,
      remainingCapabilities,
      finalization,
    };
  }

  const verification = await checkSolution({
    solutionId: options.solutionId,
    projectRoot,
    packsDirectory,
    solutionsDirectory,
  });
  if (!verification.ok) {
    throw new AibaError(
      "Finalized solution failed verification",
      "FINALIZED_SOLUTION_INVALID",
    );
  }
  return {
    status: "evidence-verified",
    ...base,
    progress: { completed: total, total },
    currentCapability,
    remainingCapabilities: [],
    finalization,
    verification,
  };
}
