import { randomUUID, sign, verify } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  AIBA_API_VERSION,
  type BehaviorChallenge,
  type BehaviorProof,
  type BehaviorRunnerTrustPolicy,
  type CapabilityReceipt,
} from "aiba-spec";
import { AibaError } from "./errors.js";
import { sha256File, sha256Text } from "./hash.js";
import {
  loadCapabilityReceipt,
  loadCapabilitySolution,
  loadProjectManifest,
} from "./loaders.js";
import { resolveExistingProjectPath } from "./paths.js";
import { checkSolution } from "./solution.js";
import {
  canonicalDocument,
  loadEd25519PrivateKey,
  loadEd25519PublicKey,
} from "./signing.js";
import {
  validateBehaviorChallenge,
  validateBehaviorProof,
  validateBehaviorRunnerTrustPolicy,
} from "./validation.js";
import { verifyProject } from "./verify.js";

const CHALLENGE_DOMAIN = "aiba.dev/behavior-proof/v0alpha1\0";
const SUBJECT_ID = /^[a-z][a-z0-9-]{1,95}$/;
const TEST_ID = /^[a-z][a-z0-9-]{1,95}$/;

export interface PrepareBehaviorChallengeOptions {
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
  subjectKind: "capability" | "solution";
  subjectId: string;
  runnerId: string;
  keyId: string;
  testId: string;
  command: string;
  ttlSeconds?: number;
  now?: () => Date;
}

export interface CreateBehaviorProofOptions {
  projectRoot: string;
  challengePath: string;
  privateKeyPath: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summaryPath: string;
  now?: () => Date;
}

export interface VerifyBehaviorProofOptions {
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
  proofPath: string;
  trustPolicyPath: string;
  command: string;
  summaryPath: string;
  now?: () => Date;
}

export interface BehaviorVerificationReport {
  ok: boolean;
  scope: "trusted-behavior";
  subject: BehaviorProof["statement"]["subject"];
  runner: BehaviorProof["statement"]["runner"];
  test: string;
  snapshotSha256: string;
  issues: Array<{ code: string; message: string }>;
}

function assertId(value: string, label: string, pattern = SUBJECT_ID): void {
  if (!pattern.test(value)) throw new AibaError(`Invalid ${label}: ${value}`, "INVALID_IDENTIFIER");
}

function projectPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

async function readJson(path: string, label: string): Promise<unknown> {
  const info = await lstat(path).catch((error: unknown) => {
    throw new AibaError(`Cannot read ${label}`, "DOCUMENT_NOT_FOUND", { cause: error });
  });
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
    throw new AibaError(`${label} must be a size-bounded regular file`, "INVALID_DOCUMENT_PATH");
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new AibaError(`Cannot parse ${label}`, "INVALID_JSON", { cause: error });
  }
}

async function writeJsonAtomic(path: string, value: unknown, replace = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    if (!replace) {
      await writeFile(path, await readFile(temporary), { flag: "wx", mode: 0o644 });
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, path);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AibaError(`Output already exists: ${path}`, "BEHAVIOR_OUTPUT_EXISTS");
    }
    throw error;
  }
}

function trackedReceiptPaths(receiptPath: string, receipt: CapabilityReceipt): string[] {
  const paths = new Set<string>([receiptPath]);
  for (const invariant of receipt.invariants) {
    for (const evidence of invariant.evidence) paths.add(evidence.path);
  }
  if (receipt.installation.plan) paths.add(receipt.installation.plan);
  if (receipt.installation.ancestry) paths.add(receipt.installation.ancestry);
  if (receipt.installation.governance) {
    paths.add(receipt.installation.governance.policy);
    for (const approval of receipt.installation.governance.approvals) paths.add(approval.path);
  }
  return [...paths];
}

