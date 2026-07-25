import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(workspace, "packages", "cli", "dist", "index.js");

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
run("verify passing fixture", [
  "verify",
  "review-access",
  "--root",
  "fixtures/review-access-reference",
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
