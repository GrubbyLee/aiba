import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CapabilityAncestry,
  CapabilityReceipt,
  OperationPlan,
  ProjectLock,
  ProjectManifest,
  SemanticOwnership,
  UpgradePlan,
} from "@aiba/spec";
import { finalizeCapability, prepareCapability } from "./add.js";
import { generatePublisherKeyPair } from "./bundle.js";
import {
  createCapabilityApproval,
  initializeGovernancePolicy,
} from "./governance.js";
import { sha256File } from "./hash.js";
import { initializeProject } from "./init.js";
import { finalizeUpgrade, prepareUpgrade } from "./upgrade.js";
import { verifyProject } from "./verify.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];

interface UpgradeFixture {
  root: string;
  targetPacks: string;
  sourcePath: string;
  testPath: string;
  upgradePlanPath: string;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function installV1(ownership: SemanticOwnership = "shared"): Promise<UpgradeFixture> {
  const root = await mkdtemp(join(tmpdir(), "aiba-upgrade-"));
  roots.push(root);
  const sourcePath = join(root, "src", "reviewAccess.ts");
  const testPath = join(root, "src", "reviewAccess.test.ts");
  const targetPacks = join(root, "target-packs");
  await mkdir(join(root, "src"), { recursive: true });
  await Promise.all([
    cp(
      join(workspace, "fixtures", "review-access-reference", "src", "reviewAccess.ts"),
      sourcePath,
    ),
    cp(
      join(workspace, "fixtures", "review-access-reference", "src", "reviewAccess.test.ts"),
      testPath,
    ),
    cp(
      join(workspace, "fixtures", "capability-packs", "review-access-v2"),
      targetPacks,
      { recursive: true },
    ),
    writeFile(join(root, "package.json"), JSON.stringify({ name: "upgrade-fixture" })),
  ]);
  await initializeProject(root, () => new Date("2026-07-26T00:00:00Z"));
  const prepared = await prepareCapability({
    projectRoot: root,
    packsDirectory: join(workspace, "capabilities"),
    capabilityId: "review-access",
    recipeId: "typescript-reference",
    now: () => new Date("2026-07-26T01:00:00Z"),
  });
  const planPath = join(root, prepared.planPath);
  const plan = parse(await readFile(planPath, "utf8")) as OperationPlan;
  for (const invariant of plan.evidence) {
    invariant.items = [
      { type: "source", path: "src/reviewAccess.ts", ownership },
      { type: "test", path: "src/reviewAccess.test.ts", ownership },
    ];
  }
  await writeFile(planPath, stringify(plan));
  await finalizeCapability({
    projectRoot: root,
    packsDirectory: join(workspace, "capabilities"),
    capabilityId: "review-access",
    agent: "test-agent",
    now: () => new Date("2026-07-26T02:00:00Z"),
  });
  return {
    root,
    targetPacks,
    sourcePath,
    testPath,
    upgradePlanPath: join(root, ".aiba", "plans", "review-access.upgrade.yaml"),
  };
}

async function prepare(fixture: UpgradeFixture): Promise<UpgradePlan> {
  const result = await prepareUpgrade({
    projectRoot: fixture.root,
    targetPacksDirectory: fixture.targetPacks,
    capabilityId: "review-access",
    now: () => new Date("2026-07-26T03:00:00Z"),
  });
  expect(join(fixture.root, result.planPath)).toBe(fixture.upgradePlanPath);
  return result.plan;
}

async function editUpgradePlan(
  fixture: UpgradeFixture,
  edit: (plan: UpgradePlan) => void = () => undefined,
): Promise<UpgradePlan> {
  const plan = parse(await readFile(fixture.upgradePlanPath, "utf8")) as UpgradePlan;
  for (const invariant of plan.evidence) {
    invariant.items = [
      { type: "source", path: "src/reviewAccess.ts", ownership: "shared" },
      { type: "test", path: "src/reviewAccess.test.ts", ownership: "shared" },
    ];
  }
  edit(plan);
  await writeFile(fixture.upgradePlanPath, stringify(plan));
  return plan;
}

async function stateBytes(root: string): Promise<Record<string, string>> {
  const paths = [
    ".aiba/manifest.yaml",
    ".aiba/lock.json",
    ".aiba/receipts/review-access.yaml",
    ".aiba/ancestry/review-access.json",
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    await readFile(join(root, path), "utf8"),
  ])));
}

