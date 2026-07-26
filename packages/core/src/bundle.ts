import {
  generateKeyPair,
  sign,
  verify,
} from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  AIBA_API_VERSION,
  type CapabilityBundle,
  type CapabilityBundleSignature,
  type CapabilityManifest,
} from "aiba-spec";
import { validRange } from "semver";
import { parse } from "yaml";
import { assertRecipeSemantics } from "./add.js";
import { AibaError } from "./errors.js";
import { sha256Text } from "./hash.js";
import {
  canonicalDocument,
  loadEd25519PrivateKey,
  loadEd25519PublicKey,
} from "./signing.js";
import { assertMigrationSemantics } from "./upgrade.js";
import {
  validateCapabilityBundle,
  validateCapabilityBundleSignature,
  validateCapabilityManifest,
  validateCapabilityMigration,
  validateCapabilityRecipe,
  validatePublisherTrustPolicy,
} from "./validation.js";

const generateKeyPairAsync = promisify(generateKeyPair);
const IDENTIFIER = /^[a-z][a-z0-9-]{1,95}$/;
const RECIPE_PATH = /^pack\/recipes\/([a-z][a-z0-9-]{1,62})\.yaml$/;
const MIGRATION_PATH = /^pack\/migrations\/([^/]+)\.yaml$/;
const MAX_FILE_COUNT = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024;

interface SourceFile {
  path: string;
  bytes: Buffer;
}

export interface GeneratePublisherKeyPairOptions {
  publisherId: string;
  keyId?: string;
  outputDirectory: string;
}

export interface GeneratePublisherKeyPairResult {
  publisherId: string;
  keyId: string;
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
}

export interface CreateCapabilityBundleOptions {
  packsDirectory: string;
  capabilityId: string;
  outputDirectory: string;
  publisherId: string;
  keyId: string;
  privateKeyPath: string;
  now?: () => Date;
}

export interface CreateCapabilityBundleResult {
  bundleDirectory: string;
  capability: string;
  version: string;
  publisher: string;
  keyId: string;
  files: number;
  manifestSha256: string;
}

export interface VerifyCapabilityBundleOptions {
  bundleDirectory: string;
  trustPolicyPath: string;
}

export interface VerifyCapabilityBundleEnvelopeOptions {
  bundleManifestPath: string;
  bundleSignaturePath: string;
  trustPolicyPath: string;
}

export interface VerifyCapabilityBundleEnvelopeResult {
  bundle: CapabilityBundle;
  capability: string;
  version: string;
  publisher: string;
  keyId: string;
  files: number;
  manifestSha256: string;
}

