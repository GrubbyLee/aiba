import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { gt } from "semver";
import { stringify } from "yaml";
import {
  AIBA_API_VERSION,
  type CapabilityAncestry,
  type CapabilityManifest,
  type CapabilityMigration,
  type CapabilityReceipt,
  type ProjectLock,
  type ProjectManifest,
  type UpgradeConflict,
  type UpgradePlan,
} from "@aiba/spec";
import {
  assertDependenciesInstalled,
  assertRecipeSemantics,
  createCapabilityAncestry,
  createCapabilityReceipt,
  selectCapabilityRecipe,
  writeCapabilityState,
} from "./add.js";
import { diffProject, type FileDrift } from "./diff.js";
import { AibaError } from "./errors.js";
import { requireGovernance } from "./governance.js";
import { sha256File, sha256Text } from "./hash.js";
import { inspectProject } from "./inspect.js";
import {
  loadCapabilityAncestry,
  loadCapabilityManifest,
  loadCapabilityMigration,
  loadCapabilityReceipt,
  loadCapabilityRecipe,
  loadProjectLock,
  loadProjectManifest,
  loadUpgradePlan,
} from "./loaders.js";
import { resolveExistingProjectPath } from "./paths.js";

export interface PrepareUpgradeOptions {
  projectRoot: string;
  targetPacksDirectory: string;
  capabilityId: string;
  recipeId?: string;
  now?: () => Date;
}

export interface PrepareUpgradeResult {
  planPath: string;
  plan: UpgradePlan;
}

export interface FinalizeUpgradeOptions {
  projectRoot: string;
  targetPacksDirectory: string;
  capabilityId: string;
  agent?: string;
  now?: () => Date;
}

export interface FinalizeUpgradeResult {
  capability: string;
  fromVersion: string;
  toVersion: string;
  receiptPath: string;
  resolvedConflicts: number;
  evidenceFiles: number;
}

