import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SignedSolutionEnvelope, SolutionPublisherTrustPolicy } from "aiba-spec";
import { generatePublisherKeyPair } from "./bundle.js";
import { signSolution, verifySignedSolution } from "./solution-signing.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];
const created = new Date("2026-08-05T00:00:00.000Z");
const verified = new Date("2026-08-05T00:05:00.000Z");

async function fixture(sequence = 1) {
  const root = await mkdtemp(join(tmpdir(), "aiba-solution-sign-test-"));
  roots.push(root);
  const solutionDirectory = join(root, "secure-workspace");
  await cp(join(workspace, "solutions", "secure-workspace"), solutionDirectory, { recursive: true });
  const keys = await generatePublisherKeyPair({ publisherId: "solution-publisher", keyId: "release-1", outputDirectory: join(root, "keys") });
  const envelopePath = join(root, `solution-${sequence}.signed.json`);
  await signSolution({ solutionDirectory, outputPath: envelopePath, publisherId: "solution-publisher", keyId: "release-1", privateKeyPath: keys.privateKeyPath, sequence, expiresAt: "2026-08-06T00:00:00.000Z", now: () => created });
  const trust: SolutionPublisherTrustPolicy = { apiVersion: "aiba.dev/v0alpha1", kind: "SolutionPublisherTrustPolicy", metadata: { id: "solution-publishers" }, publishers: [{ publisher: "solution-publisher", keyId: "release-1", algorithm: "Ed25519", publicKey: keys.publicKey, solutions: ["secure-workspace"] }] };
  const trustPath = join(root, "trust.json");
  await writeFile(trustPath, `${JSON.stringify(trust, null, 2)}\n`);
  return { root, solutionDirectory, keys, envelopePath, trust, trustPath, statePath: join(root, "state.json") };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("signed Solution distribution", () => {
  it("verifies exact content and records monotonic state", async () => {
    const value = await fixture();
    const result = await verifySignedSolution({ solutionDirectory: value.solutionDirectory, envelopePath: value.envelopePath, trustPolicyPath: value.trustPath, statePath: value.statePath, now: () => verified });
    expect(result).toMatchObject({ ok: true, solution: "secure-workspace", sequence: 1, publisher: "solution-publisher" });
    const state = JSON.parse(await readFile(value.statePath, "utf8")) as { solution: { sequence: number } };
    expect(state.solution.sequence).toBe(1);
  });

  it("rejects content and signature tampering without advancing state", async () => {
    const value = await fixture();
    await writeFile(join(value.solutionDirectory, "solution.yaml"), `${await readFile(join(value.solutionDirectory, "solution.yaml"), "utf8")}\n# tampered\n`);
    await expect(verifySignedSolution({ solutionDirectory: value.solutionDirectory, envelopePath: value.envelopePath, trustPolicyPath: value.trustPath, statePath: value.statePath, now: () => verified })).rejects.toMatchObject({ code: "SIGNED_SOLUTION_HASH_MISMATCH" });
    await expect(readFile(value.statePath)).rejects.toMatchObject({ code: "ENOENT" });

    const clean = await fixture();
    const envelope = JSON.parse(await readFile(clean.envelopePath, "utf8")) as SignedSolutionEnvelope;
    envelope.metadata.sequence = 2;
    await writeFile(clean.envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
    await expect(verifySignedSolution({ solutionDirectory: clean.solutionDirectory, envelopePath: clean.envelopePath, trustPolicyPath: clean.trustPath, now: () => verified })).rejects.toMatchObject({ code: "SIGNED_SOLUTION_SIGNATURE_INVALID" });
  });

  it("enforces publisher allowlists, revocation, and expiry", async () => {
    const value = await fixture();
    value.trust.publishers[0]!.solutions = ["another-solution"];
    await writeFile(value.trustPath, `${JSON.stringify(value.trust, null, 2)}\n`);
    await expect(verifySignedSolution({ solutionDirectory: value.solutionDirectory, envelopePath: value.envelopePath, trustPolicyPath: value.trustPath, now: () => verified })).rejects.toMatchObject({ code: "SOLUTION_PUBLISHER_UNTRUSTED" });
    value.trust.publishers[0]!.solutions = ["secure-workspace"];
    value.trust.publishers[0]!.revokedAt = "2026-08-04T23:59:59.000Z";
    await writeFile(value.trustPath, `${JSON.stringify(value.trust, null, 2)}\n`);
    await expect(verifySignedSolution({ solutionDirectory: value.solutionDirectory, envelopePath: value.envelopePath, trustPolicyPath: value.trustPath, now: () => verified })).rejects.toMatchObject({ code: "SOLUTION_SIGNING_KEY_REVOKED" });
    value.trust.publishers[0]!.revokedAt = undefined;
    await writeFile(value.trustPath, `${JSON.stringify(value.trust, null, 2)}\n`);
    await expect(verifySignedSolution({ solutionDirectory: value.solutionDirectory, envelopePath: value.envelopePath, trustPolicyPath: value.trustPath, now: () => new Date("2026-08-07T00:00:00.000Z") })).rejects.toMatchObject({ code: "SIGNED_SOLUTION_EXPIRED" });
  });

  it("rejects rollback and same-sequence equivocation", async () => {
    const high = await fixture(2);
    await verifySignedSolution({ solutionDirectory: high.solutionDirectory, envelopePath: high.envelopePath, trustPolicyPath: high.trustPath, statePath: high.statePath, now: () => verified });
    const lowPath = join(high.root, "low.json");
    await signSolution({ solutionDirectory: high.solutionDirectory, outputPath: lowPath, publisherId: "solution-publisher", keyId: "release-1", privateKeyPath: high.keys.privateKeyPath, sequence: 1, expiresAt: "2026-08-06T00:00:00.000Z", now: () => created });
    await expect(verifySignedSolution({ solutionDirectory: high.solutionDirectory, envelopePath: lowPath, trustPolicyPath: high.trustPath, statePath: high.statePath, now: () => verified })).rejects.toMatchObject({ code: "SOLUTION_ROLLBACK_REJECTED" });
    const conflictingPath = join(high.root, "conflict.json");
    await signSolution({ solutionDirectory: high.solutionDirectory, outputPath: conflictingPath, publisherId: "solution-publisher", keyId: "release-1", privateKeyPath: high.keys.privateKeyPath, sequence: 2, expiresAt: "2026-08-06T12:00:00.000Z", now: () => created });
    await expect(verifySignedSolution({ solutionDirectory: high.solutionDirectory, envelopePath: conflictingPath, trustPolicyPath: high.trustPath, statePath: high.statePath, now: () => verified })).rejects.toMatchObject({ code: "SOLUTION_EQUIVOCATION_REJECTED" });
  });
});
