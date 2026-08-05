import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const listing = runChecked("tar", ["-tzf", artifact.path], root).trim().split(/\r?\n/);
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
  if (!specFiles.includes("package/schema/capability-catalog.schema.json")) {
    throw new Error("aiba-spec does not contain the capability catalog schema");
  }
  const cliFiles = runChecked("tar", ["-tzf", cli.path], root);
  if (!cliFiles.includes("package/capabilities/identity/capability.yaml")) {
    throw new Error("@grubbylee/aiba does not contain official capability packs");
  }
  if (!cliFiles.includes("package/capabilities/file-assets/capability.yaml")) {
    throw new Error("@grubbylee/aiba does not contain the file-assets capability");
  }
  if (!cliFiles.includes("package/capabilities/import-export/capability.yaml")) {
    throw new Error("@grubbylee/aiba does not contain the import-export capability");
  }
  if (!cliFiles.includes("package/capabilities/vehicle-records/capability.yaml")) {
    throw new Error("@grubbylee/aiba does not contain the vehicle-records capability");
  }
  if (!cliFiles.includes("package/capabilities/wechat-miniprogram-auth/capability.yaml")) {
    throw new Error("@grubbylee/aiba does not contain the WeChat Mini Program auth capability");
  }
  for (const capability of [
    "verification-challenge", "scheduled-jobs", "webhooks", "feature-flags",
    "organization", "comments-activity", "search", "reporting", "workflow-approval",
  ]) {
    if (!cliFiles.includes(`package/capabilities/${capability}/capability.yaml`)) {
      throw new Error(`@grubbylee/aiba does not contain the ${capability} capability`);
    }
  }
  if (!cliFiles.includes("package/solutions/vehicle-management/solution.yaml")) {
    throw new Error("@grubbylee/aiba does not contain the vehicle-management solution");
  }
  if (!cliFiles.includes("package/capabilities/catalog.yaml")) {
    throw new Error("@grubbylee/aiba does not contain the official capability catalog");
  }
  if (!specFiles.includes("package/schema/interfaces/file-asset-record.schema.json")) {
    throw new Error("aiba-spec does not contain file-assets interface schemas");
  }
  if (!specFiles.includes("package/schema/interfaces/import-export-job-record.schema.json")) {
    throw new Error("aiba-spec does not contain import-export interface schemas");
  }
  if (!specFiles.includes("package/schema/solution.schema.json")) {
    throw new Error("aiba-spec does not contain the solution schema");
  }
  if (!specFiles.includes("package/schema/interfaces/vehicle-record.schema.json")) {
    throw new Error("aiba-spec does not contain vehicle record interface schemas");
  }
  if (!specFiles.includes("package/schema/interfaces/wechat-miniprogram-login-result.schema.json")) {
    throw new Error("aiba-spec does not contain WeChat Mini Program auth interfaces");
  }
  for (const schema of [
    "verification-challenge-record.schema.json", "scheduled-job-record.schema.json",
    "webhook-delivery-record.schema.json", "feature-flag-evaluation-result.schema.json",
    "organization-membership-record.schema.json", "activity-record.schema.json",
    "search-page.schema.json", "report-run-record.schema.json", "approval-workflow-record.schema.json",
  ]) {
    if (!specFiles.includes(`package/schema/interfaces/${schema}`)) {
      throw new Error(`aiba-spec does not contain ${schema}`);
    }
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
  const executable = join(consumer, "node_modules", ".bin", process.platform === "win32" ? "aiba.cmd" : "aiba");
  if (!existsSync(executable)) throw new Error(`Installed CLI shim is missing: ${executable}`);
  const installedCliEntry = join(consumer, "node_modules", "@grubbylee", "aiba", "dist", "index.js");
  const cliCommand = process.platform === "win32" ? process.execPath : executable;
  const cliPrefix = process.platform === "win32" ? [installedCliEntry] : [];
  const runCli = (args) => runChecked(cliCommand, [...cliPrefix, ...args], consumer);
  const failCli = (args) => spawnSync(cliCommand, [...cliPrefix, ...args], {
    cwd: consumer,
    encoding: "utf8",
    env: process.env,
  });
  const version = readFileSync(join(workspace, "package.json"), "utf8");
  const expectedVersion = JSON.parse(version).version;
  const installedVersion = runCli(["--version"]).trim();
  if (installedVersion !== expectedVersion) {
    throw new Error(`Installed CLI reports ${installedVersion}, expected ${expectedVersion}`);
  }
  runCli(["init", app, "--json"]);
  runCli(["list", "--json"]);
  runCli(["show", "vehicle-management", "--json"]);
  for (const capability of ["verification-challenge", "scheduled-jobs", "webhooks", "feature-flags", "organization", "comments-activity", "search", "reporting", "workflow-approval"]) {
    runCli(["show", capability, "--json"]);
  }
  runCli(["inspect", app, "--json"]);
  runCli(["doctor", "--root", app, "--json"]);
  runCli(["agent-protocol", "--json"]);
  runCli(["add", "vehicle-management", "--solution", "--root", app, "--json"]);
  runCli(["status", "vehicle-management", "--root", app, "--json"]);
  runCli(["add", "identity", "--root", app, "--json"]);
  for (const shell of ["bash", "zsh", "fish"]) {
    const completion = JSON.parse(runCli(["completion", shell, "--json"]));
    if (completion.shell !== shell || !completion.script.includes("aiba")) {
      throw new Error(`Installed CLI returned invalid ${shell} completion`);
    }
  }
  const authored = join(consumer, "authored");
  mkdirSync(authored);
  runCli(["create", "capability", "appointment-booking", "--out", authored, "--json"]);
  const authoredCapability = join(authored, "appointment-booking");
  runCli(["lint", authoredCapability, "--json"]);
  runCli(["test-pack", authoredCapability, "--json"]);
  for (const args of [["show", "missing-capability", "--json"], ["show", "--json"]]) {
    const failure = failCli(args);
    if (failure.status !== 1) throw new Error(`Installed CLI failure returned ${failure.status}`);
    const envelope = JSON.parse(failure.stderr);
    if (envelope.kind !== "AibaErrorEnvelope" || envelope.ok !== false) {
      throw new Error("Installed CLI failure did not return an AibaErrorEnvelope");
    }
  }

  process.stdout.write([
    `Package artifacts: ${artifacts.map((artifact) => basename(artifact.path)).join(", ")}`,
    `External consumer: @grubbylee/aiba@${installedVersion} installed and exercised`,
    "Package verification: ok",
  ].join("\n") + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
