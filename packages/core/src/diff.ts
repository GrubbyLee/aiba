import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CapabilityAncestry,
  CapabilityReceipt,
  EvidenceType,
  SemanticOwnership,
} from "aiba-spec";
import { AibaError } from "./errors.js";
import { sha256File } from "./hash.js";
import {
  loadCapabilityAncestry,
  loadCapabilityReceipt,
  loadProjectLock,
  loadProjectManifest,
} from "./loaders.js";
import { resolveExistingProjectPath } from "./paths.js";

export type FileDriftStatus = "unchanged" | "customized" | "missing";
export type SourceDriftStatus = "locked" | "changed" | "missing" | "unlocked";

export interface FileDrift {
  path: string;
  status: FileDriftStatus;
  ownership: SemanticOwnership;
  installedSha256: string;
  actualSha256?: string;
  evidenceTypes: EvidenceType[];
  invariants: string[];
  operations: string[];
}

export interface CapabilityDiff {
  id: string;
  version: string;
  ancestry: "recorded" | "inferred";
  files: FileDrift[];
  sources: {
    capability: SourceDriftStatus;
    recipe?: SourceDriftStatus;
  };
}

export interface DiffIssue {
  code: string;
  message: string;
  capability?: string;
  path?: string;
}

export interface ProjectDiffReport {
  ok: boolean;
  hasDrift: boolean;
  projectRoot: string;
  capabilities: CapabilityDiff[];
  issues: DiffIssue[];
}

export interface DiffProjectOptions {
  projectRoot: string;
  packsDirectory: string;
  capabilityId?: string;
}

type AncestryFile = CapabilityAncestry["files"][number];

async function assertTrackedFile(
  root: string,
  path: string,
  expectedSha256: string,
  label: string,
): Promise<void> {
  const resolved = await resolveExistingProjectPath(root, path);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || await sha256File(resolved) !== expectedSha256) {
    throw new AibaError(`${label} provenance changed: ${path}`, "DIFF_PROVENANCE_CHANGED");
  }
}

async function loadAncestryFiles(
  root: string,
  declaration: { id: string; version: string },
  receipt: CapabilityReceipt,
): Promise<{ ancestry: "recorded" | "inferred"; files: AncestryFile[] }> {
  if (
    receipt.capability.id !== declaration.id
    || receipt.capability.version !== declaration.version
  ) {
    throw new AibaError(
      `Receipt does not match ${declaration.id}@${declaration.version}`,
      "DIFF_RECEIPT_CAPABILITY_MISMATCH",
    );
  }
  if (receipt.installation.plan && receipt.installation.planSha256) {
    await assertTrackedFile(
      root,
      receipt.installation.plan,
      receipt.installation.planSha256,
      "Operation plan",
    );
  }
  if (!receipt.installation.ancestry) {
    return { ancestry: "inferred", files: inferredAncestry(receipt) };
  }
  if (!receipt.installation.ancestrySha256) {
    throw new AibaError("Ancestry hash is missing", "DIFF_ANCESTRY_HASH_MISSING");
  }
  await assertTrackedFile(
    root,
    receipt.installation.ancestry,
    receipt.installation.ancestrySha256,
    "Capability ancestry",
  );
  const ancestry = await loadCapabilityAncestry(root, receipt.installation.ancestry);
  if (
    ancestry.capability.id !== declaration.id
    || ancestry.capability.version !== declaration.version
  ) {
    throw new AibaError(
      `Ancestry does not match ${declaration.id}@${declaration.version}`,
      "DIFF_ANCESTRY_CAPABILITY_MISMATCH",
    );
  }
  if (
    !receipt.installation.recipe
    || ancestry.recipe.id !== receipt.installation.recipe
  ) {
    throw new AibaError(
      "Ancestry recipe does not match the installation receipt",
      "DIFF_ANCESTRY_RECIPE_MISMATCH",
    );
  }
  return { ancestry: "recorded", files: ancestry.files };
}

