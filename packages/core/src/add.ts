import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { minimatch } from "minimatch";
import { satisfies } from "semver";
import { stringify } from "yaml";
import {
  AIBA_API_VERSION,
  type CapabilityManifest,
  type CapabilityRecipe,
  type CapabilityReceipt,
  type OperationPlan,
  type ProjectLock,
  type ProjectManifest,
} from "@aiba/spec";
import { AibaError } from "./errors.js";
import { sha256File } from "./hash.js";
import { inspectProject } from "./inspect.js";
import {
  loadCapabilityManifest,
  loadCapabilityRecipe,
  loadOperationPlan,
  loadProjectLock,
  loadProjectManifest,
} from "./loaders.js";
import { resolveExistingProjectPath } from "./paths.js";
import { verifyProject, verifyReceiptEvidence } from "./verify.js";

const CAPABILITY_ID = /^[a-z][a-z0-9-]{1,62}$/;

export interface PrepareCapabilityOptions {
  projectRoot: string;
  packsDirectory: string;
  capabilityId: string;
  recipeId?: string;
  now?: () => Date;
}

export interface PrepareCapabilityResult {
  planPath: string;
  plan: OperationPlan;
}

export interface FinalizeCapabilityOptions {
  projectRoot: string;
  packsDirectory: string;
  capabilityId: string;
  agent?: string;
  now?: () => Date;
}

export interface FinalizeCapabilityResult {
  capability: string;
  version: string;
  receiptPath: string;
  evidenceFiles: number;
}