describe("customization-aware capability upgrade", () => {
  it("upgrades a clean v1 installation and records target provenance", async () => {
    const fixture = await installV1();
    const prepared = await prepare(fixture);
    expect(prepared).toMatchObject({
      capability: { id: "review-access", fromVersion: "0.1.0", toVersion: "0.2.0" },
      recipe: { id: "typescript-reference", fromVersion: "0.1.0", toVersion: "0.2.0" },
      migration: { id: "bind-review-access-to-release", version: "0.2.0" },
    });
    expect(prepared.drift.every((file) => file.conflict === "none")).toBe(true);
    expect(prepared.evidence.find((item) => item.invariant === "review-is-release-bound")?.items)
      .toEqual([]);
    await editUpgradePlan(fixture);

    const result = await finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
      agent: "codex",
      now: () => new Date("2026-07-26T04:00:00Z"),
    });
    const project = parse(
      await readFile(join(fixture.root, ".aiba", "manifest.yaml"), "utf8"),
    ) as ProjectManifest;
    const lock = JSON.parse(
      await readFile(join(fixture.root, ".aiba", "lock.json"), "utf8"),
    ) as ProjectLock;
    const receipt = parse(
      await readFile(join(fixture.root, ".aiba", "receipts", "review-access.yaml"), "utf8"),
    ) as CapabilityReceipt;
    const ancestry = JSON.parse(
      await readFile(join(fixture.root, ".aiba", "ancestry", "review-access.json"), "utf8"),
    ) as CapabilityAncestry;
    const verification = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    });

    expect(result).toMatchObject({
      capability: "review-access",
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      resolvedConflicts: 0,
      evidenceFiles: 20,
    });
    expect(project.capabilities[0]?.version).toBe("0.2.0");
    expect(lock.capabilities[0]).toMatchObject({
      version: "0.2.0",
      manifestSha256: await sha256File(
        join(fixture.targetPacks, "review-access", "capability.yaml"),
      ),
    });
    expect(receipt).toMatchObject({
      capability: { id: "review-access", version: "0.2.0" },
      installation: {
        agent: "codex",
        plan: ".aiba/plans/review-access.upgrade.yaml",
      },
    });
    expect(ancestry).toMatchObject({
      capability: { version: "0.2.0" },
      recipe: { id: "typescript-reference", version: "0.2.0" },
    });
    expect(verification.ok).toBe(true);
  });

  it("enforces upgrade approval and records governance provenance", async () => {
    const fixture = await installV1();
    await prepare(fixture);
    await editUpgradePlan(fixture);
    const keys = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(fixture.root, "alice-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: fixture.root,
      policyId: "upgrade-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: keys.publicKeyPath,
      capabilities: ["review-access"],
    });
    await expect(finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
      agent: "codex",
      now: () => new Date("2026-07-26T04:00:00Z"),
    })).rejects.toMatchObject({ code: "GOVERNANCE_DENIED" });
    const approval = await createCapabilityApproval({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "upgrade",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: keys.privateKeyPath,
      now: () => new Date("2026-07-26T03:30:00Z"),
    });
    await finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
      agent: "codex",
      now: () => new Date("2026-07-26T04:00:00Z"),
    });
    const receipt = parse(
      await readFile(join(fixture.root, ".aiba", "receipts", "review-access.yaml"), "utf8"),
    ) as CapabilityReceipt;
    expect(receipt.installation.governance).toMatchObject({
      operation: "upgrade",
      approvals: [{ path: approval.approvalPath, approver: "alice" }],
    });
  });

  it("requires and records a resolution for customized shared code", async () => {
    const fixture = await installV1();
    await writeFile(fixture.sourcePath, `${await readFile(fixture.sourcePath, "utf8")}\n// project customization\n`);
    const prepared = await prepare(fixture);
    expect(prepared.drift.find((file) => file.path === "src/reviewAccess.ts"))
      .toMatchObject({ status: "customized", conflict: "customized-shared" });
    await editUpgradePlan(fixture, (plan) => {
      const source = plan.drift.find((file) => file.path === "src/reviewAccess.ts");
      if (!source) throw new Error("Source drift is missing");
      source.resolution = {
        action: "preserve",
        rationale: "The project customization already enforces release binding.",
      };
    });

    const result = await finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    });
    expect(result.resolvedConflicts).toBe(1);
    expect(await readFile(fixture.sourcePath, "utf8")).toContain("project customization");
  });

  it("rejects unresolved and missing generated files without partial state writes", async () => {
    const fixture = await installV1("generated");
    await rm(fixture.testPath);
    const before = await stateBytes(fixture.root);
    const prepared = await prepare(fixture);
    expect(prepared.drift.find((file) => file.path === "src/reviewAccess.test.ts"))
      .toMatchObject({ status: "missing", conflict: "missing-generated" });

    await expect(finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "UPGRADE_CONFLICTS_UNRESOLVED" });
    expect(await stateBytes(fixture.root)).toEqual(before);
  });

  it("never turns customized project-owned code into an implicit conflict", async () => {
    const fixture = await installV1("project");
    await writeFile(fixture.sourcePath, `${await readFile(fixture.sourcePath, "utf8")}\n// owner change\n`);
    const prepared = await prepare(fixture);
    expect(prepared.drift.find((file) => file.path === "src/reviewAccess.ts"))
      .toMatchObject({ status: "customized", ownership: "project", conflict: "none" });
    await editUpgradePlan(fixture);

    const result = await finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    });
    expect(result.resolvedConflicts).toBe(0);
    expect(await readFile(fixture.sourcePath, "utf8")).toContain("owner change");
  });

  it.each([
    ["capability", "capability.yaml", "STALE_UPGRADE_CAPABILITY"],
    ["recipe", "recipes/typescript-reference.yaml", "STALE_UPGRADE_SOURCE"],
    ["migration", "migrations/0.1.0-to-0.2.0.yaml", "STALE_UPGRADE_SOURCE"],
  ])("rejects a changed target %s after preparation", async (_source, relativePath, code) => {
    const fixture = await installV1();
    await prepare(fixture);
    await editUpgradePlan(fixture);
    const targetPath = join(fixture.targetPacks, "review-access", relativePath);
    await writeFile(targetPath, `${await readFile(targetPath, "utf8")}\n# changed after prepare\n`);
    const before = await stateBytes(fixture.root);

    await expect(finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code });
    expect(await stateBytes(fixture.root)).toEqual(before);
  });

  it("rejects edits to immutable migration contract fields", async () => {
    const fixture = await installV1();
    await prepare(fixture);
    await editUpgradePlan(fixture, (plan) => {
      const operation = plan.operations[0];
      if (!operation) throw new Error("Migration operation is missing");
      operation.guidance = ["Skip release binding."];
    });
    const before = await stateBytes(fixture.root);

    await expect(finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "UPGRADE_CONTRACT_MODIFIED" });
    expect(await stateBytes(fixture.root)).toEqual(before);
  });

  it("rejects a conflict resolution that does not match the final file state", async () => {
    const fixture = await installV1();
    await writeFile(fixture.sourcePath, `${await readFile(fixture.sourcePath, "utf8")}\n// customized\n`);
    await prepare(fixture);
    await editUpgradePlan(fixture, (plan) => {
      const source = plan.drift.find((file) => file.path === "src/reviewAccess.ts");
      if (!source) throw new Error("Source drift is missing");
      source.resolution = {
        action: "remove",
        rationale: "This claim is inconsistent because the file still exists.",
      };
    });
    const before = await stateBytes(fixture.root);

    await expect(finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "UPGRADE_RESOLUTION_MISMATCH" });
    expect(await stateBytes(fixture.root)).toEqual(before);
  });

  it("binds target recipe version fields to installed and target provenance", async () => {
    const fixture = await installV1();
    await prepare(fixture);
    await editUpgradePlan(fixture, (plan) => {
      plan.recipe.toVersion = "9.9.9";
    });
    const before = await stateBytes(fixture.root);

    await expect(finalizeUpgrade({
      projectRoot: fixture.root,
      targetPacksDirectory: fixture.targetPacks,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "STALE_UPGRADE_SOURCE" });
    expect(await stateBytes(fixture.root)).toEqual(before);
  });
});
