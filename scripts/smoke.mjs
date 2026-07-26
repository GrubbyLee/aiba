import { spawnSync } from "node:child_process";
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
