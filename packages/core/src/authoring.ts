import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import {
  AIBA_API_VERSION,
  type CapabilityLayer,
  type CapabilityManifest,
  type CapabilityRecipe,
  type CapabilitySolution,
} from "aiba-spec";
import { assertRecipeSemantics } from "./add.js";
import { AibaError, ProtocolValidationError } from "./errors.js";
import { sha256File } from "./hash.js";
import {
  loadCapabilityManifest,
  loadCapabilityRecipe,
  loadCapabilitySolution,
} from "./loaders.js";
import { resolveSolution } from "./solution.js";

const ID = /^[a-z][a-z0-9-]{1,62}$/;
const ALLOWED_PACK_FILES = new Set(["README.md", "capability.yaml", "SECURITY_TESTS.md"]);

export interface AuthoringIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface AuthoringReport {
  ok: boolean;
  kind: "capability" | "solution";
  id?: string;
  path: string;
  quality: {
    schemaValid: boolean;
    semanticsValid: boolean;
    securityTestsDeclared: boolean;
    score: number;
  };
  issues: AuthoringIssue[];
}

function titleFromId(id: string): string {
  return id.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function assertId(id: string): void {
  if (!ID.test(id)) throw new AibaError(`Invalid authoring identifier: ${id}`, "INVALID_AUTHORING_ID");
}

async function assertNewDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AibaError(`Authoring output already exists: ${path}`, "AUTHORING_OUTPUT_EXISTS");
    }
    throw error;
  }
}

export async function createCapabilityScaffold(options: {
  id: string;
  outputDirectory: string;
  layer?: Exclude<CapabilityLayer, "industry-solution">;
  language?: string;
}): Promise<{ directory: string; files: string[] }> {
  assertId(options.id);
  const root = resolve(options.outputDirectory);
  const directory = join(root, options.id);
  await assertNewDirectory(directory);
  await mkdir(join(directory, "recipes"));
  const title = titleFromId(options.id);
  const invariant = `${options.id}-is-bounded`;
  const manifest: CapabilityManifest = {
    apiVersion: AIBA_API_VERSION,
    kind: "Capability",
    metadata: {
      id: options.id,
      version: "0.1.0",
      title,
      description: `${title} semantics with explicit trust boundaries and verifiable evidence.`,
      layer: options.layer ?? "business-capability",
    },
    spec: {
      interfaces: [`${options.id}.command`, `${options.id}.record`],
      dependencies: [],
      invariants: [{
        id: invariant,
        title: `${title} is bounded`,
        description: `${title} operations enforce trusted scope, validation, and failure behavior.`,
        severity: "critical",
        evidence: {
          acceptedTypes: ["source", "test", "config", "document"],
          requiredTypes: ["source", "test"],
          minimum: 2,
          requireHash: true,
        },
      }],
    },
  };
  const recipe: CapabilityRecipe = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityRecipe",
    metadata: {
      id: "reference",
      version: "0.1.0",
      title: `${title} Reference Recipe`,
      description: `Framework-neutral guidance for adapting ${title}.`,
    },
    spec: {
      capability: { id: options.id, version: "0.1.0" },
      compatibility: { languages: [options.language ?? "TypeScript"], frameworks: [] },
      writeScope: { allowedPatterns: ["src/**", "test/**", "tests/**"] },
      operations: [{
        id: `implement-${options.id}`,
        intent: `Implement the ${title} contract within trusted project boundaries.`,
        requiredInterfaces: [...manifest.spec.interfaces],
        invariants: [invariant],
        guidance: [
          "Derive authorization and tenant scope from trusted server state.",
          "Add positive, denial, boundary, replay, and malformed-input tests.",
        ],
      }],
      evidence: [{
        invariant,
        suggestions: [
          { type: "source", pathPattern: "src/**", description: `${title} implementation.` },
          { type: "test", pathPattern: "tests/**/*.test.*", description: `${title} conformance and attack tests.` },
        ],
      }],
    },
  };
  const files: Array<[string, string]> = [
    ["capability.yaml", stringify(manifest)],
    ["recipes/reference.yaml", stringify(recipe)],
    ["README.md", `# ${title} Capability\n\nThis pack defines framework-neutral semantics and does not execute project commands.\n`],
    ["SECURITY_TESTS.md", `# Security Test Plan\n\n- [ ] Positive contract path\n- [ ] Authorization and tenant denial\n- [ ] Malformed and oversized input\n- [ ] Replay and concurrency behavior\n- [ ] Secret and sensitive-data redaction\n`],
  ];
  try {
    for (const [path, text] of files) {
      await writeFile(join(directory, path), text, { flag: "wx", mode: 0o644 });
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw new AibaError("Capability scaffold could not be written completely", "AUTHORING_WRITE_FAILED", { cause: error });
  }
  return { directory, files: files.map(([path]) => path) };
}

