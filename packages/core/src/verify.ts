import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { satisfies } from "semver";
import type {
  CapabilityInvariant,
  CapabilityManifest,
  CapabilityReceipt,
  ProjectLock,
  ProjectManifest,
} from "@aiba/spec";
import { AibaError, ProtocolValidationError } from "./errors.js";
import { sha256File } from "./hash.js";
import {
  loadCapabilityManifest,
  loadCapabilityRecipe,
  loadCapabilityReceipt,
  loadProjectLock,
  loadProjectManifest,
} from "./loaders.js";
import { resolveExistingProjectPath } from "./paths.js";

export type VerificationIssueLevel = "error" | "warning";

export interface VerificationIssue {
  level: VerificationIssueLevel;
  code: string;
  message: string;
  capability?: string;
  invariant?: string;
  path?: string;
}

export interface VerificationReport {
  ok: boolean;
  projectRoot: string;
  verifiedCapabilities: string[];
  issues: VerificationIssue[];
}

export interface VerifyProjectOptions {
  projectRoot: string;
  packsDirectory: string;
  capabilityId?: string;
}

function issueFromError(error: unknown, fallbackCode: string): VerificationIssue {
  if (error instanceof ProtocolValidationError) {
    return {
      level: "error",
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof AibaError) {
    return { level: "error", code: error.code, message: error.message };
  }
  return {
    level: "error",
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function levelForInvariant(invariant: CapabilityInvariant): VerificationIssueLevel {
  return invariant.severity === "warning" ? "warning" : "error";
}

export async function verifyReceiptEvidence(
  root: string,
  manifest: CapabilityManifest,
  receipt: CapabilityReceipt,
): Promise<VerificationIssue[]> {
  const issues: VerificationIssue[] = [];
  const duplicateInvariantIds = duplicateValues(receipt.invariants.map((item) => item.id));
  for (const id of duplicateInvariantIds) {
    issues.push({
      level: "error",
      code: "DUPLICATE_RECEIPT_INVARIANT",
      message: `Receipt contains duplicate invariant ${id}`,
      capability: manifest.metadata.id,
      invariant: id,
    });
  }

  const receiptByInvariant = new Map(receipt.invariants.map((item) => [item.id, item]));
  const knownInvariantIds = new Set(manifest.spec.invariants.map((item) => item.id));

  for (const attestation of receipt.invariants) {
    if (!knownInvariantIds.has(attestation.id)) {
      issues.push({
        level: "error",
        code: "UNKNOWN_RECEIPT_INVARIANT",
        message: `Receipt attests unknown invariant ${attestation.id}`,
        capability: manifest.metadata.id,
        invariant: attestation.id,
      });
    }
  }

  for (const invariant of manifest.spec.invariants) {
    const attestation = receiptByInvariant.get(invariant.id);
    if (!attestation) {
      issues.push({
        level: levelForInvariant(invariant),
        code: "MISSING_INVARIANT_ATTESTATION",
        message: `Missing attestation for ${invariant.id}`,
        capability: manifest.metadata.id,
        invariant: invariant.id,
      });
      continue;
    }

    const acceptedEvidence = attestation.evidence.filter((evidence) =>
      invariant.evidence.acceptedTypes.includes(evidence.type),
    );
    if (acceptedEvidence.length < invariant.evidence.minimum) {
      issues.push({
        level: levelForInvariant(invariant),
        code: "INSUFFICIENT_INVARIANT_EVIDENCE",
        message: `${invariant.id} requires ${invariant.evidence.minimum} accepted evidence item(s)` ,
        capability: manifest.metadata.id,
        invariant: invariant.id,
      });
    }

    for (const requiredType of invariant.evidence.requiredTypes) {
      if (!acceptedEvidence.some((evidence) => evidence.type === requiredType)) {
        issues.push({
          level: levelForInvariant(invariant),
          code: "REQUIRED_EVIDENCE_TYPE_MISSING",
          message: `${invariant.id} requires ${requiredType} evidence`,
          capability: manifest.metadata.id,
          invariant: invariant.id,
        });
      }
    }

    for (const evidence of attestation.evidence) {
      if (!invariant.evidence.acceptedTypes.includes(evidence.type)) {
        issues.push({
          level: "error",
          code: "UNACCEPTED_EVIDENCE_TYPE",
          message: `${evidence.type} evidence is not accepted for ${invariant.id}`,
          capability: manifest.metadata.id,
          invariant: invariant.id,
          path: evidence.path,
        });
        continue;
      }

      let path: string;
      try {
        path = await resolveExistingProjectPath(root, evidence.path);
        const metadata = await stat(path);
        if (!metadata.isFile()) {
          throw new AibaError(`${evidence.path} is not a file`, "EVIDENCE_NOT_FILE");
        }
      } catch (error) {
        issues.push({
          ...issueFromError(error, "EVIDENCE_NOT_FOUND"),
          capability: manifest.metadata.id,
          invariant: invariant.id,
          path: evidence.path,
        });
        continue;
      }

      if (invariant.evidence.requireHash && !evidence.sha256) {
        issues.push({
          level: levelForInvariant(invariant),
          code: "EVIDENCE_HASH_REQUIRED",
          message: `Evidence ${evidence.path} requires a SHA-256 hash`,
          capability: manifest.metadata.id,
          invariant: invariant.id,
          path: evidence.path,
        });
        continue;
      }

      if (evidence.sha256) {
        const actual = await sha256File(path);
        if (actual !== evidence.sha256) {
          issues.push({
            level: levelForInvariant(invariant),
            code: "EVIDENCE_HASH_MISMATCH",
            message: `Evidence hash changed for ${evidence.path}`,
            capability: manifest.metadata.id,
            invariant: invariant.id,
            path: evidence.path,
          });
        }
      }
    }
  }

  return issues;
}

async function verifyInstallationProvenance(
  root: string,
  manifest: CapabilityManifest,
  receipt: CapabilityReceipt,
): Promise<VerificationIssue[]> {
  const { plan, planSha256 } = receipt.installation;
  if (!plan || !planSha256) return [];

  try {
    const path = await resolveExistingProjectPath(root, plan);
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new AibaError(`${plan} is not a file`, "PLAN_NOT_FILE");
    }
    const actual = await sha256File(path);
    if (actual !== planSha256) {
      return [{
        level: "error",
        code: "PLAN_HASH_MISMATCH",
        message: `Operation plan hash changed for ${plan}`,
        capability: manifest.metadata.id,
        path: plan,
      }];
    }
    return [];
  } catch (error) {
    return [{
      ...issueFromError(error, "PLAN_NOT_FOUND"),
      capability: manifest.metadata.id,
      path: plan,
    }];
  }
}

async function verifyCapability(
  project: ProjectManifest,
  lock: ProjectLock,
  projectRoot: string,
  packsDirectory: string,
  capabilityId: string,
): Promise<{ verified: boolean; issues: VerificationIssue[] }> {
  const issues: VerificationIssue[] = [];
  const installed = project.capabilities.find((item) => item.id === capabilityId);
  if (!installed) {
    return {
      verified: false,
      issues: [{
        level: "error",
        code: "CAPABILITY_NOT_INSTALLED",
        message: `Capability ${capabilityId} is not declared in the project`,
        capability: capabilityId,
      }],
    };
  }

  let manifest: CapabilityManifest;
  let receipt: CapabilityReceipt;
  try {
    manifest = await loadCapabilityManifest(packsDirectory, capabilityId);
    receipt = await loadCapabilityReceipt(projectRoot, installed.receipt);
  } catch (error) {
    return { verified: false, issues: [
      { ...issueFromError(error, "CAPABILITY_LOAD_FAILED"), capability: capabilityId },
    ] };
  }

  const duplicateManifestIds = duplicateValues(manifest.spec.invariants.map((item) => item.id));
  for (const id of duplicateManifestIds) {
    issues.push({
      level: "error",
      code: "DUPLICATE_CAPABILITY_INVARIANT",
      message: `Capability manifest contains duplicate invariant ${id}`,
      capability: capabilityId,
      invariant: id,
    });
  }

  if (manifest.metadata.version !== installed.version) {
    issues.push({
      level: "error",
      code: "CAPABILITY_VERSION_MISMATCH",
      message: `Project declares ${installed.version}, pack provides ${manifest.metadata.version}`,
      capability: capabilityId,
    });
  }
  if (receipt.capability.id !== capabilityId || receipt.capability.version !== installed.version) {
    issues.push({
      level: "error",
      code: "RECEIPT_CAPABILITY_MISMATCH",
      message: `Receipt identifies ${receipt.capability.id}@${receipt.capability.version}`,
      capability: capabilityId,
    });
  }

  const locked = lock.capabilities.find((item) => item.id === capabilityId);
  if (!locked) {
    issues.push({
      level: "error",
      code: "CAPABILITY_LOCK_MISSING",
      message: `Project lock has no source record for ${capabilityId}`,
      capability: capabilityId,
    });
  } else {
    if (locked.version !== installed.version) {
      issues.push({
        level: "error",
        code: "CAPABILITY_LOCK_VERSION_MISMATCH",
        message: `Project lock records ${capabilityId}@${locked.version}, project declares ${installed.version}`,
        capability: capabilityId,
      });
    }
    const manifestPath = join(resolve(packsDirectory), capabilityId, "capability.yaml");
    if (await sha256File(manifestPath) !== locked.manifestSha256) {
      issues.push({
        level: "error",
        code: "CAPABILITY_MANIFEST_HASH_MISMATCH",
        message: `Capability source changed for ${capabilityId}`,
        capability: capabilityId,
        path: manifestPath,
      });
    }

    if (locked.recipe) {
      if (receipt.installation.recipe !== locked.recipe.id) {
        issues.push({
          level: "error",
          code: "RECIPE_LOCK_MISMATCH",
          message: `Receipt recipe does not match locked recipe ${locked.recipe.id}`,
          capability: capabilityId,
        });
      } else {
        try {
          await loadCapabilityRecipe(packsDirectory, capabilityId, locked.recipe.id);
          const recipePath = join(
            resolve(packsDirectory),
            capabilityId,
            "recipes",
            `${locked.recipe.id}.yaml`,
          );
          if (await sha256File(recipePath) !== locked.recipe.sha256) {
            issues.push({
              level: "error",
              code: "RECIPE_HASH_MISMATCH",
              message: `Recipe source changed for ${locked.recipe.id}`,
              capability: capabilityId,
              path: recipePath,
            });
          }
        } catch (error) {
          issues.push({
            ...issueFromError(error, "RECIPE_LOAD_FAILED"),
            capability: capabilityId,
          });
        }
      }
    }
  }

  for (const dependency of manifest.spec.dependencies) {
    if (dependency.optional) continue;
    const candidate = project.capabilities.find((item) => item.id === dependency.id);
    if (!candidate || !satisfies(candidate.version, dependency.version)) {
      issues.push({
        level: "error",
        code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
        message: `${capabilityId} requires ${dependency.id}@${dependency.version}`,
        capability: capabilityId,
      });
    }
  }

  issues.push(...await verifyInstallationProvenance(projectRoot, manifest, receipt));
  issues.push(...await verifyReceiptEvidence(projectRoot, manifest, receipt));
  return { verified: !issues.some((issue) => issue.level === "error"), issues };
}

export async function verifyProject(options: VerifyProjectOptions): Promise<VerificationReport> {
  const projectRoot = resolve(options.projectRoot);
  let project: ProjectManifest;
  let lock: ProjectLock;
  try {
    project = await loadProjectManifest(projectRoot);
  } catch (error) {
    const issue = issueFromError(error, "PROJECT_LOAD_FAILED");
    return { ok: false, projectRoot, verifiedCapabilities: [], issues: [issue] };
  }
  try {
    lock = await loadProjectLock(projectRoot);
  } catch (error) {
    const issue = issueFromError(error, "PROJECT_LOCK_LOAD_FAILED");
    return { ok: false, projectRoot, verifiedCapabilities: [], issues: [issue] };
  }

  const issues: VerificationIssue[] = [];
  for (const id of duplicateValues(project.capabilities.map((item) => item.id))) {
    issues.push({
      level: "error",
      code: "DUPLICATE_PROJECT_CAPABILITY",
      message: `Project declares capability ${id} more than once`,
      capability: id,
    });
  }
  for (const id of duplicateValues(lock.capabilities.map((item) => item.id))) {
    issues.push({
      level: "error",
      code: "DUPLICATE_LOCKED_CAPABILITY",
      message: `Project lock records capability ${id} more than once`,
      capability: id,
    });
  }

  const capabilityIds = options.capabilityId
    ? [options.capabilityId]
    : project.capabilities.map((item) => item.id);
  const verifiedCapabilities: string[] = [];
  for (const capabilityId of capabilityIds) {
    const result = await verifyCapability(
      project,
      lock,
      projectRoot,
      options.packsDirectory,
      capabilityId,
    );
    issues.push(...result.issues);
    if (result.verified) verifiedCapabilities.push(capabilityId);
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    projectRoot,
    verifiedCapabilities,
    issues,
  };
}