export interface VerifyCapabilityBundleResult {
  ok: true;
  capability: string;
  version: string;
  publisher: string;
  keyId: string;
  files: number;
  manifestSha256: string;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new AibaError(`Invalid ${label}: ${value}`, "INVALID_PUBLISHER_IDENTIFIER");
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

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAllowedPackPath(path: string): boolean {
  return path === "pack/capability.yaml"
    || path === "pack/README.md"
    || RECIPE_PATH.test(path)
    || MIGRATION_PATH.test(path);
}

function assertSafePackPath(path: string): void {
  if (
    path.includes("\\")
    || path.includes("\0")
    || path !== posix.normalize(path)
    || path.startsWith("/")
    || path.split("/").includes("..")
    || !isAllowedPackPath(path)
  ) {
    throw new AibaError(`Bundle contains forbidden path: ${path}`, "FORBIDDEN_BUNDLE_PATH");
  }
}

async function collectSourceFiles(packDirectory: string): Promise<SourceFile[]> {
  const root = resolve(packDirectory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AibaError("Bundle pack root must be a regular directory", "INVALID_BUNDLE_PACK_ROOT");
  }
  const files: SourceFile[] = [];
  let totalSize = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePath(left.name, right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      const relativePath = normalizeRelativePath(relative(root, absolute));
      const bundlePath = `pack/${relativePath}`;
      if (info.isSymbolicLink()) {
        throw new AibaError(`Bundle source contains symlink: ${bundlePath}`, "BUNDLE_SYMLINK_REJECTED");
      }
      if (info.isDirectory()) {
        if (relativePath !== "recipes" && relativePath !== "migrations") {
          throw new AibaError(
            `Bundle source contains forbidden directory: ${bundlePath}`,
            "FORBIDDEN_BUNDLE_PATH",
          );
        }
        await visit(absolute);
        continue;
      }
      if (!info.isFile()) {
        throw new AibaError(
          `Bundle source contains non-file entry: ${bundlePath}`,
          "BUNDLE_NON_FILE_REJECTED",
        );
      }
      assertSafePackPath(bundlePath);
      if (info.size > MAX_FILE_SIZE) {
        throw new AibaError(`Bundle file is too large: ${bundlePath}`, "BUNDLE_FILE_TOO_LARGE");
      }
      const bytes = await readFile(absolute);
      if (bytes.length !== info.size) {
        throw new AibaError(`Bundle source changed while reading: ${bundlePath}`, "BUNDLE_SOURCE_CHANGED");
      }
      totalSize += bytes.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new AibaError("Bundle exceeds total size limit", "BUNDLE_TOO_LARGE");
      }
      files.push({ path: bundlePath, bytes });
      if (files.length > MAX_FILE_COUNT) {
        throw new AibaError("Bundle has too many files", "BUNDLE_FILE_LIMIT_EXCEEDED");
      }
    }
  }

  await visit(root);
  files.sort((left, right) => comparePath(left.path, right.path));
  if (!files.some((file) => file.path === "pack/capability.yaml")) {
    throw new AibaError("Bundle is missing pack/capability.yaml", "BUNDLE_MANIFEST_MISSING");
  }
  if (!files.some((file) => file.path === "pack/README.md")) {
    throw new AibaError("Bundle is missing pack/README.md", "BUNDLE_README_MISSING");
  }
  return files;
}

async function parseJsonDocument(path: string, label: string): Promise<unknown> {
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
    const bytes = await readFile(path);
    if (bytes.length !== info.size) {
      throw new AibaError(`${label} changed while reading`, "DOCUMENT_CHANGED");
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof AibaError) throw error;
    throw new AibaError(`Cannot parse ${label}: ${path}`, "INVALID_JSON", { cause: error });
  }
}

function parseYamlDocument(bytes: Buffer, path: string): unknown {
  try {
    return parse(bytes.toString("utf8"), { maxAliasCount: 50 }) as unknown;
  } catch (error) {
    throw new AibaError(`Cannot parse bundled YAML ${path}`, "INVALID_YAML", { cause: error });
  }
}

function assertManifestSemantics(manifest: CapabilityManifest): void {
  for (const dependency of manifest.spec.dependencies) {
    if (!validRange(dependency.version)) {
      throw new AibaError(
        `Capability ${manifest.metadata.id} has invalid dependency range ${dependency.version}`,
        "INVALID_CAPABILITY_DEPENDENCY_RANGE",
      );
    }
  }
  for (const invariant of manifest.spec.invariants) {
    if (invariant.evidence.requiredTypes.some(
      (type) => !invariant.evidence.acceptedTypes.includes(type),
    )) {
      throw new AibaError(
        `Invariant ${invariant.id} requires unaccepted evidence`,
        "INVALID_INVARIANT_EVIDENCE_POLICY",
      );
    }
  }
}

function assertUniqueAndSortedFiles(bundle: CapabilityBundle): void {
  const paths = bundle.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) {
    throw new AibaError("Bundle manifest contains duplicate paths", "DUPLICATE_BUNDLE_PATH");
  }
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index] as string;
    assertSafePackPath(path);
    const previous = paths[index - 1];
    if (previous !== undefined && comparePath(previous, path) >= 0) {
      throw new AibaError("Bundle manifest paths are not sorted", "UNSORTED_BUNDLE_PATHS");
    }
  }
  if (!paths.includes("pack/capability.yaml") || !paths.includes("pack/README.md")) {
    throw new AibaError("Bundle manifest is missing required files", "BUNDLE_REQUIRED_FILE_MISSING");
  }
  const totalSize = bundle.files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new AibaError("Bundle exceeds total size limit", "BUNDLE_TOO_LARGE");
  }
}

