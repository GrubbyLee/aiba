import { spawnSync } from "node:child_process";
import {
  cpSync,
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

function run(name, args, expectedStatus) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    encoding: "utf8",
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

const bundleFixture = mkdtempSync(join(tmpdir(), "aiba-smoke-bundle-"));
const keyDirectory = join(bundleFixture, "keys");
const bundleDirectory = join(bundleFixture, "identity-bundle");
const trustPolicyPath = join(bundleFixture, "trust-policy.json");
const registryDirectory = join(bundleFixture, "registry");
const registryKeys = join(bundleFixture, "registry-keys");
const registryTrustPath = join(bundleFixture, "registry-trust.json");
const registryStatePath = join(bundleFixture, "registry-state.json");
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
mkdirSync(join(registryDirectory, "bundles", "identity"), { recursive: true });
cpSync(
  bundleDirectory,
  join(registryDirectory, "bundles", "identity", "0.1.0"),
  { recursive: true },
);
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
