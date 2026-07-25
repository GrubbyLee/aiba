import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validRange } from "semver";
import { parse } from "yaml";
import type {
  CapabilityManifest,
  CapabilityReceipt,
  ProjectManifest,
} from "@aiba/spec";
import { AibaError } from "./errors.js";
import { resolveExistingProjectPath } from "./paths.js";
import {
  validateCapabilityManifest,
  validateCapabilityReceipt,
  validateProjectManifest,
} from "./validation.js";

async function readYaml(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new AibaError(`Cannot read ${path}`, "DOCUMENT_NOT_FOUND", {
      cause: error,
    });
  }

  try {
    return parse(text, { maxAliasCount: 50 }) as unknown;
  } catch (error) {
    throw new AibaError(`Cannot parse YAML document ${path}`, "INVALID_YAML", {
      cause: error,
    });
  }
}

export async function loadCapabilityManifest(
  packsDirectory: string,
  capabilityId: string,
): Promise<CapabilityManifest> {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  const packsRoot = resolve(packsDirectory);
  const manifestPath = join(packsRoot, capabilityId, "capability.yaml");
  const value = await readYaml(manifestPath);
  const manifest = validateCapabilityManifest(value);
  if (manifest.metadata.id !== capabilityId) {
    throw new AibaError(
      `Capability directory ${capabilityId} contains manifest ${manifest.metadata.id}`,
      "CAPABILITY_ID_MISMATCH",
    );
  }
  for (const dependency of manifest.spec.dependencies) {
    if (!validRange(dependency.version)) {
      throw new AibaError(
        `Capability ${capabilityId} has invalid dependency range ${dependency.version}`,
        "INVALID_CAPABILITY_DEPENDENCY_RANGE",
      );
    }
  }
  for (const invariant of manifest.spec.invariants) {
    const unsupported = invariant.evidence.requiredTypes.filter(
      (type) => !invariant.evidence.acceptedTypes.includes(type),
    );
    if (unsupported.length > 0) {
      throw new AibaError(
        `Invariant ${invariant.id} requires unaccepted evidence: ${unsupported.join(", ")}`,
        "INVALID_INVARIANT_EVIDENCE_POLICY",
      );
    }
  }
  return manifest;
}

export async function loadProjectManifest(
  projectRoot: string,
): Promise<ProjectManifest> {
  const path = join(resolve(projectRoot), ".aiba", "manifest.yaml");
  return validateProjectManifest(await readYaml(path));
}

export async function loadCapabilityReceipt(
  projectRoot: string,
  receiptPath: string,
): Promise<CapabilityReceipt> {
  const path = await resolveExistingProjectPath(projectRoot, receiptPath);
  return validateCapabilityReceipt(await readYaml(path));
}
