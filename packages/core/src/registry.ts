import { randomUUID, sign, verify } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  AIBA_API_VERSION,
  type CapabilityRegistryIndex,
  type CapabilityRegistryIndexSignature,
  type CapabilityRegistryState,
} from "@aiba/spec";
import { rcompare, valid } from "semver";
import { verifyCapabilityBundle } from "./bundle.js";
import { AibaError } from "./errors.js";
import { sha256Text } from "./hash.js";
import {
  canonicalDocument,
  loadEd25519PrivateKey,
  loadEd25519PublicKey,
} from "./signing.js";
import {
  validateCapabilityRegistryIndex,
  validateCapabilityRegistryIndexSignature,
  validateCapabilityRegistryState,
  validateCapabilityRegistryTrustPolicy,
} from "./validation.js";

const IDENTIFIER = /^[a-z][a-z0-9-]{1,95}$/;
const CAPABILITY_ID = /^[a-z][a-z0-9-]{1,62}$/;
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface CreateRegistryIndexOptions {
  registryDirectory: string;
  registryId: string;
  publisherId: string;
  keyId: string;
  privateKeyPath: string;
  publisherTrustPolicyPath: string;
  sequence: number;
  expiresAt: Date;
  now?: () => Date;
}

export interface CreateRegistryIndexResult {
  registry: string;
  sequence: number;
  snapshotDirectory: string;
  entries: number;
  indexSha256: string;
}

export interface ResolveRegistryCapabilityOptions {
  registryDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  statePath: string;
  capabilityId: string;
  version?: string;
  now?: () => Date;
}

export interface ResolveRegistryCapabilityResult {
  registry: string;
  sequence: number;
  indexSha256: string;
  capability: string;
  version: string;
  publisher: string;
  keyId: string;
  bundleDirectory: string;
  packDirectory: string;
  statePath: string;
}

export type CapabilityRegistryEntry = CapabilityRegistryIndex["entries"][number];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntry(
  left: CapabilityRegistryIndex["entries"][number],
  right: CapabilityRegistryIndex["entries"][number],
): number {
  return compareText(left.capability, right.capability)
    || compareText(left.version, right.version);
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new AibaError(`Invalid ${label}: ${value}`, "INVALID_REGISTRY_IDENTIFIER");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path: string, label: string): Promise<unknown> {
  const info = await lstat(path).catch((error: unknown) => {
    throw new AibaError(`Cannot read ${label}: ${path}`, "DOCUMENT_NOT_FOUND", {
      cause: error,
    });
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AibaError(`${label} must be a regular file`, "INVALID_DOCUMENT_PATH");
  }
  if (info.size > MAX_DOCUMENT_SIZE) {
    throw new AibaError(`${label} exceeds size limit`, "DOCUMENT_TOO_LARGE");
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new AibaError(`Cannot parse ${label}: ${path}`, "INVALID_JSON", { cause: error });
  }
}

async function listIndexSequences(registryRoot: string): Promise<number[]> {
  const indexesDirectory = join(registryRoot, "indexes");
  if (!(await pathExists(indexesDirectory))) return [];
  const rootInfo = await lstat(indexesDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AibaError("Registry indexes root must be a regular directory", "INVALID_REGISTRY_LAYOUT");
  }
  const entries = await readdir(indexesDirectory, { withFileTypes: true });
  const sequences: number[] = [];
  for (const entry of entries) {
    const sequence = Number(entry.name);
    const info = await lstat(join(indexesDirectory, entry.name));
    if (
      !entry.isDirectory()
      || info.isSymbolicLink()
      || !Number.isSafeInteger(sequence)
      || sequence < 1
      || String(sequence) !== entry.name
    ) {
      throw new AibaError(
        `Invalid registry index snapshot: ${entry.name}`,
        "INVALID_REGISTRY_LAYOUT",
      );
    }
    sequences.push(sequence);
  }
  return sequences.sort((left, right) => left - right);
}

async function assertSnapshotLayout(snapshotDirectory: string): Promise<void> {
  const info = await lstat(snapshotDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AibaError("Registry snapshot must be a regular directory", "INVALID_REGISTRY_LAYOUT");
  }
  const entries = await readdir(snapshotDirectory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["index.json", "index.sig.json"])) {
    throw new AibaError("Registry snapshot contains missing or extra files", "INVALID_REGISTRY_LAYOUT");
  }
  for (const entry of entries) {
    const entryInfo = await lstat(join(snapshotDirectory, entry.name));
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
      throw new AibaError("Registry snapshot files must be regular files", "INVALID_REGISTRY_LAYOUT");
    }
  }
}

