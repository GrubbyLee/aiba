import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(workspace, "packages", "cli", "dist", "index.js");
const requireFromCore = createRequire(join(workspace, "packages", "core", "package.json"));
const { parse, stringify } = requireFromCore("yaml");

function run(name, args, expectedStatus, environment = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  if (result.status !== expectedStatus) {
    process.stderr.write(`${name} failed with status ${result.status}\n`);
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(1);
  }
  process.stdout.write(`${name}: ok\n`);
}

run("inspect", ["inspect", "fixtures/review-access-reference", "--json"], 0);
run("negotiate Agent protocol", ["agent-protocol", "--json"], 0);
run("structured Agent error", ["show", "missing-capability", "--json"], 1);
run("list verified catalog", ["list", "--json"], 0);
run("show verified capability", ["show", "vehicle-records", "--json"], 0);
run("show verified solution", ["show", "vehicle-management", "--json"], 0);

const authoringFixture = mkdtempSync(join(tmpdir(), "aiba-smoke-authoring-"));
run("create capability scaffold", [
  "create", "capability", "appointment-booking", "--out", authoringFixture, "--json",
], 0);
run("lint capability scaffold", ["lint", join(authoringFixture, "appointment-booking"), "--json"], 0);
run("test pack readiness", ["test-pack", join(authoringFixture, "appointment-booking"), "--json"], 0);
run("reject scaffold overwrite", [
  "create", "capability", "appointment-booking", "--out", authoringFixture, "--json",
], 1);
run("create Solution scaffold", [
  "create", "solution", "secure-accounts",
  "--out", authoringFixture,
  "--packs-dir", join(workspace, "capabilities"),
  "--capability", "audit", "identity", "authorization",
  "--json",
], 0);
run("lint Solution scaffold", [
  "lint", join(authoringFixture, "secure-accounts"),
  "--packs-dir", join(workspace, "capabilities"), "--json",
], 0);
rmSync(authoringFixture, { recursive: true, force: true });

