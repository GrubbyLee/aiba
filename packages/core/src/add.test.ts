import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type {
  CapabilityAncestry,
  CapabilityApproval,
  CapabilityReceipt,
  OperationPlan,
  ProjectLock,
  ProjectManifest,
} from "aiba-spec";
import { finalizeCapability, prepareCapability, writeCapabilityState } from "./add.js";
import { generatePublisherKeyPair } from "./bundle.js";
import { diffProject } from "./diff.js";
import {
  createCapabilityApproval,
  evaluateGovernance,
  initializeGovernancePolicy,
} from "./governance.js";
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

  it("enforces signed governance approvals and records their provenance", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const keys = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(fixture.root, "alice-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: fixture.root,
      policyId: "team-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: keys.publicKeyPath,
      capabilities: ["review-access"],
    });

    await expect(finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    })).rejects.toMatchObject({ code: "GOVERNANCE_DENIED" });

    const signed = await createCapabilityApproval({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: keys.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    });
    const installed = await finalizeCapability({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });
    const receipt = parse(
      await readFile(join(fixture.root, installed.receiptPath), "utf8"),
    ) as CapabilityReceipt;
    expect(receipt.installation.governance).toMatchObject({
      operation: "install",
      policy: ".aiba/governance-policy.json",
      approvals: [{
        path: signed.approvalPath,
        approver: "alice",
        keyId: "root-1",
      }],
    });
    await writeFile(
      join(fixture.root, signed.approvalPath),
      `${await readFile(join(fixture.root, signed.approvalPath), "utf8")} `,
    );
    const verification = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      capabilityId: "review-access",
    });
    expect(verification.ok).toBe(false);
    expect(verification.issues).toContainEqual(expect.objectContaining({
      code: "GOVERNANCE_APPROVAL_HASH_MISMATCH",
    }));
  });

  it("rejects self approval and approval made stale by a plan change", async () => {
    const self = await createFixture();
    await setEvidence(self.planPath, "src/review.ts");
    const selfKeys = await generatePublisherKeyPair({
      publisherId: "codex",
      outputDirectory: join(self.root, "codex-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: self.root,
      policyId: "self-policy",
      approverId: "codex",
      keyId: "root-1",
      publicKeyPath: selfKeys.publicKeyPath,
      capabilities: ["review-access"],
    });
    await createCapabilityApproval({
      projectRoot: self.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "codex",
      keyId: "root-1",
      privateKeyPath: selfKeys.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    });
    const selfEvaluation = await evaluateGovernance({
      projectRoot: self.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });
    expect(selfEvaluation.ok).toBe(false);
    expect(selfEvaluation.issues).toContainEqual(expect.objectContaining({
      code: "SELF_APPROVAL_PROHIBITED",
    }));

    const stale = await createFixture();
    await setEvidence(stale.planPath, "src/review.ts");
    const staleKeys = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(stale.root, "alice-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: stale.root,
      policyId: "stale-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: staleKeys.publicKeyPath,
      capabilities: ["review-access"],
    });
    await createCapabilityApproval({
      projectRoot: stale.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: staleKeys.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    });
    await writeFile(stale.sourcePath, "export const reviewer = 'changed after approval';\n");
    const evidenceChanged = await evaluateGovernance({
      projectRoot: stale.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });
    expect(evidenceChanged.ok).toBe(false);
    expect(evidenceChanged.issues).toContainEqual(expect.objectContaining({
      code: "STALE_CAPABILITY_APPROVAL",
    }));
    await writeFile(stale.sourcePath, "export const reviewer = true;\n");
    const stalePlan = parse(await readFile(stale.planPath, "utf8")) as OperationPlan;
    stalePlan.evidence[0]!.items[0]!.description = "Changed after approval";
    await writeFile(stale.planPath, stringify(stalePlan));
    const staleEvaluation = await evaluateGovernance({
      projectRoot: stale.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });
    expect(staleEvaluation.ok).toBe(false);
    expect(staleEvaluation.issues).toContainEqual(expect.objectContaining({
      code: "STALE_CAPABILITY_APPROVAL",
    }));
  });

  it("requires distinct approvers to satisfy a multi-approval threshold", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const alice = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(fixture.root, "alice-keys"),
    });
    const bob = await generatePublisherKeyPair({
      publisherId: "bob",
      outputDirectory: join(fixture.root, "bob-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: fixture.root,
      policyId: "two-person-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: alice.publicKeyPath,
      capabilities: ["review-access"],
    });
    const policyPath = join(fixture.root, ".aiba", "governance-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as {
      spec: {
        approvers: Array<Record<string, unknown>>;
        requirements: { install: number; upgrade: number; upgradeWithConflicts: number };
      };
    };
    policy.spec.approvers.push({
      id: "bob",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey: bob.publicKey,
      permissions: ["install", "upgrade"],
    });
    policy.spec.requirements.install = 2;
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    await createCapabilityApproval({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: alice.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    });
    await expect(evaluateGovernance({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    })).resolves.toMatchObject({ ok: false, requiredApprovals: 2, validApprovals: 1 });
    await createCapabilityApproval({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "bob",
      keyId: "root-1",
      privateKeyPath: bob.privateKeyPath,
      now: () => new Date("2026-07-26T01:40:00Z"),
    });
    await expect(evaluateGovernance({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    })).resolves.toMatchObject({ ok: true, requiredApprovals: 2, validApprovals: 2 });
  });

  it("rejects mismatched approval keys and tampered signatures", async () => {
    const fixture = await createFixture();
    await setEvidence(fixture.planPath, "src/review.ts");
    const alice = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(fixture.root, "alice-keys"),
    });
    const bob = await generatePublisherKeyPair({
      publisherId: "bob",
      outputDirectory: join(fixture.root, "bob-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: fixture.root,
      policyId: "signature-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: alice.publicKeyPath,
      capabilities: ["review-access"],
    });
    await expect(createCapabilityApproval({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: bob.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    })).rejects.toMatchObject({ code: "APPROVER_PRIVATE_KEY_MISMATCH" });

    const signed = await createCapabilityApproval({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: alice.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    });
    const approvalPath = join(fixture.root, signed.approvalPath);
    const approval = JSON.parse(await readFile(approvalPath, "utf8")) as CapabilityApproval;
    approval.signature.value = `${approval.signature.value.startsWith("A") ? "B" : "A"}${approval.signature.value.slice(1)}`;
    await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
    const evaluation = await evaluateGovernance({
      projectRoot: fixture.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });
    expect(evaluation.ok).toBe(false);
    expect(evaluation.issues).toContainEqual(expect.objectContaining({
      code: "APPROVAL_SIGNATURE_INVALID",
    }));
  });

  it("rejects expired approvals and approvals from an older policy", async () => {
    const expired = await createFixture();
    await setEvidence(expired.planPath, "src/review.ts");
    const expiredKeys = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(expired.root, "alice-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: expired.root,
      policyId: "expiring-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: expiredKeys.publicKeyPath,
      capabilities: ["review-access"],
      approvalTtlSeconds: 60,
    });
    await createCapabilityApproval({
      projectRoot: expired.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: expiredKeys.privateKeyPath,
      now: () => new Date("2026-07-26T01:00:00Z"),
    });
    const expiredEvaluation = await evaluateGovernance({
      projectRoot: expired.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T01:02:00Z"),
    });
    expect(expiredEvaluation.ok).toBe(false);
    expect(expiredEvaluation.issues).toContainEqual(expect.objectContaining({
      code: "APPROVAL_EXPIRED",
    }));

    const changed = await createFixture();
    await setEvidence(changed.planPath, "src/review.ts");
    const changedKeys = await generatePublisherKeyPair({
      publisherId: "alice",
      outputDirectory: join(changed.root, "alice-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: changed.root,
      policyId: "changing-policy",
      approverId: "alice",
      keyId: "root-1",
      publicKeyPath: changedKeys.publicKeyPath,
      capabilities: ["review-access"],
    });
    await createCapabilityApproval({
      projectRoot: changed.root,
      capabilityId: "review-access",
      operation: "install",
      approverId: "alice",
      keyId: "root-1",
      privateKeyPath: changedKeys.privateKeyPath,
      now: () => new Date("2026-07-26T01:30:00Z"),
    });
    const policyPath = join(changed.root, ".aiba", "governance-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as {
      metadata: { version: string };
    };
    policy.metadata.version = "0.1.1";
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const changedEvaluation = await evaluateGovernance({
      projectRoot: changed.root,
      capabilityId: "review-access",
      operation: "install",
      agent: "codex",
      now: () => new Date("2026-07-26T02:00:00Z"),
    });
    expect(changedEvaluation.ok).toBe(false);
    expect(changedEvaluation.issues).toContainEqual(expect.objectContaining({
      code: "STALE_CAPABILITY_APPROVAL",
    }));
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
