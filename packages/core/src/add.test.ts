import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type {
  CapabilityAncestry,
  CapabilityReceipt,
  OperationPlan,
  ProjectLock,
  ProjectManifest,
} from "@aiba/spec";
import { finalizeCapability, prepareCapability, writeCapabilityState } from "./add.js";
import { diffProject } from "./diff.js";
import { sha256File } from "./hash.js";
import { initializeProject } from "./init.js";
import { verifyProject } from "./verify.js";

async function createFixture(): Promise<{
  root: string;
  packs: string;
  sourcePath: string;
  planPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "aiba-add-"));
  const packs = join(root, "packs");
  const sourcePath = join(root, "src", "review.ts");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(packs, "review-access", "recipes"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "add-fixture" }));
  await writeFile(sourcePath, "export const reviewer = true;\n");
  await writeFile(join(packs, "review-access", "capability.yaml"), stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Capability",
    metadata: {
      id: "review-access",
      version: "0.1.0",
      title: "Review access",
      description: "Test review access capability.",
    },
    spec: {
      interfaces: ["identity.principal"],
      dependencies: [],
      invariants: [{
        id: "reviewer-is-distinct-principal",
        title: "Distinct reviewer",
        description: "Reviewers are distinct principals.",
        severity: "critical",
        evidence: {
          acceptedTypes: ["source"],
          requiredTypes: ["source"],
          minimum: 1,
          requireHash: true,
        },
      }],
    },
  }));
  await writeFile(
    join(packs, "review-access", "recipes", "typescript-reference.yaml"),
    stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "CapabilityRecipe",
      metadata: {
        id: "typescript-reference",
        version: "0.1.0",
        title: "TypeScript review access",
        description: "Test recipe.",
      },
      spec: {
        capability: { id: "review-access", version: "0.1.0" },
        compatibility: { languages: ["TypeScript"], frameworks: [] },
        writeScope: { allowedPatterns: ["src/**"] },
        operations: [{
          id: "implement-review-access",
          intent: "Implement the review access boundary.",
          requiredInterfaces: ["identity.principal"],
          invariants: ["reviewer-is-distinct-principal"],
          guidance: ["Keep reviewer identity distinct."],
        }],
        evidence: [{
          invariant: "reviewer-is-distinct-principal",
          suggestions: [{
            type: "source",
            pathPattern: "src/**/*.ts",
            description: "Review access source.",
          }],
        }],
      },
    }),
  );
  await initializeProject(root, () => new Date("2026-07-26T00:00:00Z"));
  const prepared = await prepareCapability({
    projectRoot: root,
    packsDirectory: packs,
    capabilityId: "review-access",
    now: () => new Date("2026-07-26T01:00:00Z"),
  });
  return {
    root,
    packs,
    sourcePath,
    planPath: join(root, prepared.planPath),
  };
}

async function setEvidence(planPath: string, path: string): Promise<void> {
  const plan = parse(await readFile(planPath, "utf8")) as OperationPlan;
  const invariant = plan.evidence[0];
  if (!invariant) throw new Error("Fixture plan has no invariant");
  invariant.items = [{ type: "source", path }];
  await writeFile(planPath, stringify(plan));
}