function inferredAncestry(receipt: CapabilityReceipt): AncestryFile[] {
  const files = new Map<string, AncestryFile>();
  for (const attestation of receipt.invariants) {
    for (const evidence of attestation.evidence) {
      if (!evidence.sha256) continue;
      const ownership = evidence.ownership ?? "shared";
      const current = files.get(evidence.path);
      if (!current) {
        files.set(evidence.path, {
          path: evidence.path,
          installedSha256: evidence.sha256,
          ownership,
          evidenceTypes: [evidence.type],
          invariants: [attestation.id],
          operations: evidence.operation ? [evidence.operation] : [],
        });
        continue;
      }
      if (!current.evidenceTypes.includes(evidence.type)) current.evidenceTypes.push(evidence.type);
      if (!current.invariants.includes(attestation.id)) current.invariants.push(attestation.id);
      if (evidence.operation && !current.operations.includes(evidence.operation)) {
        current.operations.push(evidence.operation);
      }
    }
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function fileDrift(root: string, file: AncestryFile): Promise<FileDrift> {
  try {
    const path = await resolveExistingProjectPath(root, file.path);
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      return { ...file, status: "missing" };
    }
    const actualSha256 = await sha256File(path);
    return {
      ...file,
      status: actualSha256 === file.installedSha256 ? "unchanged" : "customized",
      actualSha256,
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ...file, status: "missing" };
    throw error;
  }
}

async function sourceStatus(path: string, lockedSha256: string | undefined): Promise<SourceDriftStatus> {
  if (!lockedSha256) return "unlocked";
  try {
    return await sha256File(path) === lockedSha256 ? "locked" : "changed";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
}

export async function diffProject(options: DiffProjectOptions): Promise<ProjectDiffReport> {
  const root = resolve(options.projectRoot);
  const packsDirectory = resolve(options.packsDirectory);
  const issues: DiffIssue[] = [];
  let project;
  let lock;
  try {
    [project, lock] = await Promise.all([
      loadProjectManifest(root),
      loadProjectLock(root),
    ]);
  } catch (error) {
    return {
      ok: false,
      hasDrift: false,
      projectRoot: root,
      capabilities: [],
      issues: [{
        code: "PROJECT_STATE_LOAD_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }

  const installed = options.capabilityId
    ? project.capabilities.filter((item) => item.id === options.capabilityId)
    : project.capabilities;
  if (options.capabilityId && installed.length === 0) {
    return {
      ok: false,
      hasDrift: false,
      projectRoot: root,
      capabilities: [],
      issues: [{
        code: "CAPABILITY_NOT_INSTALLED",
        message: `Capability ${options.capabilityId} is not installed`,
        capability: options.capabilityId,
      }],
    };
  }

  const capabilities: CapabilityDiff[] = [];
  for (const declaration of installed) {
    try {
      const receipt = await loadCapabilityReceipt(root, declaration.receipt);
      const baseline = await loadAncestryFiles(root, declaration, receipt);
      const locked = lock.capabilities.find((item) => item.id === declaration.id);
      const capabilityPath = join(packsDirectory, declaration.id, "capability.yaml");
      const capabilitySource = await sourceStatus(capabilityPath, locked?.manifestSha256);
      let recipeSource: SourceDriftStatus | undefined;
      if (receipt.installation.recipe) {
        const recipePath = join(
          packsDirectory,
          declaration.id,
          "recipes",
          `${receipt.installation.recipe}.yaml`,
        );
        recipeSource = await sourceStatus(recipePath, locked?.recipe?.sha256);
      }
      const files = await Promise.all(baseline.files.map((file) => fileDrift(root, file)));
      capabilities.push({
        id: declaration.id,
        version: declaration.version,
        ancestry: baseline.ancestry,
        files,
        sources: {
          capability: capabilitySource,
          ...(recipeSource ? { recipe: recipeSource } : {}),
        },
      });
    } catch (error) {
      issues.push({
        code: "CAPABILITY_DIFF_FAILED",
        message: error instanceof Error ? error.message : String(error),
        capability: declaration.id,
      });
    }
  }

  const hasDrift = capabilities.some((capability) =>
    capability.files.some((file) => file.status !== "unchanged")
    || capability.sources.capability !== "locked"
    || (capability.sources.recipe !== undefined && capability.sources.recipe !== "locked"),
  );
  return {
    ok: issues.length === 0,
    hasDrift,
    projectRoot: root,
    capabilities,
    issues,
  };
}
