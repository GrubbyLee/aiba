import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validRange } from "semver";
import { parse } from "yaml";
import type {
  CapabilityCatalog,
  ApplicationBlueprint,
  CapabilityManifest,
  CapabilityAncestry,
  CapabilityMigration,
  CapabilityRecipe,
  CapabilityReceipt,
  CapabilitySolution,
  OperationPlan,
  ProjectLock,
  ProjectManifest,
  UpgradePlan,
} from "aiba-spec";
import { AibaError } from "./errors.js";
import { assertApplicationBlueprintSemantics } from "./application-blueprint.js";
import { resolveExistingProjectPath } from "./paths.js";
import {
  validateApplicationBlueprint,
  validateCapabilityCatalog,
  validateCapabilityManifest,
  validateCapabilityAncestry,
  validateCapabilityMigration,
  validateCapabilityRecipe,
  validateCapabilityReceipt,
  validateCapabilitySolution,
  validateOperationPlan,
  validateProjectLock,
  validateProjectManifest,
  validateUpgradePlan,
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

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new AibaError(`Cannot read ${path}`, "DOCUMENT_NOT_FOUND", {
      cause: error,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AibaError(`Cannot parse JSON document ${path}`, "INVALID_JSON", {
      cause: error,
    });
  }
}

async function resolveProjectDocumentPath(
  projectRoot: string,
  projectPath: string,
): Promise<string> {
  try {
    return await resolveExistingProjectPath(projectRoot, projectPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return join(resolve(projectRoot), projectPath);
    throw error;
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

export async function loadCapabilityCatalog(packsDirectory: string): Promise<CapabilityCatalog> {
  const path = join(resolve(packsDirectory), "catalog.yaml");
  const catalog = validateCapabilityCatalog(await readYaml(path));
  const identities = catalog.capabilities.map(({ id, version }) => `${id}@${version}`);
  if (new Set(identities).size !== identities.length) {
    throw new AibaError("Capability catalog contains duplicate versions", "DUPLICATE_CAPABILITY");
  }
  return catalog;
}

export async function loadCapabilitySolution(
  solutionsDirectory: string,
  solutionId: string,
): Promise<CapabilitySolution> {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(solutionId)) {
    throw new AibaError(`Invalid solution identifier: ${solutionId}`, "INVALID_SOLUTION_ID");
  }
  const path = join(resolve(solutionsDirectory), solutionId, "solution.yaml");
  const solution = validateCapabilitySolution(await readYaml(path));
  if (solution.metadata.id !== solutionId) {
    throw new AibaError(
      `Solution directory ${solutionId} contains ${solution.metadata.id}`,
      "SOLUTION_ID_MISMATCH",
    );
  }
  return solution;
}

export async function loadApplicationBlueprint(path: string): Promise<ApplicationBlueprint> {
  return assertApplicationBlueprintSemantics(
    validateApplicationBlueprint(await readYaml(resolve(path))),
  );
}

export async function loadProjectManifest(
  projectRoot: string,
): Promise<ProjectManifest> {
  const path = join(resolve(projectRoot), ".aiba", "manifest.yaml");
  return validateProjectManifest(await readYaml(path));
}

export async function loadProjectLock(projectRoot: string): Promise<ProjectLock> {
  const path = join(resolve(projectRoot), ".aiba", "lock.json");
  return validateProjectLock(await readJson(path));
}

export async function loadCapabilityReceipt(
  projectRoot: string,
  receiptPath: string,
): Promise<CapabilityReceipt> {
  const path = await resolveExistingProjectPath(projectRoot, receiptPath);
  return validateCapabilityReceipt(await readYaml(path));
}

export async function loadCapabilityAncestry(
  projectRoot: string,
  ancestryPath: string,
): Promise<CapabilityAncestry> {
  const path = await resolveExistingProjectPath(projectRoot, ancestryPath);
  return validateCapabilityAncestry(await readJson(path));
}

export async function loadCapabilityRecipe(
  packsDirectory: string,
  capabilityId: string,
  recipeId: string,
): Promise<CapabilityRecipe> {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(recipeId)) {
    throw new AibaError(`Invalid recipe identifier: ${recipeId}`, "INVALID_RECIPE_ID");
  }
  const path = join(resolve(packsDirectory), capabilityId, "recipes", `${recipeId}.yaml`);
  const recipe = validateCapabilityRecipe(await readYaml(path));
  if (recipe.metadata.id !== recipeId) {
    throw new AibaError(
      `Recipe file ${recipeId}.yaml contains recipe ${recipe.metadata.id}`,
      "RECIPE_ID_MISMATCH",
    );
  }
  return recipe;
}

export async function loadOperationPlan(
  projectRoot: string,
  capabilityId: string,
): Promise<OperationPlan> {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  const path = await resolveProjectDocumentPath(
    projectRoot,
    `.aiba/plans/${capabilityId}.yaml`,
  );
  return validateOperationPlan(await readYaml(path));
}

export async function loadCapabilityMigration(
  packsDirectory: string,
  capabilityId: string,
  fromVersion: string,
  toVersion: string,
): Promise<CapabilityMigration> {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
  if (!versionPattern.test(fromVersion) || !versionPattern.test(toVersion)) {
    throw new AibaError("Invalid migration version", "INVALID_MIGRATION_VERSION");
  }
  const path = join(
    resolve(packsDirectory),
    capabilityId,
    "migrations",
    `${fromVersion}-to-${toVersion}.yaml`,
  );
  return validateCapabilityMigration(await readYaml(path));
}

export async function loadUpgradePlan(
  projectRoot: string,
  capabilityId: string,
): Promise<UpgradePlan> {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  const path = await resolveProjectDocumentPath(
    projectRoot,
    `.aiba/plans/${capabilityId}.upgrade.yaml`,
  );
  return validateUpgradePlan(await readYaml(path));
}