function normalizeProjectPath(path: string): string {
  return path.split(sep).join("/");
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function conflictFor(file: Pick<FileDrift, "status" | "ownership">): UpgradeConflict {
  if (file.status === "unchanged" || file.ownership === "project") return "none";
  if (file.status === "customized") {
    return file.ownership === "generated" ? "customized-generated" : "customized-shared";
  }
  return file.ownership === "generated" ? "missing-generated" : "missing-shared";
}

export function assertMigrationSemantics(
  migration: CapabilityMigration,
  installedVersion: string,
  target: CapabilityManifest,
): void {
  if (
    migration.spec.capability.id !== target.metadata.id
    || migration.spec.capability.fromVersion !== installedVersion
    || migration.spec.capability.toVersion !== target.metadata.version
  ) {
    throw new AibaError(
      `Migration ${migration.metadata.id} does not target ${target.metadata.id}@${installedVersion}->${target.metadata.version}`,
      "MIGRATION_CAPABILITY_MISMATCH",
    );
  }
  const invariants = new Set(target.spec.invariants.map((item) => item.id));
  for (const operation of migration.spec.operations) {
    if (operation.affectedInvariants.some((id) => !invariants.has(id))) {
      throw new AibaError(
        `Migration operation ${operation.id} references unknown target invariants`,
        "UNKNOWN_MIGRATION_INVARIANT",
      );
    }
  }
}

async function loadInstalledState(root: string, capabilityId: string) {
  const [project, lock] = await Promise.all([
    loadProjectManifest(root),
    loadProjectLock(root),
  ]);
  const installed = project.capabilities.find((item) => item.id === capabilityId);
  const locked = lock.capabilities.find((item) => item.id === capabilityId);
  if (!installed || !locked) {
    throw new AibaError(
      `Capability ${capabilityId} is not installed with lock state`,
      "CAPABILITY_NOT_INSTALLED",
    );
  }
  const receipt = await loadCapabilityReceipt(root, installed.receipt);
  return { project, lock, installed, locked, receipt };
}

async function migrationDocument(
  packsDirectory: string,
  capabilityId: string,
  fromVersion: string,
  toVersion: string,
) {
  const migration = await loadCapabilityMigration(
    packsDirectory,
    capabilityId,
    fromVersion,
    toVersion,
  );
  const path = join(
    resolve(packsDirectory),
    capabilityId,
    "migrations",
    `${fromVersion}-to-${toVersion}.yaml`,
  );
  return { migration, path };
}

async function ancestryRecipeVersion(
  root: string,
  receipt: CapabilityReceipt,
): Promise<string | undefined> {
  if (!receipt.installation.ancestry) return undefined;
  const ancestry = await loadCapabilityAncestry(root, receipt.installation.ancestry);
  return ancestry.recipe.version;
}

export async function prepareUpgrade(
  options: PrepareUpgradeOptions,
): Promise<PrepareUpgradeResult> {
  const root = resolve(options.projectRoot);
  const packsDirectory = resolve(options.targetPacksDirectory);
  const state = await loadInstalledState(root, options.capabilityId);
  const target = await loadCapabilityManifest(packsDirectory, options.capabilityId);
  if (!gt(target.metadata.version, state.installed.version)) {
    throw new AibaError(
      `Target ${target.metadata.version} is not newer than installed ${state.installed.version}`,
      "TARGET_VERSION_NOT_NEWER",
    );
  }
  assertDependenciesInstalled(state.project, target);

  const inspection = await inspectProject(root);
  const selected = await selectCapabilityRecipe(
    packsDirectory,
    target,
    inspection.languages.map((item) => item.name),
    inspection.frameworks,
    options.recipeId,
  );
  const { recipe } = selected;
  if (state.receipt.installation.recipe && state.receipt.installation.recipe !== recipe.metadata.id) {
    throw new AibaError(
      `M2 requires the target recipe id to remain ${state.receipt.installation.recipe}`,
      "RECIPE_ID_CHANGE_UNSUPPORTED",
    );
  }
  const loadedMigration = await migrationDocument(
    packsDirectory,
    options.capabilityId,
    state.installed.version,
    target.metadata.version,
  );
  assertMigrationSemantics(loadedMigration.migration, state.installed.version, target);

  const diff = await diffProject({
    projectRoot: root,
    packsDirectory,
    capabilityId: options.capabilityId,
  });
  const capabilityDiff = diff.capabilities[0];
  if (!diff.ok || !capabilityDiff) {
    throw new AibaError(
      `Cannot inspect installed customization: ${diff.issues.map((issue) => issue.message).join("; ")}`,
      "UPGRADE_DIFF_FAILED",
    );
  }

  const manifestPath = join(packsDirectory, options.capabilityId, "capability.yaml");
  const guidance = new Map(recipe.spec.evidence.map((item) => [item.invariant, item]));
  const previousEvidence = new Map(
    state.receipt.invariants.map((item) => [item.id, item.evidence]),
  );
  const plan: UpgradePlan = {
    apiVersion: AIBA_API_VERSION,
    kind: "UpgradePlan",
    metadata: {
      id: `${options.capabilityId}-upgrade`,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
    capability: {
      id: options.capabilityId,
      fromVersion: state.installed.version,
      toVersion: target.metadata.version,
      fromManifestSha256: state.locked.manifestSha256,
      targetManifestSha256: await sha256File(manifestPath),
    },
    recipe: {
      id: recipe.metadata.id,
      ...(await ancestryRecipeVersion(root, state.receipt)
        .then((version) => version ? { fromVersion: version } : {})),
      toVersion: recipe.metadata.version,
      targetSha256: await sha256File(selected.path),
    },
    migration: {
      id: loadedMigration.migration.metadata.id,
      version: loadedMigration.migration.metadata.version,
      sha256: await sha256File(loadedMigration.path),
    },
    project: { name: state.project.project.name },
    drift: capabilityDiff.files.map((file) => ({
      ...file,
      conflict: conflictFor(file),
    })),
    operations: loadedMigration.migration.spec.operations,
    evidence: target.spec.invariants.map((invariant) => ({
      invariant: invariant.id,
      requirements: invariant.evidence,
      suggestions: guidance.get(invariant.id)?.suggestions ?? [],
      items: (previousEvidence.get(invariant.id) ?? []).map((item) => ({
        type: item.type,
        path: item.path,
        ...(item.description ? { description: item.description } : {}),
        ...(item.ownership ? { ownership: item.ownership } : {}),
        ...(item.operation ? { operation: item.operation } : {}),
      })),
    })),
  };

  const stateDirectory = await resolveExistingProjectPath(root, ".aiba");
  const plansDirectory = join(stateDirectory, "plans");
  const planPath = join(plansDirectory, `${options.capabilityId}.upgrade.yaml`);
  await mkdir(plansDirectory, { recursive: true });
  try {
    await writeFile(planPath, stringify(plan), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "EEXIST") {
      throw new AibaError(
        `Upgrade plan already exists at ${planPath}`,
        "UPGRADE_PLAN_EXISTS",
      );
    }
    throw error;
  }
  return {
    planPath: normalizeProjectPath(relative(root, planPath)),
    plan,
  };
}

function immutableDrift(plan: UpgradePlan): Array<Omit<UpgradePlan["drift"][number],
  "status" | "actualSha256" | "conflict" | "resolution">> {
  return plan.drift.map(({
    status: _status,
    actualSha256: _actualSha256,
    conflict: _conflict,
    resolution: _resolution,
    ...file
  }) => file);
}

function immutableEvidence(plan: UpgradePlan) {
  return plan.evidence.map(({ items: _items, ...item }) => item);
}

async function assertUpgradeSources(
  plan: UpgradePlan,
  state: Awaited<ReturnType<typeof loadInstalledState>>,
  target: CapabilityManifest,
  recipe: Awaited<ReturnType<typeof loadCapabilityRecipe>>,
  installedRecipeVersion: string | undefined,
  recipePath: string,
  migration: { migration: CapabilityMigration; path: string },
  manifestPath: string,
): Promise<void> {
  if (
    plan.capability.id !== target.metadata.id
    || plan.capability.fromVersion !== state.installed.version
    || plan.capability.toVersion !== target.metadata.version
    || plan.capability.fromManifestSha256 !== state.locked.manifestSha256
    || plan.capability.targetManifestSha256 !== await sha256File(manifestPath)
  ) {
    throw new AibaError("Upgrade capability sources changed", "STALE_UPGRADE_CAPABILITY");
  }
  if (
    plan.recipe.id !== recipe.metadata.id
    || plan.recipe.fromVersion !== installedRecipeVersion
    || plan.recipe.toVersion !== recipe.metadata.version
    || plan.recipe.targetSha256 !== await sha256File(recipePath)
    || plan.migration.id !== migration.migration.metadata.id
    || plan.migration.version !== migration.migration.metadata.version
    || plan.migration.sha256 !== await sha256File(migration.path)
  ) {
    throw new AibaError("Upgrade recipe or migration changed", "STALE_UPGRADE_SOURCE");
  }
}

export async function finalizeUpgrade(
  options: FinalizeUpgradeOptions,
): Promise<FinalizeUpgradeResult> {
  const root = resolve(options.projectRoot);
  const packsDirectory = resolve(options.targetPacksDirectory);
  const state = await loadInstalledState(root, options.capabilityId);
  const plan = await loadUpgradePlan(root, options.capabilityId);
  const target = await loadCapabilityManifest(packsDirectory, options.capabilityId);
  const recipe = await loadCapabilityRecipe(
    packsDirectory,
    options.capabilityId,
    plan.recipe.id,
  );
  assertRecipeSemantics(recipe, target);
  assertDependenciesInstalled(state.project, target);
  const migration = await migrationDocument(
    packsDirectory,
    options.capabilityId,
    state.installed.version,
    target.metadata.version,
  );
  assertMigrationSemantics(migration.migration, state.installed.version, target);
  const manifestPath = join(packsDirectory, options.capabilityId, "capability.yaml");
  const recipePath = join(
    packsDirectory,
    options.capabilityId,
    "recipes",
    `${recipe.metadata.id}.yaml`,
  );
  const installedRecipeVersion = await ancestryRecipeVersion(root, state.receipt);
  await assertUpgradeSources(
    plan,
    state,
    target,
    recipe,
    installedRecipeVersion,
    recipePath,
    migration,
    manifestPath,
  );
  if (plan.project.name !== state.project.project.name) {
    throw new AibaError("Upgrade plan belongs to another project", "UPGRADE_PROJECT_MISMATCH");
  }

  const currentDiff = await diffProject({
    projectRoot: root,
    packsDirectory,
    capabilityId: options.capabilityId,
  });
  const capabilityDiff = currentDiff.capabilities[0];
  if (!currentDiff.ok || !capabilityDiff) {
    throw new AibaError("Cannot re-evaluate upgrade conflicts", "UPGRADE_DIFF_FAILED");
  }
  if (!equal(immutableDrift(plan), immutableDrift({ ...plan, drift: capabilityDiff.files.map(
    (file) => ({ ...file, conflict: conflictFor(file) }),
  ) }))) {
    throw new AibaError("Upgrade ancestry fields were modified", "UPGRADE_ANCESTRY_MODIFIED");
  }
  const guidance = new Map(recipe.spec.evidence.map((item) => [item.invariant, item]));
  const expectedEvidence = target.spec.invariants.map((invariant) => ({
    invariant: invariant.id,
    requirements: invariant.evidence,
    suggestions: guidance.get(invariant.id)?.suggestions ?? [],
  }));
  if (
    !equal(plan.operations, migration.migration.spec.operations)
    || !equal(immutableEvidence(plan), expectedEvidence)
  ) {
    throw new AibaError("Upgrade contract fields were modified", "UPGRADE_CONTRACT_MODIFIED");
  }

  const resolutionByPath = new Map(
    plan.drift.map((file) => [file.path, file.resolution]),
  );
  const conflicts = capabilityDiff.files
    .map((file) => ({ file, conflict: conflictFor(file) }))
    .filter(({ conflict }) => conflict !== "none");
  const unresolved = conflicts.filter(({ file }) => !resolutionByPath.get(file.path));
  if (unresolved.length > 0) {
    throw new AibaError(
      `Upgrade has unresolved conflicts: ${unresolved.map(({ file }) => file.path).join(", ")}`,
      "UPGRADE_CONFLICTS_UNRESOLVED",
    );
  }
  const plannedDriftByPath = new Map(plan.drift.map((file) => [file.path, file]));
  for (const { file } of conflicts) {
    const resolution = resolutionByPath.get(file.path);
    if (!resolution) continue;
    const planned = plannedDriftByPath.get(file.path);
    const removesExistingFile = resolution.action === "remove" && file.status !== "missing";
    const keepsMissingFile = resolution.action !== "remove" && file.status === "missing";
    const changedWhilePreserving = resolution.action === "preserve" && (
      !planned?.actualSha256 || planned.actualSha256 !== file.actualSha256
    );
    if (removesExistingFile || keepsMissingFile || changedWhilePreserving) {
      throw new AibaError(
        `Resolution ${resolution.action} does not match the final state of ${file.path}`,
        "UPGRADE_RESOLUTION_MISMATCH",
      );
    }
  }

  const stateDirectory = await resolveExistingProjectPath(root, ".aiba");
  const planPath = await resolveExistingProjectPath(
    root,
    `.aiba/plans/${options.capabilityId}.upgrade.yaml`,
  );
  const receiptPath = await resolveExistingProjectPath(root, state.installed.receipt);
  const ancestryDirectory = join(stateDirectory, "ancestry");
  await mkdir(ancestryDirectory, { recursive: true });
  const ancestryPath = join(ancestryDirectory, `${options.capabilityId}.json`);
  const now = (options.now ?? (() => new Date()))();
  const createdAt = now.toISOString();
  const governance = await requireGovernance({
    projectRoot: root,
    capabilityId: options.capabilityId,
    operation: "upgrade",
    ...(options.agent ? { agent: options.agent } : {}),
    now: () => now,
  });
  const created = await createCapabilityReceipt(
    root,
    plan,
    target,
    recipe,
    planPath,
    options.agent,
    createdAt,
    governance,
  );
  const ancestry = createCapabilityAncestry(created.receipt, recipe, createdAt);
  const ancestryText = `${JSON.stringify(ancestry, null, 2)}\n`;
  const receipt: CapabilityReceipt = {
    ...created.receipt,
    installation: {
      ...created.receipt.installation,
      ancestry: normalizeProjectPath(relative(root, ancestryPath)),
      ancestrySha256: sha256Text(ancestryText),
    },
  };
  const nextProject: ProjectManifest = {
    ...state.project,
    capabilities: state.project.capabilities.map((item) => item.id === options.capabilityId
      ? { ...item, version: target.metadata.version }
      : item),
  };
  const targetManifestSha256 = await sha256File(manifestPath);
  const targetRecipeSha256 = await sha256File(recipePath);
  const nextLock: ProjectLock = {
    ...state.lock,
    generatedAt: createdAt,
    capabilities: state.lock.capabilities.map((item) => item.id === options.capabilityId
      ? {
        id: options.capabilityId,
        version: target.metadata.version,
        manifestSha256: targetManifestSha256,
        recipe: { id: recipe.metadata.id, sha256: targetRecipeSha256 },
      }
      : item),
  };
  await writeCapabilityState({
    root,
    manifest: nextProject,
    lock: nextLock,
    receipt,
    receiptPath,
    ancestry,
    ancestryPath,
    packsDirectory,
    capabilityId: options.capabilityId,
    replaceExisting: true,
  });
  return {
    capability: options.capabilityId,
    fromVersion: state.installed.version,
    toVersion: target.metadata.version,
    receiptPath: normalizeProjectPath(relative(root, receiptPath)),
    resolvedConflicts: conflicts.length,
    evidenceFiles: created.evidenceFiles,
  };
}