async function subjectVersionAndCapabilities(options: {
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
  subjectKind: "capability" | "solution";
  subjectId: string;
}): Promise<{ version: string; capabilities: string[] }> {
  const project = await loadProjectManifest(options.projectRoot);
  if (options.subjectKind === "capability") {
    const installed = project.capabilities.find((item) => item.id === options.subjectId);
    if (!installed) throw new AibaError("Behavior subject is not installed", "BEHAVIOR_SUBJECT_NOT_INSTALLED");
    const report = await verifyProject({
      projectRoot: options.projectRoot,
      packsDirectory: options.packsDirectory,
      capabilityId: options.subjectId,
    });
    if (!report.ok) throw new AibaError("Behavior subject failed evidence verification", "BEHAVIOR_SUBJECT_INVALID");
    return { version: installed.version, capabilities: [options.subjectId] };
  }
  const solution = await loadCapabilitySolution(options.solutionsDirectory, options.subjectId);
  const report = await checkSolution({
    solutionId: options.subjectId,
    projectRoot: options.projectRoot,
    packsDirectory: options.packsDirectory,
    solutionsDirectory: options.solutionsDirectory,
  });
  if (!report.ok) throw new AibaError("Behavior Solution failed evidence verification", "BEHAVIOR_SUBJECT_INVALID");
  return {
    version: solution.metadata.version,
    capabilities: solution.spec.capabilities.map((item) => item.id),
  };
}

export async function computeBehaviorSnapshot(options: {
  projectRoot: string;
  packsDirectory: string;
  solutionsDirectory: string;
  subjectKind: "capability" | "solution";
  subjectId: string;
}): Promise<{ projectName: string; version: string; snapshotSha256: string }> {
  const root = resolve(options.projectRoot);
  const project = await loadProjectManifest(root);
  const resolved = await subjectVersionAndCapabilities({ ...options, projectRoot: root });
  const paths = new Set<string>([".aiba/manifest.yaml", ".aiba/lock.json"]);
  for (const capability of resolved.capabilities) {
    const installed = project.capabilities.find((item) => item.id === capability);
    if (!installed) throw new AibaError(`Missing installed capability ${capability}`, "BEHAVIOR_SUBJECT_NOT_INSTALLED");
    const receipt = await loadCapabilityReceipt(root, installed.receipt);
    for (const path of trackedReceiptPaths(installed.receipt, receipt)) paths.add(path);
  }
  const files: Array<{ path: string; sha256: string }> = [];
  for (const path of [...paths].sort()) {
    if (path.startsWith(".aiba/behavior/")) {
      throw new AibaError("Behavior state cannot be snapshot evidence", "BEHAVIOR_STATE_IN_SNAPSHOT");
    }
    const absolute = await resolveExistingProjectPath(root, path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new AibaError(`Snapshot path is not a regular file: ${path}`, "INVALID_SNAPSHOT_FILE");
    }
    files.push({ path, sha256: await sha256File(absolute) });
  }
  return {
    projectName: project.project.name,
    version: resolved.version,
    snapshotSha256: sha256Text(canonicalDocument(files)),
  };
}

export async function prepareBehaviorChallenge(
  options: PrepareBehaviorChallengeOptions,
): Promise<{ challenge: BehaviorChallenge; challengePath: string }> {
  assertId(options.subjectId, "subject identifier");
  assertId(options.runnerId, "runner identifier");
  assertId(options.keyId, "runner key identifier");
  assertId(options.testId, "test identifier", TEST_ID);
  if (!options.command || options.command.length > 4096 || /[\u0000\r\n]/.test(options.command)) {
    throw new AibaError("Test command must be a bounded single line", "INVALID_TEST_COMMAND");
  }
  const ttlSeconds = options.ttlSeconds ?? 900;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
    throw new AibaError("Challenge TTL must be between 30 and 3600 seconds", "INVALID_CHALLENGE_TTL");
  }
  const now = (options.now ?? (() => new Date()))();
  const snapshot = await computeBehaviorSnapshot(options);
  const challenge: BehaviorChallenge = {
    apiVersion: AIBA_API_VERSION,
    kind: "BehaviorChallenge",
    metadata: {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    },
    project: { name: snapshot.projectName, snapshotSha256: snapshot.snapshotSha256 },
    subject: { kind: options.subjectKind, id: options.subjectId, version: snapshot.version },
    runner: { id: options.runnerId, keyId: options.keyId },
    test: { id: options.testId, commandSha256: sha256Text(options.command) },
  };
  validateBehaviorChallenge(challenge);
  const root = resolve(options.projectRoot);
  const absolute = join(root, ".aiba", "behavior", "challenges", `${challenge.metadata.id}.json`);
  await writeJsonAtomic(absolute, challenge);
  return { challenge, challengePath: projectPath(root, absolute) };
}