async function assertBundleLayout(bundleRoot: string): Promise<void> {
  const rootInfo = await lstat(bundleRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new AibaError("Bundle root must be a regular directory", "INVALID_BUNDLE_LAYOUT");
  }
  const entries = await readdir(bundleRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["bundle.json", "bundle.sig.json", "pack"])) {
    throw new AibaError("Bundle root contains missing or extra entries", "INVALID_BUNDLE_LAYOUT");
  }
  for (const entry of entries) {
    const info = await lstat(join(bundleRoot, entry.name));
    if (info.isSymbolicLink()) {
      throw new AibaError(`Bundle contains symlink: ${entry.name}`, "BUNDLE_SYMLINK_REJECTED");
    }
    if (entry.name === "pack" ? !info.isDirectory() : !info.isFile()) {
      throw new AibaError(`Invalid bundle entry: ${entry.name}`, "INVALID_BUNDLE_LAYOUT");
    }
  }
}

async function validateBundledDocuments(
  files: SourceFile[],
  bundle: CapabilityBundle,
): Promise<void> {
  const manifestFile = files.find((file) => file.path === "pack/capability.yaml");
  if (!manifestFile) {
    throw new AibaError("Bundle capability manifest is missing", "BUNDLE_MANIFEST_MISSING");
  }
  const manifest = validateCapabilityManifest(
    parseYamlDocument(manifestFile.bytes, manifestFile.path),
  );
  assertManifestSemantics(manifest);
  if (
    manifest.metadata.id !== bundle.capability.id
    || manifest.metadata.version !== bundle.capability.version
  ) {
    throw new AibaError(
      "Bundled capability identity does not match bundle manifest",
      "BUNDLE_CAPABILITY_MISMATCH",
    );
  }

  for (const file of files) {
    const recipeMatch = RECIPE_PATH.exec(file.path);
    if (recipeMatch) {
      const recipe = validateCapabilityRecipe(parseYamlDocument(file.bytes, file.path));
      if (recipe.metadata.id !== recipeMatch[1]) {
        throw new AibaError(`Recipe filename does not match ${recipe.metadata.id}`, "RECIPE_ID_MISMATCH");
      }
      assertRecipeSemantics(recipe, manifest);
      continue;
    }
    const migrationMatch = MIGRATION_PATH.exec(file.path);
    if (migrationMatch) {
      const migration = validateCapabilityMigration(parseYamlDocument(file.bytes, file.path));
      const expectedName = `${migration.spec.capability.fromVersion}-to-${migration.spec.capability.toVersion}`;
      if (migrationMatch[1] !== expectedName) {
        throw new AibaError("Migration filename does not match its version range", "MIGRATION_FILENAME_MISMATCH");
      }
      assertMigrationSemantics(migration, migration.spec.capability.fromVersion, manifest);
    }
  }
}

