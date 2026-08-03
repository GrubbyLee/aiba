import { join, resolve } from "node:path";
import { satisfies } from "semver";
import type { CapabilityManifest, CapabilitySolution } from "aiba-spec";
import { AibaError } from "./errors.js";
import { sha256File } from "./hash.js";
import {
  loadCapabilityManifest,
  loadCapabilitySolution,
  loadProjectManifest,
} from "./loaders.js";
import { verifyProject, type VerificationIssue } from "./verify.js";

export interface SolutionCapabilityState {
  id: string;
  version: string;
  purpose: string;
  installed: boolean;
  verified: boolean;
  issues: VerificationIssue[];
}

export interface SolutionCheckReport {
  ok: boolean;
  scope: "evidence-and-provenance";
  solution: {
    id: string;
    version: string;
    title: string;
  };
  projectRoot: string;
  installationOrder: string[];
  missingCapabilities: string[];
  capabilities: SolutionCapabilityState[];
}

export interface CheckSolutionOptions {
  solutionId: string;
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
}

interface ResolvedSolutionCapability {
  entry: CapabilitySolution["spec"]["capabilities"][number];
  manifest: CapabilityManifest;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const result = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result];
}

export async function resolveSolution(
  solution: CapabilitySolution,
  packsDirectory: string,
): Promise<ResolvedSolutionCapability[]> {
  const duplicateIds = duplicates(solution.spec.capabilities.map(({ id }) => id));
  if (duplicateIds.length > 0) {
    throw new AibaError(
      `Solution ${solution.metadata.id} declares duplicate capabilities: ${duplicateIds.join(", ")}`,
      "DUPLICATE_SOLUTION_CAPABILITY",
    );
  }

  const resolved: ResolvedSolutionCapability[] = [];
  for (const entry of solution.spec.capabilities) {
    const manifest = await loadCapabilityManifest(packsDirectory, entry.id);
    if (manifest.metadata.version !== entry.version) {
      throw new AibaError(
        `Solution requires ${entry.id}@${entry.version}, pack provides ${manifest.metadata.version}`,
        "SOLUTION_CAPABILITY_VERSION_MISMATCH",
      );
    }
    const manifestPath = join(resolve(packsDirectory), entry.id, "capability.yaml");
    if (await sha256File(manifestPath) !== entry.manifestSha256) {
      throw new AibaError(
        `Solution manifest hash does not match ${entry.id}@${entry.version}`,
        "SOLUTION_CAPABILITY_HASH_MISMATCH",
      );
    }
    resolved.push({ entry, manifest });
  }

  const positions = new Map(resolved.map(({ entry }, index) => [entry.id, index]));
  for (const [consumerIndex, { entry, manifest }] of resolved.entries()) {
    for (const dependency of manifest.spec.dependencies) {
      if (dependency.optional) continue;
      const dependencyIndex = positions.get(dependency.id);
      if (dependencyIndex === undefined) {
        throw new AibaError(
          `Solution omits ${dependency.id}, required by ${entry.id}@${entry.version}`,
          "SOLUTION_DEPENDENCY_MISSING",
        );
      }
      const candidate = resolved[dependencyIndex];
      if (!candidate || !satisfies(candidate.entry.version, dependency.version)) {
        throw new AibaError(
          `${entry.id}@${entry.version} requires ${dependency.id}@${dependency.version}`,
          "SOLUTION_DEPENDENCY_VERSION_UNSATISFIED",
        );
      }
      if (dependencyIndex >= consumerIndex) {
        throw new AibaError(
          `Solution must place ${dependency.id} before dependent capability ${entry.id}`,
          "SOLUTION_DEPENDENCY_ORDER_INVALID",
        );
      }
    }
  }
  return resolved;
}

export async function checkSolution(
  options: CheckSolutionOptions,
): Promise<SolutionCheckReport> {
  const projectRoot = resolve(options.projectRoot);
  const packsDirectory = resolve(options.packsDirectory);
  const solution = await loadCapabilitySolution(
    resolve(options.solutionsDirectory),
    options.solutionId,
  );
  const resolvedCapabilities = await resolveSolution(solution, packsDirectory);
  const project = await loadProjectManifest(projectRoot);
  const installed = new Map(project.capabilities.map((item) => [item.id, item.version]));
  const capabilities: SolutionCapabilityState[] = [];

  for (const { entry } of resolvedCapabilities) {
    const installedVersion = installed.get(entry.id);
    if (installedVersion !== entry.version) {
      const issues: VerificationIssue[] = [{
        level: "error",
        code: installedVersion === undefined
          ? "SOLUTION_CAPABILITY_NOT_INSTALLED"
          : "SOLUTION_PROJECT_VERSION_MISMATCH",
        message: installedVersion === undefined
          ? `Project does not install ${entry.id}@${entry.version}`
          : `Project installs ${entry.id}@${installedVersion}, solution requires ${entry.version}`,
        capability: entry.id,
      }];
      capabilities.push({
        id: entry.id,
        version: entry.version,
        purpose: entry.purpose,
        installed: installedVersion !== undefined,
        verified: false,
        issues,
      });
      continue;
    }

    const verification = await verifyProject({
      projectRoot,
      packsDirectory,
      capabilityId: entry.id,
    });
    capabilities.push({
      id: entry.id,
      version: entry.version,
      purpose: entry.purpose,
      installed: true,
      verified: verification.ok,
      issues: verification.issues,
    });
  }

  return {
    ok: capabilities.every(({ verified }) => verified),
    scope: "evidence-and-provenance",
    solution: {
      id: solution.metadata.id,
      version: solution.metadata.version,
      title: solution.metadata.title,
    },
    projectRoot,
    installationOrder: resolvedCapabilities.map(({ entry }) => entry.id),
    missingCapabilities: capabilities
      .filter(({ installed }) => !installed)
      .map(({ id }) => id),
    capabilities,
  };
}
