import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  finalizeCapability,
  initializeProject,
  prepareCapability,
  verifyProject,
} from "../packages/core/dist/index.js";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(workspace, "fixtures", "identity-reference");
const packsDirectory = join(workspace, "capabilities");
const requireFromCore = createRequire(join(workspace, "packages", "core", "package.json"));
const { parse, stringify } = requireFromCore("yaml");
const capabilities = [
  "audit",
  "identity",
  "authorization",
  "users",
  "notification",
  "inbox",
  "verification-challenge",
  "file-assets",
  "scheduled-jobs",
  "feature-flags",
  "i18n",
  "data-dict",
  "form-engine",
  "tags",
  "organization",
  "search",
  "webhooks",
  "comments-activity",
  "import-export",
  "reporting",
  "workflow-approval",
  "wechat-miniprogram-auth",
];

function instant(offset) {
  return () => new Date(Date.UTC(2026, 6, 26, 0, offset, 0));
}

rmSync(join(root, ".aiba"), { recursive: true, force: true });
await initializeProject(root, instant(0));

for (const [index, capabilityId] of capabilities.entries()) {
  const prepared = await prepareCapability({
    projectRoot: root,
    packsDirectory,
    capabilityId,
    recipeId: "typescript-reference",
    now: instant(index * 2 + 1),
  });
  const planPath = join(root, prepared.planPath);
  const plan = parse(readFileSync(planPath, "utf8"));
  for (const invariant of plan.evidence) {
    invariant.items = [
      { type: "source", path: `src/${capabilityId}.ts`, ownership: "shared" },
      { type: "test", path: `src/${capabilityId}.test.ts`, ownership: "shared" },
    ];
  }
  writeFileSync(planPath, stringify(plan));
  await finalizeCapability({
    projectRoot: root,
    packsDirectory,
    capabilityId,
    agent: "fixture-generator",
    now: instant(index * 2 + 2),
  });
}

const report = await verifyProject({ projectRoot: root, packsDirectory });
if (!report.ok) {
  throw new Error(report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
}
process.stdout.write(`Generated and verified ${capabilities.length} core capability receipts.\n`);