const bundleFixture = mkdtempSync(join(tmpdir(), "aiba-smoke-bundle-"));
const keyDirectory = join(bundleFixture, "keys");
const bundleDirectory = join(bundleFixture, "identity-bundle");
const trustPolicyPath = join(bundleFixture, "trust-policy.json");
const registryDirectory = join(bundleFixture, "registry");
const registryKeys = join(bundleFixture, "registry-keys");
const registryTrustPath = join(bundleFixture, "registry-trust.json");
const registryStatePath = join(bundleFixture, "registry-state.json");
const remoteCachePath = join(bundleFixture, "remote-cache");
const remoteStatePath = join(bundleFixture, "remote-state.json");
run("publisher keygen", [
  "keygen",
  "aiba-official",
  "--key-id",
  "root-1",
  "--out",
  keyDirectory,
  "--json",
], 0);
run("pack signed capability", [
  "pack",
  "identity",
  "--publisher",
  "aiba-official",
  "--key-id",
  "root-1",
  "--private-key",
  join(keyDirectory, "private.pem"),
  "--out",
  bundleDirectory,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--json",
], 0);
writeFileSync(trustPolicyPath, `${JSON.stringify({
  apiVersion: "aiba.dev/v0alpha1",
  kind: "PublisherTrustPolicy",
  metadata: { id: "smoke-policy" },
  publishers: [{
    publisher: "aiba-official",
    keyId: "root-1",
    algorithm: "Ed25519",
    publicKey: readFileSync(join(keyDirectory, "public.pem"), "utf8"),
    capabilities: ["identity"],
  }],
}, null, 2)}\n`);
run("verify signed capability bundle", [
  "verify-bundle",
  bundleDirectory,
  "--trust",
  trustPolicyPath,
  "--json",
], 0);
mkdirSync(registryDirectory);
run("import verified registry bundle", [
  "registry-add",
  bundleDirectory,
  "--registry",
  registryDirectory,
  "--publisher-trust",
  trustPolicyPath,
  "--json",
], 0);
run("registry keygen", [
  "keygen",
  "registry-operator",
  "--out",
  registryKeys,
  "--json",
], 0);
writeFileSync(registryTrustPath, `${JSON.stringify({
  apiVersion: "aiba.dev/v0alpha1",
  kind: "CapabilityRegistryTrustPolicy",
  metadata: { id: "smoke-registry-policy" },
  registries: [{
    registry: "local-registry",
    publisher: "registry-operator",
    keyId: "root-1",
    algorithm: "Ed25519",
    publicKey: readFileSync(join(registryKeys, "public.pem"), "utf8"),
  }],
}, null, 2)}\n`);
const registryExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
function createRegistrySnapshot(sequence) {
  run(`create registry index ${sequence}`, [
    "registry-index",
    registryDirectory,
    "--id",
    "local-registry",
    "--publisher",
    "registry-operator",
    "--key-id",
    "root-1",
    "--private-key",
    join(registryKeys, "private.pem"),
    "--publisher-trust",
    trustPolicyPath,
    "--sequence",
    String(sequence),
    "--expires-at",
    registryExpiry,
    "--json",
  ], 0);
}
function resolveRegistry(expectedStatus) {
  run("resolve registry capability", [
    "resolve",
    "identity",
    "--registry",
    registryDirectory,
    "--registry-trust",
    registryTrustPath,
    "--publisher-trust",
    trustPolicyPath,
    "--state",
    registryStatePath,
    "--json",
  ], expectedStatus);
}
createRegistrySnapshot(1);
resolveRegistry(0);
createRegistrySnapshot(2);
resolveRegistry(0);
run("reject missing registry server token", [
  "registry-serve",
  registryDirectory,
  "--registry-trust",
  registryTrustPath,
  "--publisher-trust",
  trustPolicyPath,
  "--token-env",
  "SMOKE_MISSING_REGISTRY_TOKEN",
  "--allow-insecure-localhost",
], 1);
run("reject insecure non-loopback registry server", [
  "registry-serve",
  registryDirectory,
  "--registry-trust",
  registryTrustPath,
  "--publisher-trust",
  trustPolicyPath,
  "--host",
  "0.0.0.0",
], 1, { AIBA_REGISTRY_TOKEN: "smoke-private-token" });
const registryServer = spawn(process.execPath, [
  cli,
  "registry-serve",
  registryDirectory,
  "--registry-trust",
  registryTrustPath,
  "--publisher-trust",
  trustPolicyPath,
  "--port",
  "0",
  "--allow-insecure-localhost",
  "--json",
], {
  env: { ...process.env, AIBA_REGISTRY_TOKEN: "smoke-private-token" },
  stdio: ["ignore", "pipe", "inherit"],
});
const registryPort = await new Promise((resolvePort, reject) => {
  registryServer.once("error", reject);
  registryServer.once("exit", (code) => reject(new Error(`registry server exited early: ${code}`)));
  registryServer.stdout.once("data", (chunk) => {
    const started = JSON.parse(String(chunk).trim());
    resolvePort(started.port);
  });
});
run("fetch authenticated registry capability", [
  "fetch",
  "identity",
  "--registry-url",
  `http://127.0.0.1:${registryPort}`,
  "--registry-trust",
  registryTrustPath,
  "--publisher-trust",
  trustPolicyPath,
  "--cache",
  remoteCachePath,
  "--state",
  remoteStatePath,
  "--allow-insecure-localhost",
  "--json",
], 0, { AIBA_REGISTRY_TOKEN: "smoke-private-token" });
registryServer.kill("SIGTERM");
await new Promise((resolveExit) => registryServer.once("exit", resolveExit));
rmSync(join(registryDirectory, "indexes", "2"), { recursive: true, force: true });
resolveRegistry(1);
writeFileSync(join(bundleDirectory, "pack", "README.md"), "tampered\n");
run("reject tampered capability bundle", [
  "verify-bundle",
  bundleDirectory,
  "--trust",
  trustPolicyPath,
  "--json",
], 1);
rmSync(bundleFixture, { recursive: true, force: true });

const initFixture = mkdtempSync(join(tmpdir(), "aiba-smoke-init-"));
writeFileSync(join(initFixture, "package.json"), '{"name":"smoke-init"}\n');
run("init", ["init", initFixture, "--json"], 0);
rmSync(initFixture, { recursive: true, force: true });