function assertCapabilityId(capabilityId: string): void {
  if (!CAPABILITY_ID.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
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

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeProjectPath(path: string): string {
  return path.split(sep).join("/");
}

function boundedPatternRoot(pattern: string): string | undefined {
  const root = pattern.split("/", 1)[0];
  if (!root || root === ".aiba" || /[*?\[\]{}()!+@]/.test(root)) return undefined;
  return root;
}

function assertRecipeSemantics(
  recipe: CapabilityRecipe,
  manifest: CapabilityManifest,
): void {
  const capabilityId = manifest.metadata.id;
  if (
    recipe.spec.capability.id !== capabilityId
    || recipe.spec.capability.version !== manifest.metadata.version
  ) {
    throw new AibaError(
      `Recipe ${recipe.metadata.id} targets ${recipe.spec.capability.id}@${recipe.spec.capability.version}, not ${capabilityId}@${manifest.metadata.version}`,
      "RECIPE_CAPABILITY_MISMATCH",
    );
  }

  const invariantIds = new Set(manifest.spec.invariants.map((item) => item.id));
  const interfaceIds = new Set(manifest.spec.interfaces);
  const allowedRoots = new Set<string>();
  for (const pattern of recipe.spec.writeScope.allowedPatterns) {
    const root = boundedPatternRoot(pattern);
    if (!root) {
      throw new AibaError(
        `Recipe write pattern must start with a bounded project directory: ${pattern}`,
        "INVALID_RECIPE_WRITE_SCOPE",
      );
    }
    allowedRoots.add(root);
  }
  const recipeInvariantIds = recipe.spec.evidence.map((item) => item.invariant);
  const duplicateEvidence = duplicates(recipeInvariantIds);
  if (duplicateEvidence.length > 0) {
    throw new AibaError(
      `Recipe ${recipe.metadata.id} repeats evidence guidance for ${duplicateEvidence.join(", ")}`,
      "DUPLICATE_RECIPE_EVIDENCE",
    );
  }

  for (const operation of recipe.spec.operations) {
    const unknownInvariants = operation.invariants.filter((id) => !invariantIds.has(id));
    const unknownInterfaces = operation.requiredInterfaces.filter((id) => !interfaceIds.has(id));
    if (unknownInvariants.length > 0 || unknownInterfaces.length > 0) {
      throw new AibaError(
        `Recipe operation ${operation.id} references unknown contract members`,
        "UNKNOWN_RECIPE_CONTRACT_MEMBER",
      );
    }
  }

  const uncovered = [...invariantIds].filter((id) => !recipeInvariantIds.includes(id));
  const unknownEvidence = recipeInvariantIds.filter((id) => !invariantIds.has(id));
  if (uncovered.length > 0 || unknownEvidence.length > 0) {
    throw new AibaError(
      `Recipe ${recipe.metadata.id} evidence guidance does not match capability invariants`,
      "RECIPE_EVIDENCE_MISMATCH",
    );
  }
  for (const evidence of recipe.spec.evidence) {
    for (const suggestion of evidence.suggestions) {
      const root = boundedPatternRoot(suggestion.pathPattern);
      if (!root || !allowedRoots.has(root)) {
        throw new AibaError(
          `Evidence suggestion is outside recipe write scope: ${suggestion.pathPattern}`,
          "RECIPE_EVIDENCE_OUTSIDE_WRITE_SCOPE",
        );
      }
    }
  }
}

function recipeMatchesProject(
  recipe: CapabilityRecipe,
  languages: string[],
  frameworks: string[],
): boolean {
  return recipe.spec.compatibility.languages.every((item) => languages.includes(item))
    && recipe.spec.compatibility.frameworks.every((item) => frameworks.includes(item));
}

async function selectRecipe(
  packsDirectory: string,
  manifest: CapabilityManifest,
  languages: string[],
  frameworks: string[],
  requestedId?: string,
): Promise<{ recipe: CapabilityRecipe; path: string }> {
  const capabilityId = manifest.metadata.id;
  const recipesDirectory = join(resolve(packsDirectory), capabilityId, "recipes");
  const ids = requestedId
    ? [requestedId]
    : (await readdir(recipesDirectory, { withFileTypes: true }).catch((error: unknown) => {
      throw new AibaError(
        `Cannot discover recipes for ${capabilityId}`,
        "CAPABILITY_RECIPES_NOT_FOUND",
        { cause: error },
      );
    }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name.slice(0, -5))
      .sort();

  const matches: Array<{ recipe: CapabilityRecipe; path: string }> = [];
  for (const id of ids) {
    const recipe = await loadCapabilityRecipe(packsDirectory, capabilityId, id);
    assertRecipeSemantics(recipe, manifest);
    if (recipeMatchesProject(recipe, languages, frameworks)) {
      matches.push({
        recipe,
        path: join(recipesDirectory, `${id}.yaml`),
      });
    }
  }

  if (matches.length === 0) {
    throw new AibaError(
      `No compatible recipe found for ${capabilityId}`,
      "COMPATIBLE_RECIPE_NOT_FOUND",
    );
  }
  if (matches.length > 1) {
    throw new AibaError(
      `Multiple compatible recipes found for ${capabilityId}: ${matches.map(({ recipe }) => recipe.metadata.id).join(", ")}`,
      "RECIPE_SELECTION_REQUIRED",
    );
  }
  return matches[0] as { recipe: CapabilityRecipe; path: string };
}

function assertDependenciesInstalled(
  project: ProjectManifest,
  manifest: CapabilityManifest,
): void {
  for (const dependency of manifest.spec.dependencies) {
    if (dependency.optional) continue;
    const installed = project.capabilities.find((item) => item.id === dependency.id);
    if (!installed || !satisfies(installed.version, dependency.version)) {
      throw new AibaError(
        `${manifest.metadata.id} requires ${dependency.id}@${dependency.version}`,
        "CAPABILITY_DEPENDENCY_UNSATISFIED",
      );
    }
  }
}

function assertNotInstalled(project: ProjectManifest, capabilityId: string): void {
  if (project.capabilities.some((item) => item.id === capabilityId)) {
    throw new AibaError(
      `Capability ${capabilityId} is already installed`,
      "CAPABILITY_ALREADY_INSTALLED",
    );
  }
}

export async function prepareCapability(
  options: PrepareCapabilityOptions,
): Promise<PrepareCapabilityResult> {
  assertCapabilityId(options.capabilityId);
  const root = resolve(options.projectRoot);
  const project = await loadProjectManifest(root);
  assertNotInstalled(project, options.capabilityId);

  const manifest = await loadCapabilityManifest(options.packsDirectory, options.capabilityId);
  assertDependenciesInstalled(project, manifest);
  const inspection = await inspectProject(root);
  const languages = inspection.languages.map((item) => item.name);
  const frameworks = inspection.frameworks;
  const { recipe, path: recipePath } = await selectRecipe(
    options.packsDirectory,
    manifest,
    languages,
    frameworks,
    options.recipeId,
  );
  const manifestPath = join(
    resolve(options.packsDirectory),
    options.capabilityId,
    "capability.yaml",
  );
  const guidance = new Map(recipe.spec.evidence.map((item) => [item.invariant, item]));
  const plan: OperationPlan = {
    apiVersion: AIBA_API_VERSION,
    kind: "OperationPlan",
    metadata: {
      id: `${options.capabilityId}-install`,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
    capability: {
      id: options.capabilityId,
      version: manifest.metadata.version,
      manifestSha256: await sha256File(manifestPath),
    },
    recipe: {
      id: recipe.metadata.id,
      version: recipe.metadata.version,
      sha256: await sha256File(recipePath),
    },
    project: {
      name: project.project.name,
      stack: { languages, frameworks },
    },
    writeScope: recipe.spec.writeScope,
    operations: recipe.spec.operations,
    evidence: manifest.spec.invariants.map((invariant) => ({
      invariant: invariant.id,
      requirements: invariant.evidence,
      suggestions: guidance.get(invariant.id)?.suggestions ?? [],
      items: [],
    })),
  };

  const stateDirectory = await resolveExistingProjectPath(root, ".aiba");
  const plansDirectory = join(stateDirectory, "plans");
  const planPath = join(plansDirectory, `${options.capabilityId}.yaml`);
  await mkdir(plansDirectory, { recursive: true });
  try {
    await writeFile(planPath, stringify(plan), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "EEXIST") {
      throw new AibaError(
        `Operation plan already exists at ${planPath}`,
        "OPERATION_PLAN_EXISTS",
      );
    }
    throw error;
  }

  return {
    planPath: normalizeProjectPath(relative(root, planPath)),
    plan,
  };
}

function assertPlanMatchesSources(
  plan: OperationPlan,
  project: ProjectManifest,
  manifest: CapabilityManifest,
  recipe: CapabilityRecipe,
  manifestSha256: string,
  recipeSha256: string,
): void {
  if (
    plan.capability.id !== manifest.metadata.id
    || plan.capability.version !== manifest.metadata.version
    || plan.capability.manifestSha256 !== manifestSha256
  ) {
    throw new AibaError(
      "Operation plan capability source has changed since preparation",
      "STALE_CAPABILITY_PLAN",
    );
  }
  if (
    plan.recipe.id !== recipe.metadata.id
    || plan.recipe.version !== recipe.metadata.version
    || plan.recipe.sha256 !== recipeSha256
  ) {
    throw new AibaError(
      "Operation plan recipe source has changed since preparation",
      "STALE_RECIPE_PLAN",
    );
  }
  if (plan.project.name !== project.project.name) {
    throw new AibaError(
      `Operation plan belongs to project ${plan.project.name}`,
      "PLAN_PROJECT_MISMATCH",
    );
  }

  const guidance = new Map(recipe.spec.evidence.map((item) => [item.invariant, item]));
  const expectedEvidence = manifest.spec.invariants.map((invariant) => ({
    invariant: invariant.id,
    requirements: invariant.evidence,
    suggestions: guidance.get(invariant.id)?.suggestions ?? [],
  }));
  const actualEvidence = plan.evidence.map(({ items: _items, ...item }) => item);
  if (
    !equal(plan.writeScope, recipe.spec.writeScope)
    || !equal(plan.operations, recipe.spec.operations)
    || !equal(actualEvidence, expectedEvidence)
  ) {
    throw new AibaError(
      "Operation plan contract fields were modified after preparation",
      "PLAN_CONTRACT_MODIFIED",
    );
  }
}

async function createReceipt(
  root: string,
  plan: OperationPlan,
  manifest: CapabilityManifest,
  recipe: CapabilityRecipe,
  planPath: string,
  agent: string | undefined,
  createdAt: string,
): Promise<{ receipt: CapabilityReceipt; evidenceFiles: number }> {
  const allowedPatterns = recipe.spec.writeScope.allowedPatterns;
  let evidenceFiles = 0;
  const invariants: CapabilityReceipt["invariants"] = [];

  for (const planned of plan.evidence) {
    const evidence: CapabilityReceipt["invariants"][number]["evidence"] = [];
    for (const item of planned.items) {
      const normalized = normalizeProjectPath(item.path);
      if (normalized === ".aiba" || normalized.startsWith(".aiba/")) {
        throw new AibaError(
          `AIBA project state cannot be installation evidence: ${item.path}`,
          "AIBA_STATE_AS_EVIDENCE",
        );
      }
      if (!allowedPatterns.some((pattern) => minimatch(normalized, pattern, { dot: true }))) {
        throw new AibaError(
          `Evidence path is outside recipe write scope: ${item.path}`,
          "EVIDENCE_OUTSIDE_WRITE_SCOPE",
        );
      }
      const path = await resolveExistingProjectPath(root, item.path);
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        throw new AibaError(`${item.path} is not a file`, "EVIDENCE_NOT_FILE");
      }
      evidence.push({
        ...item,
        sha256: await sha256File(path),
      });
      evidenceFiles += 1;
    }
    invariants.push({ id: planned.invariant, evidence });
  }

  const receipt: CapabilityReceipt = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityReceipt",
    capability: {
      id: manifest.metadata.id,
      version: manifest.metadata.version,
    },
    installation: {
      method: "agent",
      createdAt,
      ...(agent ? { agent } : {}),
      recipe: recipe.metadata.id,
      plan: normalizeProjectPath(relative(root, planPath)),
      planSha256: await sha256File(planPath),
    },
    invariants,
  };
  const issues = await verifyReceiptEvidence(root, manifest, receipt);
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    throw new AibaError(
      `Evidence does not satisfy the capability contract: ${errors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
      "CAPABILITY_EVIDENCE_INVALID",
    );
  }
  return { receipt, evidenceFiles };
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

async function commitProjectState(options: {
  root: string;
  manifest: ProjectManifest;
  lock: ProjectLock;
  receipt: CapabilityReceipt;
  receiptPath: string;
  packsDirectory: string;
  capabilityId: string;
}): Promise<void> {
  const stateDirectory = await resolveExistingProjectPath(options.root, ".aiba");
  const manifestPath = join(stateDirectory, "manifest.yaml");
  const lockPath = join(stateDirectory, "lock.json");
  if (await pathExists(options.receiptPath)) {
    throw new AibaError(
      `Receipt already exists at ${options.receiptPath}`,
      "CAPABILITY_RECEIPT_EXISTS",
    );
  }

  const originalManifest = await readFile(manifestPath, "utf8");
  const originalLock = await readFile(lockPath, "utf8");
  const suffix = randomUUID();
  const temporaryManifest = join(stateDirectory, `.manifest-${suffix}.tmp`);
  const temporaryLock = join(stateDirectory, `.lock-${suffix}.tmp`);
  const temporaryReceipt = join(stateDirectory, `.receipt-${suffix}.tmp`);
  let receiptLinked = false;
  try {
    await writeFile(temporaryManifest, stringify(options.manifest), { flag: "wx" });
    await writeFile(temporaryLock, `${JSON.stringify(options.lock, null, 2)}\n`, { flag: "wx" });
    await writeFile(temporaryReceipt, stringify(options.receipt), { flag: "wx" });
    await link(temporaryReceipt, options.receiptPath);
    receiptLinked = true;
    await rm(temporaryReceipt);
    await rename(temporaryManifest, manifestPath);
    await rename(temporaryLock, lockPath);

    const report = await verifyProject({
      projectRoot: options.root,
      packsDirectory: options.packsDirectory,
      capabilityId: options.capabilityId,
    });
    if (!report.ok) {
      throw new AibaError(
        `Finalized capability failed verification: ${report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
        "FINALIZED_CAPABILITY_INVALID",
      );
    }
  } catch (error) {
    await writeFile(manifestPath, originalManifest);
    await writeFile(lockPath, originalLock);
    if (receiptLinked) await rm(options.receiptPath, { force: true });
    throw error;
  } finally {
    await rm(temporaryManifest, { force: true });
    await rm(temporaryLock, { force: true });
    await rm(temporaryReceipt, { force: true });
  }
}

export async function finalizeCapability(
  options: FinalizeCapabilityOptions,
): Promise<FinalizeCapabilityResult> {
  assertCapabilityId(options.capabilityId);
  const root = resolve(options.projectRoot);
  const project = await loadProjectManifest(root);
  const lock = await loadProjectLock(root);
  assertNotInstalled(project, options.capabilityId);

  const plan = await loadOperationPlan(root, options.capabilityId);
  const manifest = await loadCapabilityManifest(options.packsDirectory, options.capabilityId);
  const recipe = await loadCapabilityRecipe(
    options.packsDirectory,
    options.capabilityId,
    plan.recipe.id,
  );
  assertRecipeSemantics(recipe, manifest);
  assertDependenciesInstalled(project, manifest);

  const manifestPath = join(
    resolve(options.packsDirectory),
    options.capabilityId,
    "capability.yaml",
  );
  const recipePath = join(
    resolve(options.packsDirectory),
    options.capabilityId,
    "recipes",
    `${recipe.metadata.id}.yaml`,
  );
  const manifestSha256 = await sha256File(manifestPath);
  const recipeSha256 = await sha256File(recipePath);
  assertPlanMatchesSources(
    plan,
    project,
    manifest,
    recipe,
    manifestSha256,
    recipeSha256,
  );

  const stateDirectory = await resolveExistingProjectPath(root, ".aiba");
  const planPath = await resolveExistingProjectPath(
    root,
    `.aiba/plans/${options.capabilityId}.yaml`,
  );
  const receiptPath = join(stateDirectory, "receipts", `${options.capabilityId}.yaml`);
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const { receipt, evidenceFiles } = await createReceipt(
    root,
    plan,
    manifest,
    recipe,
    planPath,
    options.agent,
    createdAt,
  );
  const receiptProjectPath = normalizeProjectPath(relative(root, receiptPath));
  const nextProject: ProjectManifest = {
    ...project,
    capabilities: [...project.capabilities, {
      id: options.capabilityId,
      version: manifest.metadata.version,
      receipt: receiptProjectPath,
    }],
  };
  const nextLock: ProjectLock = {
    ...lock,
    generatedAt: createdAt,
    capabilities: [...lock.capabilities, {
      id: options.capabilityId,
      version: manifest.metadata.version,
      manifestSha256,
      recipe: { id: recipe.metadata.id, sha256: recipeSha256 },
    }],
  };

  await commitProjectState({
    root,
    manifest: nextProject,
    lock: nextLock,
    receipt,
    receiptPath,
    packsDirectory: options.packsDirectory,
    capabilityId: options.capabilityId,
  });
  return {
    capability: options.capabilityId,
    version: manifest.metadata.version,
    receiptPath: receiptProjectPath,
    evidenceFiles,
  };
}
