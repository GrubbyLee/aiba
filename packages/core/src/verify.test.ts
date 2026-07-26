import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { CapabilityReceipt } from "@aiba/spec";
import { describe, expect, it } from "vitest";
import { sha256File } from "./hash.js";
import { loadCapabilityManifest } from "./loaders.js";
import { verifyProject } from "./verify.js";

async function createFixture(): Promise<{ root: string; packs: string; evidence: string }> {
  const root = await mkdtemp(join(tmpdir(), "aiba-verify-"));
  const packs = join(root, "packs");
  const evidence = join(root, "src", "review.ts");
  await mkdir(join(root, ".aiba", "receipts"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(packs, "review-access"), { recursive: true });
  await writeFile(evidence, "export const reviewer = true;\n");
  const hash = await sha256File(evidence);

  await writeFile(join(packs, "review-access", "capability.yaml"), stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Capability",
    metadata: {
      id: "review-access",
      version: "0.1.0",
      title: "Review access",
      description: "A test capability",
    },
    spec: {
      interfaces: ["identity.principal"],
      dependencies: [],
      invariants: [{
        id: "server-authoritative-enable",
        title: "Server authority",
        description: "Only the server enables reviewer access.",
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
  const manifestHash = await sha256File(
    join(packs, "review-access", "capability.yaml"),
  );
  await writeFile(join(root, ".aiba", "manifest.yaml"), stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Project",
    project: { name: "fixture" },
    capabilities: [{
      id: "review-access",
      version: "0.1.0",
      receipt: ".aiba/receipts/review-access.yaml",
    }],
  }));
  await writeFile(join(root, ".aiba", "receipts", "review-access.yaml"), stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "CapabilityReceipt",
    capability: { id: "review-access", version: "0.1.0" },
    installation: { method: "manual", createdAt: "2026-07-26T00:00:00Z" },
    invariants: [{
      id: "server-authoritative-enable",
      evidence: [{ type: "source", path: "src/review.ts", sha256: hash }],
    }],
  }));
  await writeFile(join(root, ".aiba", "lock.json"), JSON.stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Lock",
    generatedAt: "2026-07-26T00:00:00Z",
    capabilities: [{
      id: "review-access",
      version: "0.1.0",
      manifestSha256: manifestHash,
    }],
  }));
  return { root, packs, evidence };
}

describe("verifyProject", () => {
  it("accepts complete, hashed evidence", async () => {
    const fixture = await createFixture();
    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("rejects capability identifiers that can traverse directories", async () => {
    const fixture = await createFixture();
    await expect(loadCapabilityManifest(fixture.packs, "../review-access"))
      .rejects.toMatchObject({ code: "INVALID_CAPABILITY_ID" });
  });

  it("rejects evidence changed after the receipt", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.evidence, "export const reviewer = false;\n");
    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "EVIDENCE_HASH_MISMATCH",
    }));
  });

  it("rejects evidence paths outside the project", async () => {
    const fixture = await createFixture();
    const receiptPath = join(fixture.root, ".aiba", "receipts", "review-access.yaml");
    const receipt = await import("node:fs/promises").then(({ readFile }) => readFile(receiptPath, "utf8"));
    await writeFile(receiptPath, receipt.replace("src/review.ts", "../../../etc/passwd"));
    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.code).toBe("PROTOCOL_VALIDATION_FAILED");
  });

  it("requires a provenance hash whenever a plan path is present", async () => {
    const fixture = await createFixture();
    const receiptPath = join(fixture.root, ".aiba", "receipts", "review-access.yaml");
    const receipt = parse(await readFile(receiptPath, "utf8")) as CapabilityReceipt;
    receipt.installation.plan = ".aiba/plans/review-access.yaml";
    await writeFile(receiptPath, stringify(receipt));

    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.code).toBe("PROTOCOL_VALIDATION_FAILED");
  });

  it("rejects a capability pack changed after installation", async () => {
    const fixture = await createFixture();
    const manifestPath = join(fixture.packs, "review-access", "capability.yaml");
    const source = await import("node:fs/promises")
      .then(({ readFile }) => readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, source.replace("Review access", "Changed review access"));

    const report = await verifyProject({
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
    });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "CAPABILITY_MANIFEST_HASH_MISMATCH",
    }));
  });
});
