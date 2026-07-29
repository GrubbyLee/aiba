import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createPackageArtifacts, runChecked, workspace } from "./packages.mjs";

const root = mkdtempSync(join(tmpdir(), "aiba-external-consumer-"));
const artifactsDirectory = join(root, "artifacts");
mkdirSync(artifactsDirectory);

try {
  const artifacts = createPackageArtifacts(artifactsDirectory);
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  const forbidden = /(^|\/)(?:src|node_modules)(\/|$)|\.test\.|\.map$|\.pem$|(^|\/)\.env(?:\.|$)/;
  for (const artifact of artifacts) {
    const listing = runChecked("tar", ["-tzf", artifact.path], root).trim().split("\n");
    for (const path of listing) {
      if (forbidden.test(path)) throw new Error(`${artifact.name} contains forbidden path ${path}`);
    }
    for (const required of ["package/package.json", "package/README.md", "package/LICENSE"]) {
      if (!listing.includes(required)) throw new Error(`${artifact.name} is missing ${required}`);
    }
    const manifestText = runChecked("tar", ["-xOf", artifact.path, "package/package.json"], root);
    if (manifestText.includes("workspace:")) {
      throw new Error(`${artifact.name} contains workspace dependency ranges`);
    }
    const manifest = JSON.parse(manifestText);
    if (manifest.exports?.["."]?.types?.includes("/src/")) {
      throw new Error(`${artifact.name} exports types from omitted source files`);
    }
  }

  const spec = byName.get("aiba-spec");
  const cli = byName.get("@grubbylee/aiba");
  if (!spec || !cli) throw new Error("Required release artifacts were not created");
  const specFiles = runChecked("tar", ["-tzf", spec.path], root);
  if (!specFiles.includes("package/schema/capability.schema.json")) {
    throw new Error("aiba-spec does not contain protocol schemas");
  }
  const cliFiles = runChecked("tar", ["-tzf", cli.path], root);
  if (!cliFiles.includes("package/capabilities/identity/capability.yaml")) {
    throw new Error("@grubbylee/aiba does not contain official capability packs");
  }
  if (!cliFiles.includes("package/GENERATED_OUTPUT_EXCEPTION.md")) {
    throw new Error("@grubbylee/aiba does not contain the generated-output exception");
  }
  const cliEntry = runChecked("tar", ["-xOf", cli.path, "package/dist/index.js"], root);
  if (!cliEntry.startsWith("#!/usr/bin/env node\n")) {
    throw new Error("@grubbylee/aiba CLI shebang is missing");
  }

  const repeatedDirectory = join(root, "repeated-artifacts");
  mkdirSync(repeatedDirectory);
  const repeated = createPackageArtifacts(repeatedDirectory);
  for (const artifact of artifacts) {
    const second = repeated.find((candidate) => candidate.name === artifact.name);
    if (!second) throw new Error(`Repeated pack omitted ${artifact.name}`);
    const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    if (digest(artifact.path) !== digest(second.path)) {
      throw new Error(`${artifact.name} tarball is not reproducible`);
    }
  }

  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  const dependencies = Object.fromEntries(artifacts.map((artifact) => [
    artifact.name,
    `file:${artifact.path}`,
  ]));
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
    name: "aiba-external-consumer-trial",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies,
  }, null, 2)}\n`);
  runChecked("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry=https://registry.npmjs.org/",
  ], consumer);

  writeFileSync(join(consumer, "verify-imports.mjs"), [
    'import { AIBA_API_VERSION, loadProtocolSchema } from "aiba-spec";',
    'import { inspectProject } from "aiba-core";',
    'import { createRegistryServer } from "aiba-registry-server";',
    'if (AIBA_API_VERSION !== "aiba.dev/v0alpha1") throw new Error("bad API version");',
    'if (!loadProtocolSchema("capability.schema.json")) throw new Error("schema unavailable");',
    'if (typeof inspectProject !== "function") throw new Error("Core export unavailable");',
    'if (typeof createRegistryServer !== "function") throw new Error("server export unavailable");',
    'process.stdout.write("library imports: ok\\n");',
    "",
  ].join("\n"));
  runChecked(process.execPath, ["verify-imports.mjs"], consumer);

  const app = join(consumer, "trial-app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeFileSync(join(app, "package.json"), '{"name":"aiba-trial-app","type":"module"}\n');
  writeFileSync(join(app, "tsconfig.json"), '{"compilerOptions":{"strict":true}}\n');
  writeFileSync(join(app, "src/index.ts"), "export {};\n");
  const executable = join(consumer, "node_modules", ".bin", "aiba");
  const version = readFileSync(join(workspace, "package.json"), "utf8");
  const expectedVersion = JSON.parse(version).version;
  const installedVersion = runChecked(executable, ["--version"], consumer).trim();
  if (installedVersion !== expectedVersion) {
    throw new Error(`Installed CLI reports ${installedVersion}, expected ${expectedVersion}`);
  }
  runChecked(executable, ["init", app, "--json"], consumer);
  runChecked(executable, ["inspect", app, "--json"], consumer);
  runChecked(executable, ["add", "identity", "--root", app, "--json"], consumer);

  process.stdout.write([
    `Package artifacts: ${artifacts.map((artifact) => basename(artifact.path)).join(", ")}`,
    `External consumer: @grubbylee/aiba@${installedVersion} installed and exercised`,
    "Package verification: ok",
  ].join("\n") + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
