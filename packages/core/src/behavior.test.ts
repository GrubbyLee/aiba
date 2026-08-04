import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { BehaviorRunnerTrustPolicy } from "aiba-spec";
import { generatePublisherKeyPair } from "./bundle.js";
import {
  createBehaviorProof,
  prepareBehaviorChallenge,
  verifyBehaviorProof,
} from "./behavior.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const packsDirectory = join(workspace, "capabilities");
const solutionsDirectory = join(workspace, "solutions");
const temporaryRoots: string[] = [];
const now = new Date("2026-08-05T00:00:20.000Z");
const command = "pnpm test -- identity";

async function fixture() {
  const container = await mkdtemp(join(tmpdir(), "aiba-behavior-test-"));
  temporaryRoots.push(container);
  const root = join(container, "project");
  await cp(join(workspace, "fixtures", "identity-reference"), root, { recursive: true });
  const keys = await generatePublisherKeyPair({
    publisherId: "ci-runner",
    keyId: "runner-1",
    outputDirectory: join(container, "keys"),
  });
  const summaryPath = "test-results/identity.json";
  await mkdir(join(root, "test-results"));
  await writeFile(join(root, summaryPath), "{\"passed\":12,\"failed\":0}\n");
  const trustPolicyPath = join(container, "runner-trust.json");
  const policy: BehaviorRunnerTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "BehaviorRunnerTrustPolicy",
    metadata: { id: "test-runners" },
    runners: [{
      runner: "ci-runner",
      keyId: "runner-1",
      algorithm: "Ed25519",
      publicKey: keys.publicKey,
      subjects: ["identity"],
    }],
  };
  await writeFile(trustPolicyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const prepared = await prepareBehaviorChallenge({
    projectRoot: root,
    packsDirectory,
    solutionsDirectory,
    subjectKind: "capability",
    subjectId: "identity",
    runnerId: "ci-runner",
    keyId: "runner-1",
    testId: "identity-contract",
    command,
    ttlSeconds: 300,
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  });
  const attested = await createBehaviorProof({
    projectRoot: root,
    challengePath: prepared.challengePath,
    privateKeyPath: keys.privateKeyPath,
    startedAt: "2026-08-05T00:00:05.000Z",
    completedAt: "2026-08-05T00:00:15.000Z",
    exitCode: 0,
    summaryPath,
    now: () => now,
  });
  return { root, keys, summaryPath, trustPolicyPath, policy, prepared, attested };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("trusted behavioral proofs", () => {
  it("binds a trusted successful test to exact project evidence", async () => {
    const value = await fixture();
    const report = await verifyBehaviorProof({
      projectRoot: value.root,
      packsDirectory,
      solutionsDirectory,
      proofPath: value.attested.proofPath,
      trustPolicyPath: value.trustPolicyPath,
      command,
      summaryPath: value.summaryPath,
      now: () => now,
    });
    expect(report.ok).toBe(true);
    expect(report.scope).toBe("trusted-behavior");
  });

  it("rejects changed source, command, and summary bytes", async () => {
    const value = await fixture();
    await writeFile(join(value.root, "src", "identity.ts"), `${await readFile(join(value.root, "src", "identity.ts"), "utf8")}\n// changed\n`);
    await writeFile(join(value.root, value.summaryPath), "{\"passed\":0,\"failed\":12}\n");
    const report = await verifyBehaviorProof({
      projectRoot: value.root,
      packsDirectory,
      solutionsDirectory,
      proofPath: value.attested.proofPath,
      trustPolicyPath: value.trustPolicyPath,
      command: "pnpm test -- fake",
      summaryPath: value.summaryPath,
      now: () => now,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "BEHAVIOR_COMMAND_MISMATCH",
      "BEHAVIOR_SUMMARY_MISMATCH",
      "BEHAVIOR_SUBJECT_INVALID",
    ]));
  });

  it("rejects expired challenges and failed test exits", async () => {
    const value = await fixture();
    await expect(createBehaviorProof({
      projectRoot: value.root,
      challengePath: value.prepared.challengePath,
      privateKeyPath: value.keys.privateKeyPath,
      startedAt: "2026-08-05T00:00:05.000Z",
      completedAt: "2026-08-05T00:00:15.000Z",
      exitCode: 1,
      summaryPath: value.summaryPath,
      now: () => now,
    })).rejects.toMatchObject({ code: "BEHAVIOR_TEST_FAILED" });
    const report = await verifyBehaviorProof({
      projectRoot: value.root,
      packsDirectory,
      solutionsDirectory,
      proofPath: value.attested.proofPath,
      trustPolicyPath: value.trustPolicyPath,
      command,
      summaryPath: value.summaryPath,
      now: () => new Date("2026-08-05T00:06:00.000Z"),
    });
    expect(report.issues.map((issue) => issue.code)).toContain("BEHAVIOR_PROOF_EXPIRED");
  });

  it("rejects untrusted and revoked runner keys", async () => {
    const value = await fixture();
    value.policy.runners[0]!.subjects = ["audit"];
    await writeFile(value.trustPolicyPath, `${JSON.stringify(value.policy, null, 2)}\n`);
    let report = await verifyBehaviorProof({
      projectRoot: value.root,
      packsDirectory,
      solutionsDirectory,
      proofPath: value.attested.proofPath,
      trustPolicyPath: value.trustPolicyPath,
      command,
      summaryPath: value.summaryPath,
      now: () => now,
    });
    expect(report.issues.map((issue) => issue.code)).toContain("BEHAVIOR_RUNNER_UNTRUSTED");
    value.policy.runners[0]!.subjects = ["identity"];
    value.policy.runners[0]!.revokedAt = "2026-08-05T00:00:10.000Z";
    await writeFile(value.trustPolicyPath, `${JSON.stringify(value.policy, null, 2)}\n`);
    report = await verifyBehaviorProof({
      projectRoot: value.root,
      packsDirectory,
      solutionsDirectory,
      proofPath: value.attested.proofPath,
      trustPolicyPath: value.trustPolicyPath,
      command,
      summaryPath: value.summaryPath,
      now: () => now,
    });
    expect(report.issues.map((issue) => issue.code)).toContain("BEHAVIOR_RUNNER_REVOKED");
  });

  it("rejects a proof whose signed statement was modified", async () => {
    const value = await fixture();
    const proofPath = join(value.root, value.attested.proofPath);
    const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
      statement: { test: { summarySha256: string } };
    };
    proof.statement.test.summarySha256 = "0".repeat(64);
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    const report = await verifyBehaviorProof({
      projectRoot: value.root,
      packsDirectory,
      solutionsDirectory,
      proofPath: value.attested.proofPath,
      trustPolicyPath: value.trustPolicyPath,
      command,
      summaryPath: value.summaryPath,
      now: () => now,
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "BEHAVIOR_SUMMARY_MISMATCH",
      "BEHAVIOR_SIGNATURE_INVALID",
    ]));
  });
});