function assertIndexSemantics(index: CapabilityRegistryIndex, now: Date): void {
  const generatedAt = Date.parse(index.metadata.generatedAt);
  const expiresAt = Date.parse(index.metadata.expiresAt);
  if (expiresAt <= generatedAt) {
    throw new AibaError("Registry index expiry must follow generation", "INVALID_REGISTRY_EXPIRY");
  }
  if (generatedAt > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new AibaError("Registry index was generated too far in the future", "REGISTRY_INDEX_FROM_FUTURE");
  }
  if (expiresAt <= now.getTime()) {
    throw new AibaError("Registry index has expired", "REGISTRY_INDEX_EXPIRED");
  }

  const keys = new Set<string>();
  for (let indexPosition = 0; indexPosition < index.entries.length; indexPosition += 1) {
    const entry = index.entries[indexPosition];
    if (!entry) continue;
    const expectedPath = `bundles/${entry.capability}/${entry.version}`;
    if (entry.path !== expectedPath) {
      throw new AibaError(`Invalid registry bundle path: ${entry.path}`, "INVALID_REGISTRY_BUNDLE_PATH");
    }
    const key = `${entry.capability}\0${entry.version}`;
    if (keys.has(key)) {
      throw new AibaError(`Duplicate registry entry: ${entry.capability}@${entry.version}`, "DUPLICATE_REGISTRY_ENTRY");
    }
    keys.add(key);
    const previous = index.entries[indexPosition - 1];
    if (previous && compareEntry(previous, entry) >= 0) {
      throw new AibaError("Registry entries are not sorted", "UNSORTED_REGISTRY_ENTRIES");
    }
  }
}

async function collectBundleEntries(
  registryRoot: string,
  publisherTrustPolicyPath: string,
): Promise<CapabilityRegistryIndex["entries"]> {
  const bundlesRoot = join(registryRoot, "bundles");
  const rootInfo = await lstat(bundlesRoot).catch((error: unknown) => {
    throw new AibaError("Registry bundles directory is missing", "REGISTRY_BUNDLES_NOT_FOUND", {
      cause: error,
    });
  });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AibaError("Registry bundles root must be a regular directory", "INVALID_REGISTRY_LAYOUT");
  }
  const capabilityEntries = await readdir(bundlesRoot, { withFileTypes: true });
  capabilityEntries.sort((left, right) => compareText(left.name, right.name));
  const result: CapabilityRegistryIndex["entries"] = [];
  for (const capabilityEntry of capabilityEntries) {
    const capabilityDirectory = join(bundlesRoot, capabilityEntry.name);
    const capabilityInfo = await lstat(capabilityDirectory);
    if (
      !CAPABILITY_ID.test(capabilityEntry.name)
      || !capabilityInfo.isDirectory()
      || capabilityInfo.isSymbolicLink()
    ) {
      throw new AibaError(
        `Invalid registry capability directory: ${capabilityEntry.name}`,
        "INVALID_REGISTRY_LAYOUT",
      );
    }
    const versionEntries = await readdir(capabilityDirectory, { withFileTypes: true });
    versionEntries.sort((left, right) => compareText(left.name, right.name));
    for (const versionEntry of versionEntries) {
      const bundleDirectory = join(capabilityDirectory, versionEntry.name);
      const bundleInfo = await lstat(bundleDirectory);
      if (
        valid(versionEntry.name) !== versionEntry.name
        || !bundleInfo.isDirectory()
        || bundleInfo.isSymbolicLink()
      ) {
        throw new AibaError(
          `Invalid registry version directory: ${capabilityEntry.name}/${versionEntry.name}`,
          "INVALID_REGISTRY_LAYOUT",
        );
      }
      const verified = await verifyCapabilityBundle({
        bundleDirectory,
        trustPolicyPath: publisherTrustPolicyPath,
      });
      if (
        verified.capability !== capabilityEntry.name
        || verified.version !== versionEntry.name
      ) {
        throw new AibaError(
          `Registry path disagrees with bundle ${verified.capability}@${verified.version}`,
          "REGISTRY_BUNDLE_IDENTITY_MISMATCH",
        );
      }
      result.push({
        capability: verified.capability,
        version: verified.version,
        path: `bundles/${verified.capability}/${verified.version}`,
        bundleManifestSha256: verified.manifestSha256,
        publisher: verified.publisher,
        keyId: verified.keyId,
      });
    }
  }
  return result.sort(compareEntry);
}