export async function createSolutionScaffold(options: {
  id: string;
  outputDirectory: string;
  packsDirectory: string;
  capabilities: string[];
}): Promise<{ directory: string; solutionPath: string; capabilities: string[] }> {
  assertId(options.id);
  if (options.capabilities.length === 0 || new Set(options.capabilities).size !== options.capabilities.length) {
    throw new AibaError("Solution scaffold requires unique capability IDs", "INVALID_SOLUTION_CAPABILITIES");
  }
  const entries: CapabilitySolution["spec"]["capabilities"] = [];
  for (const id of options.capabilities) {
    assertId(id);
    const manifest = await loadCapabilityManifest(options.packsDirectory, id);
    entries.push({
      id,
      version: manifest.metadata.version,
      manifestSha256: await sha256File(join(resolve(options.packsDirectory), id, "capability.yaml")),
      purpose: `Provide ${manifest.metadata.title} semantics.`,
    });
  }
  const solution: CapabilitySolution = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilitySolution",
    metadata: {
      id: options.id,
      version: "0.1.0",
      title: titleFromId(options.id),
      description: `Exact, dependency-ordered ${titleFromId(options.id)} composition.`,
      layer: "industry-solution",
    },
    spec: { capabilities: entries },
  };
  await resolveSolution(solution, resolve(options.packsDirectory));
  const directory = join(resolve(options.outputDirectory), options.id);
  await assertNewDirectory(directory);
  const solutionPath = join(directory, "solution.yaml");
  try {
    await writeFile(solutionPath, stringify(solution), { flag: "wx", mode: 0o644 });
    await writeFile(join(directory, "README.md"), `# ${solution.metadata.title}\n\nExact composition; constituent invariants cannot be weakened.\n`, { flag: "wx", mode: 0o644 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw new AibaError("Solution scaffold could not be written completely", "AUTHORING_WRITE_FAILED", { cause: error });
  }
  return { directory, solutionPath, capabilities: entries.map((item) => item.id) };
}

async function safeDirectoryFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new AibaError("Authoring input contains a symlink", "AUTHORING_SYMLINK_FORBIDDEN");
      const absolute = join(directory, entry.name);
      const relative = absolute.slice(root.length + 1).split("\\").join("/");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(relative);
      else throw new AibaError("Authoring input contains a special file", "AUTHORING_SPECIAL_FILE_FORBIDDEN");
    }
  }
  await visit(root);
  return result.sort();
}