describe("capability add lifecycle", () => {
  it("prepares an untrusted operation plan without declaring installation", async () => {
    const fixture = await createFixture();
    const plan = parse(await readFile(fixture.planPath, "utf8")) as OperationPlan;
    const project = parse(
      await readFile(join(fixture.root, ".aiba", "manifest.yaml"), "utf8"),
    ) as ProjectManifest;

    expect(plan).toMatchObject({
      kind: "OperationPlan",
      capability: { id: "review-access", version: "0.1.0" },
      recipe: { id: "typescript-reference", version: "0.1.0" },
      writeScope: { allowedPatterns: ["src/**"] },
    });
    expect(plan.evidence[0]?.items).toEqual([]);
    expect(project.capabilities).toEqual([]);
  });

  it("finalizes valid evidence with Core-computed provenance hashes", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const result = await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });

    const receiptPath = join(fixture.root, result.receiptPath);
    const receipt = parse(await readFile(receiptPath, "utf8")) as CapabilityReceipt;
    const verification = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    expect(result.evidenceFiles).toBe(1);
    expect(receipt.installation).toMatchObject({
      method: "agent",
      agent: "codex",
      recipe: "typescript-reference",
      plan: ".aiba/plans/review-access.yaml",
      ancestry: ".aiba/ancestry/review-access.json",
    });
    expect(receipt.installation.planSha256).toBe(await sha256File(fixture.planPath));
    expect(receipt.invariants[0]?.evidence[0]?.sha256).toBe(
      await sha256File(fixture.sourcePath),
    );
    const ancestry = JSON.parse(await readFile(
      join(fixture.root, receipt.installation.ancestry as string),
      "utf8",
    )) as CapabilityAncestry;
    expect(ancestry.files).toEqual([expect.objectContaining({
      path: "src/review.ts",
      ownership: "shared",
      installedSha256: await sha256File(fixture.sourcePath),
      invariants: ["reviewer-is-distinct-principal"],
      operations: ["implement-review-access"],
    })]);
    expect(verification.ok).toBe(true);
  });

  it("rejects out-of-scope evidence without partially installing", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "package.json");

    await expect(finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "EVIDENCE_OUTSIDE_WRITE_SCOPE" });

    const project = parse(
      await readFile(join(fixture.root, ".aiba", "manifest.yaml"), "utf8"),
    ) as ProjectManifest;
    expect(project.capabilities).toEqual([]);
    await expect(stat(join(fixture.root, ".aiba", "receipts", "review-access.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a stale recipe after preparation", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const recipePath = join(
      fixture.packs,
      "review-access",
      "recipes",
      "typescript-reference.yaml",
    );
    const recipe = await readFile(recipePath, "utf8");
    await writeFile(recipePath, recipe.replace("Test recipe.", "Changed recipe."));

    await expect(finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "STALE_RECIPE_PLAN" });
  });

  it("rejects Agent changes to immutable plan contract fields", async () => {
    const fixture = await createFixture();
    const plan = parse(await readFile(fixture.planPath, "utf8")) as OperationPlan;
    const invariant = plan.evidence[0];
    if (!invariant) throw new Error("Fixture plan has no invariant");
    invariant.requirements.minimum = 2;
    invariant.items = [{ type: "source", path: "src/review.ts" }];
    await writeFile(fixture.planPath, stringify(plan));

    await expect(finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    })).rejects.toMatchObject({ code: "PLAN_CONTRACT_MODIFIED" });
  });

  it("detects recipe source changes after a finalized installation", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    const recipePath = join(
      fixture.packs,
      "review-access",
      "recipes",
      "typescript-reference.yaml",
    );
    const recipe = await readFile(recipePath, "utf8");
    await writeFile(recipePath, recipe.replace("Test recipe.", "Changed recipe."));

    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "RECIPE_HASH_MISMATCH",
    }));
  });

  it("classifies customization, missing files, and source drift", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });

    const clean = await diffProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    expect(clean).toMatchObject({
      ok: true,
      hasDrift: false,
      capabilities: [{
        ancestry: "recorded",
        files: [{ status: "unchanged", ownership: "shared" }],
        sources: { capability: "locked", recipe: "locked" },
      }],
    });

    await writeFile(fixture.sourcePath, "export const reviewer = 'customized';\n");
    const customized = await diffProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(customized.hasDrift).toBe(true);
    expect(customized.capabilities[0]?.files[0]).toMatchObject({ status: "customized" });

    await rm(fixture.sourcePath);
    const missing = await diffProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(missing.capabilities[0]?.files[0]).toMatchObject({ status: "missing" });

    const recipePath = join(
      fixture.packs,
      "review-access",
      "recipes",
      "typescript-reference.yaml",
    );
    const recipe = await readFile(recipePath, "utf8");
    await writeFile(recipePath, recipe.replace("Test recipe.", "Changed recipe."));
    const sourceDrift = await diffProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(sourceDrift.capabilities[0]?.sources.recipe).toBe("changed");
  });

  it("rolls back every replaced state file when post-write verification fails", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const installed = await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    const manifestPath = join(fixture.root, ".aiba", "manifest.yaml");
    const lockPath = join(fixture.root, ".aiba", "lock.json");
    const receiptPath = join(fixture.root, installed.receiptPath);
    const ancestryPath = join(fixture.root, ".aiba", "ancestry", "review-access.json");
    const before = await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(lockPath, "utf8"),
      readFile(receiptPath, "utf8"),
      readFile(ancestryPath, "utf8"),
    ]);
    const manifest = parse(before[0]) as ProjectManifest;
    const lock = JSON.parse(before[1]) as ProjectLock;
    const receipt = parse(before[2]) as CapabilityReceipt;
    const ancestry = JSON.parse(before[3]) as CapabilityAncestry;
    const evidence = receipt.invariants[0]?.evidence[0];
    if (!evidence) throw new Error("Fixture receipt has no evidence");
    evidence.sha256 = "0".repeat(64);

    await expect(writeCapabilityState({
      root: fixture.root,
      manifest,
      lock,
      receipt,
      receiptPath,
      ancestry,
      ancestryPath,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
      replaceExisting: true,
    })).rejects.toMatchObject({ code: "FINALIZED_CAPABILITY_INVALID" });
    expect(await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(lockPath, "utf8"),
      readFile(receiptPath, "utf8"),
      readFile(ancestryPath, "utf8"),
    ])).toEqual(before);
  });

  it("rejects ancestry recipe provenance that disagrees with the loaded pack", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const installed = await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    const receiptPath = join(fixture.root, installed.receiptPath);
    const ancestryPath = join(fixture.root, ".aiba", "ancestry", "review-access.json");
    const ancestry = JSON.parse(await readFile(ancestryPath, "utf8")) as CapabilityAncestry;
    ancestry.recipe.version = "9.9.9";
    await writeFile(ancestryPath, `${JSON.stringify(ancestry, null, 2)}\n`);
    const receipt = parse(await readFile(receiptPath, "utf8")) as CapabilityReceipt;
    receipt.installation.ancestrySha256 = await sha256File(ancestryPath);
    await writeFile(receiptPath, stringify(receipt));

    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "ANCESTRY_RECIPE_VERSION_MISMATCH",
    }));
  });

  it("refuses to classify drift from a tampered ancestry baseline", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    const ancestryPath = join(fixture.root, ".aiba", "ancestry", "review-access.json");
    const ancestry = JSON.parse(await readFile(ancestryPath, "utf8")) as CapabilityAncestry;
    const file = ancestry.files[0];
    if (!file) throw new Error("Fixture ancestry has no files");
    file.ownership = "project";
    await writeFile(ancestryPath, `${JSON.stringify(ancestry, null, 2)}\n`);

    const report = await diffProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    expect(report.ok).toBe(false);
    expect(report.capabilities).toEqual([]);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "CAPABILITY_DIFF_FAILED",
      message: expect.stringContaining("provenance changed"),
    }));
  });
});
