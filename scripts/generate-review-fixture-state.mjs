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
const packsDirectory = join(workspace, "capabilities");
const requireFromCore = createRequire(join(workspace, "packages", "core", "package.json"));
const { parse, stringify } = requireFromCore("yaml");

const fixtures = [
  {
    root: join(workspace, "fixtures", "review-access-reference"),
    recipeId: "typescript-reference",
    source: "src/reviewAccess.ts",
    test: "src/reviewAccess.test.ts",
  },
  {
    root: join(workspace, "fixtures", "review-access-wechat-native"),
    recipeId: "wechat-native",
    source: "src/server/reviewAccessApi.ts",
    test: "src/reviewAccessHttp.blackbox.test.ts",
  },
];

function instant(minute) {
  return () => new Date(Date.UTC(2026, 7, 3, 0, minute, 0));
}

for (const fixture of fixtures) {
  rmSync(join(fixture.root, ".aiba"), { recursive: true, force: true });
  await initializeProject(fixture.root, instant(0));
  const prepared = await prepareCapability({
    projectRoot: fixture.root,
    packsDirectory,
    capabilityId: "review-access",
    recipeId: fixture.recipeId,
    now: instant(1),
  });
  const planPath = join(fixture.root, prepared.planPath);
  const plan = parse(readFileSync(planPath, "utf8"));
  for (const invariant of plan.evidence) {
    invariant.items = [
      { type: "source", path: fixture.source, ownership: "shared" },
      { type: "test", path: fixture.test, ownership: "shared" },
    ];
  }
  writeFileSync(planPath, stringify(plan));
  await finalizeCapability({
    projectRoot: fixture.root,
    packsDirectory,
    capabilityId: "review-access",
    agent: "fixture-generator",
    now: instant(2),
  });
  const report = await verifyProject({ projectRoot: fixture.root, packsDirectory });
  if (!report.ok) {
    throw new Error(report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }
}

process.stdout.write(`Generated and verified ${fixtures.length} review-access fixture states.\n`);