export async function lintAuthoringDirectory(options: {
  path: string;
  packsDirectory?: string;
  requireSecurityTests?: boolean;
}): Promise<AuthoringReport> {
  const root = resolve(options.path);
  const info = await lstat(root).catch((error: unknown) => {
    throw new AibaError("Authoring directory was not found", "AUTHORING_INPUT_NOT_FOUND", { cause: error });
  });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new AibaError("Authoring input must be a regular directory", "INVALID_AUTHORING_INPUT");
  const files = await safeDirectoryFiles(root);
  const kind = files.includes("capability.yaml") ? "capability" : files.includes("solution.yaml") ? "solution" : undefined;
  if (!kind) throw new AibaError("Directory has no capability.yaml or solution.yaml", "AUTHORING_KIND_UNKNOWN");
  const issues: AuthoringIssue[] = [];
  let id: string | undefined;
  let schemaValid = true;
  let semanticsValid = true;
  let securityTestsDeclared = kind === "solution";
  try {
    if (kind === "capability") {
      id = basename(root);
      const packs = dirname(root);
      const manifest = await loadCapabilityManifest(packs, id);
      const recipeFiles = files.filter((path) => path.startsWith("recipes/") && path.endsWith(".yaml"));
      if (recipeFiles.length === 0) issues.push({ level: "error", code: "AUTHORING_RECIPE_REQUIRED", message: "Capability needs at least one recipe." });
      for (const path of recipeFiles) {
        const recipeId = basename(path, ".yaml");
        const recipe = await loadCapabilityRecipe(packs, id, recipeId);
        assertRecipeSemantics(recipe, manifest);
        const invariantIds = new Set(manifest.spec.invariants.map((item) => item.id));
        const operationCoverage = new Set(recipe.spec.operations.flatMap((item) => item.invariants));
        const testCoverage = new Set(recipe.spec.evidence.filter((item) => item.suggestions.some((entry) => entry.type === "test")).map((item) => item.invariant));
        for (const invariantId of invariantIds) {
          if (!operationCoverage.has(invariantId)) issues.push({ level: "error", code: "AUTHORING_INVARIANT_OPERATION_MISSING", message: `Invariant ${invariantId} has no operation.` });
          if (!testCoverage.has(invariantId)) issues.push({ level: "error", code: "AUTHORING_INVARIANT_TEST_MISSING", message: `Invariant ${invariantId} has no test evidence suggestion.` });
        }
      }
      if (!manifest.spec.invariants.some((item) => item.severity === "critical")) issues.push({ level: "error", code: "AUTHORING_CRITICAL_INVARIANT_REQUIRED", message: "Capability needs at least one critical invariant." });
      securityTestsDeclared = files.includes("SECURITY_TESTS.md") && (await readFile(join(root, "SECURITY_TESTS.md"), "utf8")).includes("Malformed");
      for (const path of files) {
        if (path.startsWith("recipes/") && path.endsWith(".yaml")) continue;
        const migration = /^migrations\/[a-zA-Z0-9.-]+\.yaml$/.test(path);
        if ((!ALLOWED_PACK_FILES.has(path) && !migration) || /\.(?:js|cjs|mjs|sh|exe|dll|so)$/i.test(path)) issues.push({ level: "error", code: "AUTHORING_FORBIDDEN_FILE", message: `Forbidden pack file ${path}.`, path });
      }
    } else {
      id = basename(root);
      const solution = await loadCapabilitySolution(dirname(root), id);
      if (!options.packsDirectory) issues.push({ level: "error", code: "AUTHORING_PACKS_REQUIRED", message: "Solution lint requires packsDirectory." });
      else await resolveSolution(solution, resolve(options.packsDirectory));
      for (const path of files) if (!new Set(["solution.yaml", "README.md"]).has(path)) issues.push({ level: "error", code: "AUTHORING_FORBIDDEN_FILE", message: `Forbidden Solution file ${path}.`, path });
    }
  } catch (error) {
    if (error instanceof ProtocolValidationError) schemaValid = false;
    else semanticsValid = false;
    issues.push({ level: "error", code: error instanceof AibaError ? error.code : "AUTHORING_INVALID", message: error instanceof Error ? error.message : String(error) });
  }
  if (options.requireSecurityTests && !securityTestsDeclared) issues.push({ level: "error", code: "AUTHORING_SECURITY_TEST_PLAN_REQUIRED", message: "Capability needs a concrete SECURITY_TESTS.md plan." });
  const errors = issues.filter((item) => item.level === "error").length;
  return {
    ok: errors === 0,
    kind,
    ...(id ? { id } : {}),
    path: root,
    quality: {
      schemaValid,
      semanticsValid,
      securityTestsDeclared,
      score: Math.max(0, 100 - errors * 20 - issues.filter((item) => item.level === "warning").length * 5),
    },
    issues,
  };
}