const solutionFixture = mkdtempSync(join(tmpdir(), "aiba-smoke-solution-"));
mkdirSync(join(solutionFixture, "src"));
writeFileSync(join(solutionFixture, "package.json"), '{"name":"smoke-solution"}\n');
copyFileSync(
  join(workspace, "fixtures", "identity-reference", "src", "audit.ts"),
  join(solutionFixture, "src", "audit.ts"),
);
copyFileSync(
  join(workspace, "fixtures", "identity-reference", "src", "audit.test.ts"),
  join(solutionFixture, "src", "audit.test.ts"),
);
run("solution init", ["init", solutionFixture, "--json"], 0);
run("solution doctor", [
  "doctor",
  "--root",
  solutionFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--json",
], 0);
run("solution status ready", [
  "status",
  "vehicle-management",
  "--root",
  solutionFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--solutions-dir",
  join(workspace, "solutions"),
  "--json",
], 0);
const solutionArguments = [
  "vehicle-management",
  "--solution",
  "--root",
  solutionFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--solutions-dir",
  join(workspace, "solutions"),
  "--json",
];
run("solution prepare first constituent", [
  "continue",
  "vehicle-management",
  "--root",
  solutionFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--solutions-dir",
  join(workspace, "solutions"),
  "--json",
], 0);
run("solution status awaiting Agent", [
  "status",
  "vehicle-management",
  "--root",
  solutionFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--solutions-dir",
  join(workspace, "solutions"),
  "--json",
], 0);
run("solution recognize pending constituent", ["add", ...solutionArguments], 0);
const solutionPlanPath = join(solutionFixture, ".aiba", "plans", "audit.yaml");
const solutionPlan = parse(readFileSync(solutionPlanPath, "utf8"));
for (const invariant of solutionPlan.evidence) {
  invariant.items = [
    { type: "source", path: "src/audit.ts" },
    { type: "test", path: "src/audit.test.ts" },
  ];
}
writeFileSync(solutionPlanPath, stringify(solutionPlan));
run("solution finalize first constituent", [
  "continue",
  "vehicle-management",
  "--root",
  solutionFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--solutions-dir",
  join(workspace, "solutions"),
  "--finalize",
  "--agent",
  "smoke-agent",
  "--json",
], 0);
run("solution prepare second constituent", ["add", ...solutionArguments], 0);
rmSync(solutionFixture, { recursive: true, force: true });

