import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { packageMetadata, workspace } from "./packages.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid Trusted Publishing configuration: ${message}`);
}

const workflowPath = join(workspace, ".github", "workflows", "release.yml");
const workflowText = readFileSync(workflowPath, "utf8");
const workflow = parse(workflowText);
const publishJob = workflow?.jobs?.publish;

assert(workflow?.permissions?.contents === "write", "release workflow must create GitHub Releases");
assert(workflow?.permissions?.["id-token"] === "write", "release workflow must request an OIDC token");
assert(publishJob?.environment === "npm", "publish job must use the npm GitHub Environment");
assert(Array.isArray(publishJob?.steps), "publish job steps are missing");
assert(
  publishJob.steps.some((step) => step?.run === "node scripts/release/publish.mjs --dir artifacts"),
  "publish job must use the integrity-checking publisher",
);
assert(!workflowText.includes("NPM_TOKEN"), "release workflow must not use NPM_TOKEN");
assert(!workflowText.includes("NODE_AUTH_TOKEN"), "release workflow must not use NODE_AUTH_TOKEN");
assert(!workflowText.includes("secrets."), "release workflow must not use repository secrets");

for (const { manifest } of packageMetadata()) {
  assert(manifest.publishConfig?.access === "public", `${manifest.name} must publish publicly`);
  assert(manifest.publishConfig?.provenance === true, `${manifest.name} must enable provenance`);
}

process.stdout.write("Trusted Publishing repository configuration is valid.\n");