function signedProofBytes(unsigned: Pick<BehaviorProof, "apiVersion" | "kind" | "statement">): Buffer {
  return Buffer.from(`${CHALLENGE_DOMAIN}${canonicalDocument(unsigned)}`);
}

export async function createBehaviorProof(
  options: CreateBehaviorProofOptions,
): Promise<{ proof: BehaviorProof; proofPath: string }> {
  if (!Number.isSafeInteger(options.exitCode) || options.exitCode !== 0) {
    throw new AibaError("Only successful tests can produce a behavior proof", "BEHAVIOR_TEST_FAILED");
  }
  const root = resolve(options.projectRoot);
  const challengeAbsolute = await resolveExistingProjectPath(root, options.challengePath);
  const challenge = validateBehaviorChallenge(await readJson(challengeAbsolute, "behavior challenge"));
  const now = (options.now ?? (() => new Date()))();
  if (now.getTime() > Date.parse(challenge.metadata.expiresAt)) {
    throw new AibaError("Behavior challenge has expired", "BEHAVIOR_CHALLENGE_EXPIRED");
  }
  const started = Date.parse(options.startedAt);
  const completed = Date.parse(options.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started < Date.parse(challenge.metadata.createdAt) || completed < started || completed > Date.parse(challenge.metadata.expiresAt) || completed > now.getTime() + 30000) {
    throw new AibaError("Behavior test timestamps do not fit the challenge window", "INVALID_BEHAVIOR_TEST_TIME");
  }
  const summaryAbsolute = await resolveExistingProjectPath(root, options.summaryPath);
  const privateKey = await loadEd25519PrivateKey(options.privateKeyPath);
  const unsigned: Pick<BehaviorProof, "apiVersion" | "kind" | "statement"> = {
    apiVersion: AIBA_API_VERSION,
    kind: "BehaviorProof",
    statement: {
      id: randomUUID(),
      challenge: {
        id: challenge.metadata.id,
        path: options.challengePath,
        sha256: await sha256File(challengeAbsolute),
      },
      project: challenge.project,
      subject: challenge.subject,
      runner: challenge.runner,
      test: {
        ...challenge.test,
        startedAt: new Date(started).toISOString(),
        completedAt: new Date(completed).toISOString(),
        exitCode: 0,
        summarySha256: await sha256File(summaryAbsolute),
      },
    },
  };
  const proof: BehaviorProof = {
    ...unsigned,
    signature: {
      algorithm: "Ed25519",
      keyId: challenge.runner.keyId,
      value: sign(null, signedProofBytes(unsigned), privateKey).toString("base64url"),
    },
  };
  validateBehaviorProof(proof);
  const absolute = join(root, ".aiba", "behavior", "proofs", `${challenge.metadata.id}.json`);
  await writeJsonAtomic(absolute, proof);
  return { proof, proofPath: projectPath(root, absolute) };
}

