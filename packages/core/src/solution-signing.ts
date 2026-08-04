import { randomUUID, sign, verify } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  AIBA_API_VERSION,
  type SignedSolutionEnvelope,
  type SolutionPublisherTrustPolicy,
  type SolutionVerificationState,
} from "aiba-spec";
import { AibaError } from "./errors.js";
import { sha256File, sha256Text } from "./hash.js";
import { loadCapabilitySolution } from "./loaders.js";
import {
  canonicalDocument,
  loadEd25519PrivateKey,
  loadEd25519PublicKey,
} from "./signing.js";
import {
  validateSignedSolutionEnvelope,
  validateSolutionPublisherTrustPolicy,
  validateSolutionVerificationState,
} from "./validation.js";

const DOMAIN = "aiba.dev/signed-solution/v0alpha1\0";
const ID = /^[a-z][a-z0-9-]{1,95}$/;

function unsignedEnvelope(envelope: SignedSolutionEnvelope) {
  return {
    apiVersion: envelope.apiVersion,
    kind: envelope.kind,
    metadata: envelope.metadata,
    solution: envelope.solution,
    publisher: envelope.publisher,
  } as const;
}

function signedBytes(envelope: SignedSolutionEnvelope): Buffer {
  return Buffer.from(`${DOMAIN}${canonicalDocument(unsignedEnvelope(envelope))}`);
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

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeState(path: string, state: SolutionVerificationState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function signSolution(options: {
  solutionDirectory: string;
  outputPath: string;
  publisherId: string;
  keyId: string;
  privateKeyPath: string;
  sequence: number;
  expiresAt: string;
  now?: () => Date;
}): Promise<{ envelope: SignedSolutionEnvelope; outputPath: string }> {
  if (!ID.test(options.publisherId) || !ID.test(options.keyId)) throw new AibaError("Invalid Solution publisher identity", "INVALID_SOLUTION_PUBLISHER");
  if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) throw new AibaError("Solution sequence must be positive", "INVALID_SOLUTION_SEQUENCE");
  const root = resolve(options.solutionDirectory);
  const id = root.split(/[\\/]/).at(-1)!;
  const solution = await loadCapabilitySolution(dirname(root), id);
  const solutionPath = join(root, "solution.yaml");
  const now = (options.now ?? (() => new Date()))();
  const expires = new Date(options.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires <= now || expires.getTime() - now.getTime() > 366 * 24 * 3600 * 1000) throw new AibaError("Solution expiry must be future and within 366 days", "INVALID_SOLUTION_EXPIRY");
  const unsigned = {
    apiVersion: AIBA_API_VERSION,
    kind: "SignedSolutionEnvelope" as const,
    metadata: { sequence: options.sequence, createdAt: now.toISOString(), expiresAt: expires.toISOString() },
    solution: { id: solution.metadata.id, version: solution.metadata.version, path: "solution.yaml" as const, sha256: await sha256File(solutionPath) },
    publisher: { id: options.publisherId, keyId: options.keyId },
  };
  const placeholder: SignedSolutionEnvelope = { ...unsigned, signature: { algorithm: "Ed25519", keyId: options.keyId, value: "A".repeat(86) } };
  const privateKey = await loadEd25519PrivateKey(options.privateKeyPath);
  const envelope: SignedSolutionEnvelope = {
    ...unsigned,
    signature: { algorithm: "Ed25519", keyId: options.keyId, value: sign(null, signedBytes(placeholder), privateKey).toString("base64url") },
  };
  validateSignedSolutionEnvelope(envelope);
  const output = resolve(options.outputPath);
  await mkdir(dirname(output), { recursive: true });
  try {
    await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AibaError("Signed Solution output exists", "SIGNED_SOLUTION_EXISTS");
    throw error;
  }
  return { envelope, outputPath: output };
}

export async function verifySignedSolution(options: {
  solutionDirectory: string;
  envelopePath: string;
  trustPolicyPath: string;
  statePath?: string;
  now?: () => Date;
}): Promise<{ ok: true; solution: string; version: string; publisher: string; keyId: string; sequence: number; envelopeSha256: string }> {
  const root = resolve(options.solutionDirectory);
  const id = root.split(/[\\/]/).at(-1)!;
  const solution = await loadCapabilitySolution(dirname(root), id);
  const envelopeAbsolute = resolve(options.envelopePath);
  const envelope = validateSignedSolutionEnvelope(await readJson(envelopeAbsolute, "signed Solution envelope"));
  const trust = validateSolutionPublisherTrustPolicy(await readJson(resolve(options.trustPolicyPath), "Solution trust policy"));
  if (envelope.solution.id !== solution.metadata.id || envelope.solution.version !== solution.metadata.version) throw new AibaError("Signed Solution identity does not match content", "SIGNED_SOLUTION_IDENTITY_MISMATCH");
  if (await sha256File(join(root, envelope.solution.path)) !== envelope.solution.sha256) throw new AibaError("Signed Solution content changed", "SIGNED_SOLUTION_HASH_MISMATCH");
  const trusted = trust.publishers.find((item) => item.publisher === envelope.publisher.id && item.keyId === envelope.publisher.keyId);
  if (!trusted || (!trusted.solutions.includes("*") && !trusted.solutions.includes(envelope.solution.id))) throw new AibaError("Solution publisher is not trusted for this Solution", "SOLUTION_PUBLISHER_UNTRUSTED");
  const now = (options.now ?? (() => new Date()))();
  if (now < new Date(envelope.metadata.createdAt) || now > new Date(envelope.metadata.expiresAt)) throw new AibaError("Signed Solution is outside its validity window", "SIGNED_SOLUTION_EXPIRED");
  if (trusted.revokedAt && Date.parse(trusted.revokedAt) <= Date.parse(envelope.metadata.createdAt)) throw new AibaError("Solution signing key was revoked", "SOLUTION_SIGNING_KEY_REVOKED");
  if (envelope.signature.keyId !== trusted.keyId || !verify(null, signedBytes(envelope), loadEd25519PublicKey(trusted.publicKey), Buffer.from(envelope.signature.value, "base64url"))) throw new AibaError("Signed Solution signature is invalid", "SIGNED_SOLUTION_SIGNATURE_INVALID");
  const envelopeSha256 = sha256Text(canonicalDocument(envelope));
  const statePath = options.statePath ? resolve(options.statePath) : undefined;
  if (statePath && await pathExists(statePath)) {
    const state = validateSolutionVerificationState(await readJson(statePath, "Solution verification state"));
    if (state.solution.id !== envelope.solution.id) throw new AibaError("Solution state belongs to another Solution", "SOLUTION_STATE_ID_MISMATCH");
    if (envelope.metadata.sequence < state.solution.sequence) throw new AibaError("Signed Solution sequence is a rollback", "SOLUTION_ROLLBACK_REJECTED");
    if (envelope.metadata.sequence === state.solution.sequence && envelopeSha256 !== state.solution.envelopeSha256) throw new AibaError("Signed Solution sequence has conflicting content", "SOLUTION_EQUIVOCATION_REJECTED");
  }
  if (statePath) {
    await writeState(statePath, {
      apiVersion: AIBA_API_VERSION,
      kind: "SolutionVerificationState",
      solution: { id: envelope.solution.id, sequence: envelope.metadata.sequence, envelopeSha256, verifiedAt: now.toISOString() },
    });
  }
  return { ok: true, solution: envelope.solution.id, version: envelope.solution.version, publisher: envelope.publisher.id, keyId: envelope.publisher.keyId, sequence: envelope.metadata.sequence, envelopeSha256 };
}