export async function generatePublisherKeyPair(
  options: GeneratePublisherKeyPairOptions,
): Promise<GeneratePublisherKeyPairResult> {
  const keyId = options.keyId ?? "root-1";
  assertIdentifier(options.publisherId, "publisher identifier");
  assertIdentifier(keyId, "key identifier");
  const output = resolve(options.outputDirectory);
  if (await pathExists(output)) {
    throw new AibaError(`Key output already exists: ${output}`, "KEY_OUTPUT_EXISTS");
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  try {
    const { privateKey, publicKey } = await generateKeyPairAsync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const privateKeyPath = join(output, "private.pem");
    const publicKeyPath = join(output, "public.pem");
    await writeFile(privateKeyPath, privateKey, { mode: 0o600, flag: "wx" });
    await chmod(privateKeyPath, 0o600);
    await writeFile(publicKeyPath, publicKey, { mode: 0o644, flag: "wx" });
    return {
      publisherId: options.publisherId,
      keyId,
      privateKeyPath,
      publicKeyPath,
      publicKey,
    };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export async function createCapabilityBundle(
  options: CreateCapabilityBundleOptions,
): Promise<CreateCapabilityBundleResult> {
  assertIdentifier(options.publisherId, "publisher identifier");
  assertIdentifier(options.keyId, "key identifier");
  const output = resolve(options.outputDirectory);
  if (await pathExists(output)) {
    throw new AibaError(`Bundle output already exists: ${output}`, "BUNDLE_OUTPUT_EXISTS");
  }
  const privateKey = await loadEd25519PrivateKey(options.privateKeyPath);
  const source = join(resolve(options.packsDirectory), options.capabilityId);
  const files = await collectSourceFiles(source).catch((error: unknown) => {
    if (error instanceof AibaError) throw error;
    throw new AibaError(`Cannot read capability pack ${source}`, "CAPABILITY_PACK_NOT_FOUND", {
      cause: error,
    });
  });
  const manifestFile = files.find((file) => file.path === "pack/capability.yaml");
  if (!manifestFile) {
    throw new AibaError("Bundle capability manifest is missing", "BUNDLE_MANIFEST_MISSING");
  }
  const capability = validateCapabilityManifest(
    parseYamlDocument(manifestFile.bytes, manifestFile.path),
  );
  assertManifestSemantics(capability);
  if (capability.metadata.id !== options.capabilityId) {
    throw new AibaError("Capability directory and manifest ID differ", "CAPABILITY_ID_MISMATCH");
  }

  const bundle: CapabilityBundle = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityBundle",
    metadata: { createdAt: (options.now ?? (() => new Date()))().toISOString() },
    capability: {
      id: capability.metadata.id,
      version: capability.metadata.version,
    },
    publisher: { id: options.publisherId, keyId: options.keyId },
    files: files.map((file) => ({
      path: file.path,
      size: file.bytes.length,
      sha256: sha256Text(file.bytes),
    })),
  };
  validateCapabilityBundle(bundle);
  assertUniqueAndSortedFiles(bundle);
  await validateBundledDocuments(files, bundle);
  const canonical = canonicalDocument(bundle);
  const manifestSha256 = sha256Text(canonical);
  const signature: CapabilityBundleSignature = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityBundleSignature",
    algorithm: "Ed25519",
    keyId: options.keyId,
    manifestSha256,
    signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
  };
  validateCapabilityBundleSignature(signature);

  await mkdir(dirname(output), { recursive: true });
  try {
    await mkdir(output, { mode: 0o755 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AibaError(`Bundle output already exists: ${output}`, "BUNDLE_OUTPUT_EXISTS");
    }
    throw error;
  }
  try {
    for (const file of files) {
      const destination = join(output, ...file.path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes, { flag: "wx" });
    }
    await writeFile(join(output, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`, {
      flag: "wx",
    });
    await writeFile(
      join(output, "bundle.sig.json"),
      `${JSON.stringify(signature, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  return {
    bundleDirectory: output,
    capability: capability.metadata.id,
    version: capability.metadata.version,
    publisher: options.publisherId,
    keyId: options.keyId,
    files: files.length,
    manifestSha256,
  };
}

export async function verifyCapabilityBundleEnvelope(
  options: VerifyCapabilityBundleEnvelopeOptions,
): Promise<VerifyCapabilityBundleEnvelopeResult> {
  const bundle = validateCapabilityBundle(
    await parseJsonDocument(resolve(options.bundleManifestPath), "bundle manifest"),
  );
  const signature = validateCapabilityBundleSignature(
    await parseJsonDocument(resolve(options.bundleSignaturePath), "bundle signature"),
  );
  const policy = validatePublisherTrustPolicy(
    await parseJsonDocument(resolve(options.trustPolicyPath), "trust policy"),
  );
  assertUniqueAndSortedFiles(bundle);
  if (signature.keyId !== bundle.publisher.keyId) {
    throw new AibaError("Bundle and signature key IDs differ", "BUNDLE_KEY_ID_MISMATCH");
  }

  const trustMatches = policy.publishers.filter(
    (entry) => entry.publisher === bundle.publisher.id && entry.keyId === bundle.publisher.keyId,
  );
  if (trustMatches.length !== 1) {
    throw new AibaError(
      trustMatches.length === 0
        ? `Publisher key is not trusted: ${bundle.publisher.id}/${bundle.publisher.keyId}`
        : `Trust policy repeats publisher key: ${bundle.publisher.id}/${bundle.publisher.keyId}`,
      trustMatches.length === 0 ? "UNTRUSTED_PUBLISHER_KEY" : "DUPLICATE_TRUST_ENTRY",
    );
  }
  const trusted = trustMatches[0];
  if (!trusted) {
    throw new AibaError("Trusted publisher key lookup failed", "UNTRUSTED_PUBLISHER_KEY");
  }
  if (!trusted.capabilities.includes(bundle.capability.id)) {
    throw new AibaError(
      `Publisher key is not allowed to sign ${bundle.capability.id}`,
      "CAPABILITY_NOT_TRUSTED",
    );
  }
  const publicKey = loadEd25519PublicKey(trusted.publicKey);
  const canonical = canonicalDocument(bundle);
  const manifestSha256 = sha256Text(canonical);
  if (signature.manifestSha256 !== manifestSha256) {
    throw new AibaError("Bundle manifest digest does not match signature", "BUNDLE_MANIFEST_TAMPERED");
  }
  const signatureBytes = Buffer.from(signature.signature, "base64url");
  if (
    signatureBytes.length !== 64
    || !verify(null, Buffer.from(canonical), publicKey, signatureBytes)
  ) {
    throw new AibaError("Bundle signature is invalid", "BUNDLE_SIGNATURE_INVALID");
  }

  return {
    bundle,
    capability: bundle.capability.id,
    version: bundle.capability.version,
    publisher: bundle.publisher.id,
    keyId: bundle.publisher.keyId,
    files: bundle.files.length,
    manifestSha256,
  };
}

export async function verifyCapabilityBundle(
  options: VerifyCapabilityBundleOptions,
): Promise<VerifyCapabilityBundleResult> {
  const root = resolve(options.bundleDirectory);
  await assertBundleLayout(root);
  const envelope = await verifyCapabilityBundleEnvelope({
    bundleManifestPath: join(root, "bundle.json"),
    bundleSignaturePath: join(root, "bundle.sig.json"),
    trustPolicyPath: options.trustPolicyPath,
  });
  const { bundle } = envelope;

  const actualFiles = await collectSourceFiles(join(root, "pack"));
  const expectedPaths = bundle.files.map((file) => file.path);
  const actualPaths = actualFiles.map((file) => file.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new AibaError("Bundle file set differs from signed manifest", "BUNDLE_FILE_SET_MISMATCH");
  }
  for (let index = 0; index < actualFiles.length; index += 1) {
    const actual = actualFiles[index];
    const expected = bundle.files[index];
    if (!actual || !expected) {
      throw new AibaError("Bundle file set differs from signed manifest", "BUNDLE_FILE_SET_MISMATCH");
    }
    if (actual.bytes.length !== expected.size || sha256Text(actual.bytes) !== expected.sha256) {
      throw new AibaError(`Bundled file was modified: ${actual.path}`, "BUNDLE_FILE_TAMPERED");
    }
  }
  await validateBundledDocuments(actualFiles, bundle);
  return {
    ok: true,
    capability: bundle.capability.id,
    version: bundle.capability.version,
    publisher: bundle.publisher.id,
    keyId: bundle.publisher.keyId,
    files: bundle.files.length,
    manifestSha256: envelope.manifestSha256,
  };
}