export async function verifyBehaviorProof(
  options: VerifyBehaviorProofOptions,
): Promise<BehaviorVerificationReport> {
  const root = resolve(options.projectRoot);
  const proofAbsolute = await resolveExistingProjectPath(root, options.proofPath);
  const proof = validateBehaviorProof(await readJson(proofAbsolute, "behavior proof"));
  const report: BehaviorVerificationReport = {
    ok: false,
    scope: "trusted-behavior",
    subject: proof.statement.subject,
    runner: proof.statement.runner,
    test: proof.statement.test.id,
    snapshotSha256: proof.statement.project.snapshotSha256,
    issues: [],
  };
  const issue = (code: string, message: string) => report.issues.push({ code, message });
  let challenge: BehaviorChallenge | undefined;
  try {
    const challengeAbsolute = await resolveExistingProjectPath(root, proof.statement.challenge.path);
    if (await sha256File(challengeAbsolute) !== proof.statement.challenge.sha256) issue("BEHAVIOR_CHALLENGE_HASH_MISMATCH", "Challenge bytes changed after attestation");
    challenge = validateBehaviorChallenge(await readJson(challengeAbsolute, "behavior challenge"));
  } catch (error) {
    issue(error instanceof AibaError ? error.code : "BEHAVIOR_CHALLENGE_INVALID", error instanceof Error ? error.message : String(error));
  }
  const now = (options.now ?? (() => new Date()))();
  if (challenge) {
    if (challenge.metadata.id !== proof.statement.challenge.id || canonicalDocument(challenge.project) !== canonicalDocument(proof.statement.project) || canonicalDocument(challenge.subject) !== canonicalDocument(proof.statement.subject) || canonicalDocument(challenge.runner) !== canonicalDocument(proof.statement.runner) || canonicalDocument(challenge.test) !== canonicalDocument({ id: proof.statement.test.id, commandSha256: proof.statement.test.commandSha256 })) {
      issue("BEHAVIOR_CHALLENGE_MISMATCH", "Proof statement does not exactly match its challenge");
    }
    if (now.getTime() > Date.parse(challenge.metadata.expiresAt)) issue("BEHAVIOR_PROOF_EXPIRED", "Behavior proof challenge is expired");
  }
  if (proof.statement.test.exitCode !== 0) issue("BEHAVIOR_TEST_FAILED", "Behavior test did not pass");
  if (sha256Text(options.command) !== proof.statement.test.commandSha256) issue("BEHAVIOR_COMMAND_MISMATCH", "Test command does not match the challenge");
  try {
    const summary = await resolveExistingProjectPath(root, options.summaryPath);
    if (await sha256File(summary) !== proof.statement.test.summarySha256) issue("BEHAVIOR_SUMMARY_MISMATCH", "Test summary changed after attestation");
  } catch (error) {
    issue(error instanceof AibaError ? error.code : "BEHAVIOR_SUMMARY_INVALID", error instanceof Error ? error.message : String(error));
  }
  try {
    const snapshot = await computeBehaviorSnapshot({
      projectRoot: root,
      packsDirectory: options.packsDirectory,
      solutionsDirectory: options.solutionsDirectory,
      subjectKind: proof.statement.subject.kind,
      subjectId: proof.statement.subject.id,
    });
    if (snapshot.version !== proof.statement.subject.version || snapshot.projectName !== proof.statement.project.name || snapshot.snapshotSha256 !== proof.statement.project.snapshotSha256) issue("BEHAVIOR_SNAPSHOT_STALE", "Project evidence or provenance changed after the test");
  } catch (error) {
    issue(error instanceof AibaError ? error.code : "BEHAVIOR_SNAPSHOT_INVALID", error instanceof Error ? error.message : String(error));
  }
  try {
    const trustAbsolute = resolve(options.trustPolicyPath);
    const trust = validateBehaviorRunnerTrustPolicy(await readJson(trustAbsolute, "runner trust policy"));
    const trusted = trust.runners.find((item) => item.runner === proof.statement.runner.id && item.keyId === proof.statement.runner.keyId);
    if (!trusted || !trusted.subjects.includes("*") && !trusted.subjects.includes(proof.statement.subject.id)) {
      issue("BEHAVIOR_RUNNER_UNTRUSTED", "Runner key is not trusted for this subject");
    } else if (trusted.revokedAt && Date.parse(trusted.revokedAt) <= Date.parse(proof.statement.test.completedAt)) {
      issue("BEHAVIOR_RUNNER_REVOKED", "Runner key was revoked before test completion");
    } else {
      const unsigned = { apiVersion: proof.apiVersion, kind: proof.kind, statement: proof.statement } as const;
      if (proof.signature.keyId !== trusted.keyId || !verify(null, signedProofBytes(unsigned), loadEd25519PublicKey(trusted.publicKey), Buffer.from(proof.signature.value, "base64url"))) issue("BEHAVIOR_SIGNATURE_INVALID", "Behavior proof signature is invalid");
    }
  } catch (error) {
    issue(error instanceof AibaError ? error.code : "BEHAVIOR_TRUST_INVALID", error instanceof Error ? error.message : String(error));
  }
  report.ok = report.issues.length === 0;
  return report;
}