const addFixture = mkdtempSync(join(tmpdir(), "aiba-smoke-add-"));
mkdirSync(join(addFixture, "src"));
writeFileSync(join(addFixture, "package.json"), '{"name":"smoke-add"}\n');
copyFileSync(
  join(workspace, "fixtures", "review-access-reference", "src", "reviewAccess.ts"),
  join(addFixture, "src", "reviewAccess.ts"),
);
copyFileSync(
  join(workspace, "fixtures", "review-access-reference", "src", "reviewAccess.test.ts"),
  join(addFixture, "src", "reviewAccess.test.ts"),
);
run("add init", ["init", addFixture, "--json"], 0);
run("add prepare", [
  "add",
  "review-access",
  "--root",
  addFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--json",
], 0);
const planPath = join(addFixture, ".aiba", "plans", "review-access.yaml");
const plan = parse(readFileSync(planPath, "utf8"));
for (const invariant of plan.evidence) {
  invariant.items = [
    { type: "source", path: "src/reviewAccess.ts" },
    { type: "test", path: "src/reviewAccess.test.ts" },
  ];
}
writeFileSync(planPath, stringify(plan));
const approvalKeys = join(addFixture, "approval-keys");
run("approval keygen", [
  "keygen",
  "release-manager",
  "--out",
  approvalKeys,
  "--json",
], 0);
run("initialize governance policy", [
  "policy-init",
  "--root",
  addFixture,
  "--id",
  "smoke-policy",
  "--approver",
  "release-manager",
  "--key-id",
  "root-1",
  "--public-key",
  join(approvalKeys, "public.pem"),
  "--capability",
  "review-access",
  "--json",
], 0);
run("reject unapproved installation", [
  "policy-check",
  "review-access",
  "--root",
  addFixture,
  "--agent",
  "smoke-agent",
  "--json",
], 1);
run("approve installation", [
  "approve",
  "review-access",
  "--root",
  addFixture,
  "--approver",
  "release-manager",
  "--key-id",
  "root-1",
  "--private-key",
  join(approvalKeys, "private.pem"),
  "--json",
], 0);
run("check approved installation", [
  "policy-check",
  "review-access",
  "--root",
  addFixture,
  "--agent",
  "smoke-agent",
  "--json",
], 0);
run("add finalize", [
  "add",
  "review-access",
  "--finalize",
  "--agent",
  "smoke-agent",
  "--root",
  addFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
  "--json",
], 0);
run("verify added capability", [
  "verify",
  "review-access",
  "--root",
  addFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
], 0);
run("diff clean capability", [
  "diff",
  "review-access",
  "--root",
  addFixture,
  "--packs-dir",
  join(workspace, "capabilities"),
], 0);
const targetPacks = join(
  workspace,
  "fixtures",
  "capability-packs",
  "review-access-v2",
);
run("upgrade prepare", [
  "upgrade",
  "review-access",
  "--root",
  addFixture,
  "--packs-dir",
  targetPacks,
  "--json",
], 0);
const upgradePlanPath = join(
  addFixture,
  ".aiba",
  "plans",
  "review-access.upgrade.yaml",
);
const upgradePlan = parse(readFileSync(upgradePlanPath, "utf8"));
for (const invariant of upgradePlan.evidence) {
  invariant.items = [
    { type: "source", path: "src/reviewAccess.ts", ownership: "shared" },
    { type: "test", path: "src/reviewAccess.test.ts", ownership: "shared" },
  ];
}
writeFileSync(upgradePlanPath, stringify(upgradePlan));
run("approve upgrade", [
  "approve",
  "review-access",
  "--upgrade",
  "--root",
  addFixture,
  "--approver",
  "release-manager",
  "--key-id",
  "root-1",
  "--private-key",
  join(approvalKeys, "private.pem"),
  "--json",
], 0);
run("check approved upgrade", [
  "policy-check",
  "review-access",
  "--upgrade",
  "--root",
  addFixture,
  "--agent",
  "smoke-agent",
  "--json",
], 0);
run("upgrade finalize", [
  "upgrade",
  "review-access",
  "--finalize",
  "--agent",
  "smoke-agent",
  "--root",
  addFixture,
  "--packs-dir",
  targetPacks,
  "--json",
], 0);
run("verify upgraded capability", [
  "verify",
  "review-access",
  "--root",
  addFixture,
  "--packs-dir",
  targetPacks,
], 0);
run("diff upgraded capability", [
  "diff",
  "review-access",
  "--root",
  addFixture,
  "--packs-dir",
  targetPacks,
], 0);
rmSync(addFixture, { recursive: true, force: true });

run("verify passing fixture", [
  "verify",
  "review-access",
  "--root",
  "fixtures/review-access-reference",
  "--packs-dir",
  "capabilities",
], 0);
run("verify native WeChat fixture", [
  "verify",
  "review-access",
  "--root",
  "fixtures/review-access-wechat-native",
  "--packs-dir",
  "capabilities",
], 0);
run("verify core capabilities fixture", [
  "verify",
  "--root",
  "fixtures/identity-reference",
  "--packs-dir",
  "capabilities",
], 0);
run("verify vehicle management solution", [
  "compose",
  "vehicle-management",
  "--root",
  "fixtures/identity-reference",
  "--packs-dir",
  "capabilities",
  "--solutions-dir",
  "solutions",
], 0);
run("diff core capabilities fixture", [
  "diff",
  "--root",
  "fixtures/identity-reference",
  "--packs-dir",
  "capabilities",
], 0);
run("reject broken fixture", [
  "verify",
  "review-access",
  "--root",
  "fixtures/review-access-broken",
  "--packs-dir",
  "capabilities",
], 1);