export async function createRegistryIndex(
  options: CreateRegistryIndexOptions,
): Promise<CreateRegistryIndexResult> {
  assertIdentifier(options.registryId, "registry identifier");
  assertIdentifier(options.publisherId, "registry publisher identifier");
  assertIdentifier(options.keyId, "registry key identifier");
  if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
    throw new AibaError("Registry sequence must be a positive safe integer", "INVALID_REGISTRY_SEQUENCE");
  }
  if (Number.isNaN(options.expiresAt.getTime())) {
    throw new AibaError("Registry expiry must be a valid date", "INVALID_REGISTRY_EXPIRY");
  }
  const root = resolve(options.registryDirectory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AibaError("Registry root must be a regular directory", "INVALID_REGISTRY_LAYOUT");
  }
  const sequences = await listIndexSequences(root);
  const highestSequence = sequences.at(-1);
  if (highestSequence !== undefined && options.sequence <= highestSequence) {
    throw new AibaError(
      `Registry sequence ${options.sequence} does not exceed ${highestSequence}`,
      "REGISTRY_SEQUENCE_NOT_INCREASING",
    );
  }
  const [privateKey, entries] = await Promise.all([
    loadEd25519PrivateKey(options.privateKeyPath),
    collectBundleEntries(root, resolve(options.publisherTrustPolicyPath)),
  ]);
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new AibaError("Registry generation time must be a valid date", "INVALID_REGISTRY_TIME");
  }
  const index: CapabilityRegistryIndex = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityRegistryIndex",
    metadata: {
      id: options.registryId,
      sequence: options.sequence,
      generatedAt: now.toISOString(),
      expiresAt: options.expiresAt.toISOString(),
    },
    publisher: { id: options.publisherId, keyId: options.keyId },
    entries,
  };
  validateCapabilityRegistryIndex(index);
  assertIndexSemantics(index, now);
  const canonical = canonicalDocument(index);
  const indexSha256 = sha256Text(canonical);
  const signature: CapabilityRegistryIndexSignature = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityRegistryIndexSignature",
    algorithm: "Ed25519",
    keyId: options.keyId,
    indexSha256,
    signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
  };
  validateCapabilityRegistryIndexSignature(signature);

  const indexesDirectory = join(root, "indexes");
  const snapshotDirectory = join(indexesDirectory, String(options.sequence));
  await mkdir(indexesDirectory, { recursive: true });
  try {
    await mkdir(snapshotDirectory, { mode: 0o755 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AibaError(
        `Registry snapshot already exists: ${options.sequence}`,
        "REGISTRY_SNAPSHOT_EXISTS",
      );
    }
    throw error;
  }
  try {
    await writeFile(
      join(snapshotDirectory, "index.json"),
      `${JSON.stringify(index, null, 2)}\n`,
      { flag: "wx" },
    );
    await writeFile(
      join(snapshotDirectory, "index.sig.json"),
      `${JSON.stringify(signature, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    await rm(snapshotDirectory, { recursive: true, force: true });
    throw error;
  }
  return {
    registry: options.registryId,
    sequence: options.sequence,
    snapshotDirectory,
    entries: entries.length,
    indexSha256,
  };
}

export interface VerifiedRegistryIndex {
  index: CapabilityRegistryIndex;
  sequence: number;
  indexSha256: string;
}

export interface VerifyRegistryIndexSnapshotOptions {
  snapshotDirectory: string;
  sequence: number;
  registryTrustPolicyPath: string;
  now?: () => Date;
}

export async function verifyRegistryIndexSnapshot(
  options: VerifyRegistryIndexSnapshotOptions,
): Promise<VerifiedRegistryIndex> {
  if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
    throw new AibaError("Registry sequence must be a positive safe integer", "INVALID_REGISTRY_SEQUENCE");
  }
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new AibaError("Registry verification time must be a valid date", "INVALID_REGISTRY_TIME");
  }
  const sequence = options.sequence;
  const snapshot = resolve(options.snapshotDirectory);
  await assertSnapshotLayout(snapshot);
  const index = validateCapabilityRegistryIndex(
    await readJson(join(snapshot, "index.json"), "registry index"),
  );
  const signature = validateCapabilityRegistryIndexSignature(
    await readJson(join(snapshot, "index.sig.json"), "registry index signature"),
  );
  const policy = validateCapabilityRegistryTrustPolicy(
    await readJson(resolve(options.registryTrustPolicyPath), "registry trust policy"),
  );
  if (index.metadata.sequence !== sequence) {
    throw new AibaError("Registry snapshot sequence does not match index", "REGISTRY_SEQUENCE_MISMATCH");
  }
  assertIndexSemantics(index, now);
  if (signature.keyId !== index.publisher.keyId) {
    throw new AibaError("Registry index and signature key IDs differ", "REGISTRY_KEY_ID_MISMATCH");
  }
  const trustMatches = policy.registries.filter(
    (entry) => entry.registry === index.metadata.id
      && entry.publisher === index.publisher.id
      && entry.keyId === index.publisher.keyId,
  );
  if (trustMatches.length !== 1) {
    throw new AibaError(
      trustMatches.length === 0
        ? `Registry signer is not trusted: ${index.metadata.id}/${index.publisher.id}/${index.publisher.keyId}`
        : `Registry trust policy repeats signer: ${index.metadata.id}/${index.publisher.id}/${index.publisher.keyId}`,
      trustMatches.length === 0 ? "UNTRUSTED_REGISTRY_SIGNER" : "DUPLICATE_REGISTRY_TRUST_ENTRY",
    );
  }
  const trusted = trustMatches[0];
  if (!trusted) {
    throw new AibaError("Registry signer lookup failed", "UNTRUSTED_REGISTRY_SIGNER");
  }
  const canonical = canonicalDocument(index);
  const indexSha256 = sha256Text(canonical);
  if (signature.indexSha256 !== indexSha256) {
    throw new AibaError("Registry index digest does not match signature", "REGISTRY_INDEX_TAMPERED");
  }
  const signatureBytes = Buffer.from(signature.signature, "base64url");
  if (
    signatureBytes.length !== 64
    || !verify(
      null,
      Buffer.from(canonical),
      loadEd25519PublicKey(trusted.publicKey),
      signatureBytes,
    )
  ) {
    throw new AibaError("Registry index signature is invalid", "REGISTRY_SIGNATURE_INVALID");
  }
  return { index, sequence, indexSha256 };
}

async function verifyLatestIndex(
  registryRoot: string,
  trustPolicyPath: string,
  now: Date,
): Promise<VerifiedRegistryIndex> {
  const sequences = await listIndexSequences(registryRoot);
  const sequence = sequences.at(-1);
  if (sequence === undefined) {
    throw new AibaError("Registry has no index snapshots", "REGISTRY_INDEX_NOT_FOUND");
  }
  return verifyRegistryIndexSnapshot({
    snapshotDirectory: join(registryRoot, "indexes", String(sequence)),
    sequence,
    registryTrustPolicyPath: trustPolicyPath,
    now: () => now,
  });
}

async function loadRegistryState(path: string): Promise<CapabilityRegistryState | undefined> {
  const resolvedPath = resolve(path);
  if (!(await pathExists(resolvedPath))) return undefined;
  return validateCapabilityRegistryState(await readJson(resolvedPath, "registry state"));
}

function assertNoRollback(
  state: CapabilityRegistryState | undefined,
  verified: VerifiedRegistryIndex,
): void {
  if (!state) return;
  if (state.registry.id !== verified.index.metadata.id) {
    throw new AibaError("Registry state belongs to another registry", "REGISTRY_STATE_ID_MISMATCH");
  }
  if (verified.sequence < state.registry.sequence) {
    throw new AibaError(
      `Registry index sequence ${verified.sequence} is older than trusted ${state.registry.sequence}`,
      "REGISTRY_ROLLBACK_DETECTED",
    );
  }
  if (
    verified.sequence === state.registry.sequence
    && verified.indexSha256 !== state.registry.indexSha256
  ) {
    throw new AibaError(
      `Registry sequence ${verified.sequence} has a different signed digest`,
      "REGISTRY_EQUIVOCATION_DETECTED",
    );
  }
}

export async function assertRegistryIndexNotRolledBack(
  verified: VerifiedRegistryIndex,
  statePath: string,
): Promise<void> {
  assertNoRollback(await loadRegistryState(statePath), verified);
}

export function selectRegistryCapability(
  index: CapabilityRegistryIndex,
  capabilityId: string,
  version?: string,
): CapabilityRegistryEntry {
  if (!CAPABILITY_ID.test(capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  if (version !== undefined && valid(version) !== version) {
    throw new AibaError(`Invalid capability version: ${version}`, "INVALID_CAPABILITY_VERSION");
  }
  const candidates = index.entries.filter(
    (entry) => entry.capability === capabilityId
      && (version === undefined || entry.version === version),
  );
  candidates.sort((left, right) => rcompare(left.version, right.version));
  const selected = candidates[0];
  if (!selected) {
    throw new AibaError(
      version
        ? `Registry does not contain ${capabilityId}@${version}`
        : `Registry does not contain ${capabilityId}`,
      "REGISTRY_CAPABILITY_NOT_FOUND",
    );
  }
  return selected;
}

async function writeRegistryState(path: string, state: CapabilityRegistryState): Promise<void> {
  validateCapabilityRegistryState(state);
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  if (await pathExists(resolvedPath)) {
    const info = await lstat(resolvedPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new AibaError("Registry state path must be a regular file", "INVALID_REGISTRY_STATE_PATH");
    }
  }
  const temporary = join(
    dirname(resolvedPath),
    `.${randomUUID()}.registry-state.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, resolvedPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function resolveRegistryCapability(
  options: ResolveRegistryCapabilityOptions,
): Promise<ResolveRegistryCapabilityResult> {
  if (!CAPABILITY_ID.test(options.capabilityId)) {
    throw new AibaError(
      `Invalid capability identifier: ${options.capabilityId}`,
      "INVALID_CAPABILITY_ID",
    );
  }
  if (options.version !== undefined && valid(options.version) !== options.version) {
    throw new AibaError(`Invalid capability version: ${options.version}`, "INVALID_CAPABILITY_VERSION");
  }
  const root = resolve(options.registryDirectory);
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new AibaError("Registry verification time must be a valid date", "INVALID_REGISTRY_TIME");
  }
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AibaError("Registry root must be a regular directory", "INVALID_REGISTRY_LAYOUT");
  }
  const verified = await verifyLatestIndex(
    root,
    resolve(options.registryTrustPolicyPath),
    now,
  );
  const state = await loadRegistryState(options.statePath);
  assertNoRollback(state, verified);
  const selected = selectRegistryCapability(
    verified.index,
    options.capabilityId,
    options.version,
  );
  const bundleDirectory = join(root, ...selected.path.split("/"));
  const bundle = await verifyCapabilityBundle({
    bundleDirectory,
    trustPolicyPath: resolve(options.publisherTrustPolicyPath),
  });
  if (
    bundle.capability !== selected.capability
    || bundle.version !== selected.version
    || bundle.publisher !== selected.publisher
    || bundle.keyId !== selected.keyId
    || bundle.manifestSha256 !== selected.bundleManifestSha256
  ) {
    throw new AibaError(
      `Registry entry does not match verified bundle ${bundle.capability}@${bundle.version}`,
      "REGISTRY_BUNDLE_MISMATCH",
    );
  }
  const statePath = resolve(options.statePath);
  if (!state || verified.sequence > state.registry.sequence) {
    await writeRegistryState(statePath, {
      apiVersion: AIBA_API_VERSION,
      kind: "CapabilityRegistryState",
      registry: {
        id: verified.index.metadata.id,
        sequence: verified.sequence,
        indexSha256: verified.indexSha256,
        verifiedAt: now.toISOString(),
      },
    });
  }
  return {
    registry: verified.index.metadata.id,
    sequence: verified.sequence,
    indexSha256: verified.indexSha256,
    capability: bundle.capability,
    version: bundle.version,
    publisher: bundle.publisher,
    keyId: bundle.keyId,
    bundleDirectory,
    packDirectory: join(bundleDirectory, "pack"),
    statePath,
  };
}
