import process from "node:process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { valid } from "semver";
import {
  verifyCapabilityBundle,
  verifyCapabilityBundleEnvelope,
} from "./bundle.js";
import { AibaError } from "./errors.js";
import {
  assertRegistryIndexNotRolledBack,
  resolveRegistryCapability,
  selectRegistryCapability,
  verifyRegistryIndexSnapshot,
  type ResolveRegistryCapabilityResult,
  type VerifiedRegistryIndex,
} from "./registry.js";

const CAPABILITY_ID = /^[a-z][a-z0-9-]{1,62}$/;
const ENVIRONMENT_VARIABLE = /^[A-Z_][A-Z0-9_]*$/;
const MAX_TOKEN_SIZE = 8 * 1024;
const MAX_LATEST_SIZE = 1024;
const MAX_INDEX_SIZE = 5 * 1024 * 1024;
const MAX_SIGNATURE_SIZE = 64 * 1024;
const MAX_BUNDLE_MANIFEST_SIZE = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchRegistryCapabilityOptions {
  registryUrl: string;
  cacheDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  statePath: string;
  capabilityId: string;
  version?: string;
  tokenEnvironmentVariable?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  allowInsecureLocalhost?: boolean;
  now?: () => Date;
}

export interface FetchRegistryCapabilityResult extends ResolveRegistryCapabilityResult {
  registryUrl: string;
  cacheDirectory: string;
  downloadedFiles: number;
}

interface RemoteClient {
  get(path: string, maximumSize: number, expectedSize?: number): Promise<Buffer>;
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

async function assertRegularDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AibaError(`${label} must be a regular directory`, "INVALID_CACHE_LAYOUT");
  }
}

function validateRegistryUrl(value: string, allowInsecureLocalhost: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AibaError(`Invalid registry URL: ${value}`, "INVALID_REGISTRY_URL", { cause: error });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AibaError(
      "Registry URL must not contain credentials, a query, or a fragment",
      "INVALID_REGISTRY_URL",
    );
  }
  const localhost = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(allowInsecureLocalhost && url.protocol === "http:" && localhost)) {
    throw new AibaError("Registry transport requires HTTPS", "INSECURE_REGISTRY_TRANSPORT");
  }
  return url;
}

function createRemoteClient(
  baseUrl: URL,
  token: string,
  timeoutMs: number,
): RemoteClient {
  const basePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  return {
    async get(path: string, maximumSize: number, expectedSize?: number): Promise<Buffer> {
      const url = new URL(baseUrl.toString());
      url.pathname = `${basePath}${path}`;
      url.search = "";
      url.hash = "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timeout.unref();
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "application/json, application/octet-stream;q=0.9",
            "accept-encoding": "identity",
            authorization: `Bearer ${token}`,
          },
        });
        if (response.status >= 300 && response.status < 400) {
          throw new AibaError("Registry redirects are not allowed", "REGISTRY_REDIRECT_REJECTED");
        }
        if (response.status === 401 || response.status === 403) {
          throw new AibaError("Registry authentication failed", "REGISTRY_AUTHENTICATION_FAILED");
        }
        if (!response.ok) {
          throw new AibaError(
            `Registry request returned HTTP ${response.status}: ${url.pathname}`,
            "REGISTRY_HTTP_ERROR",
          );
        }
        const declaredSize = response.headers.get("content-length");
        if (declaredSize !== null) {
          const parsedSize = Number(declaredSize);
          if (!Number.isSafeInteger(parsedSize) || parsedSize < 0 || parsedSize > maximumSize) {
            throw new AibaError("Registry response exceeds size limit", "REGISTRY_RESPONSE_TOO_LARGE");
          }
          if (expectedSize !== undefined && parsedSize !== expectedSize) {
            throw new AibaError("Registry file size differs from signed manifest", "REGISTRY_FILE_SIZE_MISMATCH");
          }
        }
        if (!response.body) {
          throw new AibaError("Registry response has no body", "REGISTRY_EMPTY_RESPONSE");
        }
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let size = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          const chunk = Buffer.from(result.value);
          size += chunk.length;
          if (size > maximumSize || (expectedSize !== undefined && size > expectedSize)) {
            await reader.cancel();
            throw new AibaError("Registry response exceeds size limit", "REGISTRY_RESPONSE_TOO_LARGE");
          }
          chunks.push(chunk);
        }
        if (expectedSize !== undefined && size !== expectedSize) {
          throw new AibaError("Registry file size differs from signed manifest", "REGISTRY_FILE_SIZE_MISMATCH");
        }
        return Buffer.concat(chunks, size);
      } catch (error) {
        if (error instanceof AibaError) throw error;
        if (controller.signal.aborted) {
          throw new AibaError(`Registry request timed out: ${url.pathname}`, "REGISTRY_REQUEST_TIMEOUT", {
            cause: error,
          });
        }
        throw new AibaError(`Registry request failed: ${url.pathname}`, "REGISTRY_REQUEST_FAILED", {
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function parseLatest(bytes: Buffer): number {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new AibaError("Cannot parse registry latest descriptor", "INVALID_REGISTRY_LATEST", {
      cause: error,
    });
  }
  if (
    typeof document !== "object"
    || document === null
    || Array.isArray(document)
    || Object.keys(document).length !== 1
    || !("sequence" in document)
    || !Number.isSafeInteger(document.sequence)
    || (document.sequence as number) < 1
  ) {
    throw new AibaError("Invalid registry latest descriptor", "INVALID_REGISTRY_LATEST");
  }
  return document.sequence as number;
}

function assertBundleMatchesIndex(
  envelope: Awaited<ReturnType<typeof verifyCapabilityBundleEnvelope>>,
  selected: ReturnType<typeof selectRegistryCapability>,
): void {
  if (
    envelope.capability !== selected.capability
    || envelope.version !== selected.version
    || envelope.publisher !== selected.publisher
    || envelope.keyId !== selected.keyId
    || envelope.manifestSha256 !== selected.bundleManifestSha256
  ) {
    throw new AibaError(
      `Registry entry does not match verified bundle ${envelope.capability}@${envelope.version}`,
      "REGISTRY_BUNDLE_MISMATCH",
    );
  }
}

async function writeDownloaded(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx", mode: 0o644 });
}

async function highestCachedSequence(cacheRoot: string): Promise<number | undefined> {
  const indexes = join(cacheRoot, "indexes");
  if (!(await pathExists(indexes))) return undefined;
  await assertRegularDirectory(indexes, "Registry cache indexes root");
  const entries = await readdir(indexes, { withFileTypes: true });
  const sequences: number[] = [];
  for (const entry of entries) {
    const sequence = Number(entry.name);
    const path = join(indexes, entry.name);
    const info = await lstat(path);
    if (
      !entry.isDirectory()
      || info.isSymbolicLink()
      || !Number.isSafeInteger(sequence)
      || sequence < 1
      || String(sequence) !== entry.name
    ) {
      throw new AibaError(`Invalid registry cache entry: ${entry.name}`, "INVALID_CACHE_LAYOUT");
    }
    sequences.push(sequence);
  }
  return sequences.sort((left, right) => left - right).at(-1);
}

async function publishDirectory(
  staged: string,
  destination: string,
  validateExisting: () => Promise<void>,
): Promise<void> {
  if (await pathExists(destination)) {
    await validateExisting();
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  try {
    await rename(staged, destination);
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      await validateExisting();
      return;
    }
    throw error;
  }
}

async function assertExistingSnapshot(
  snapshotDirectory: string,
  expected: VerifiedRegistryIndex,
  trustPolicyPath: string,
  now: Date,
): Promise<void> {
  const actual = await verifyRegistryIndexSnapshot({
    snapshotDirectory,
    sequence: expected.sequence,
    registryTrustPolicyPath: trustPolicyPath,
    now: () => now,
  });
  if (actual.indexSha256 !== expected.indexSha256) {
    throw new AibaError("Registry cache contains a conflicting index", "REGISTRY_CACHE_CONFLICT");
  }
}

export async function fetchRegistryCapability(
  options: FetchRegistryCapabilityOptions,
): Promise<FetchRegistryCapabilityResult> {
  if (!CAPABILITY_ID.test(options.capabilityId)) {
    throw new AibaError(`Invalid capability identifier: ${options.capabilityId}`, "INVALID_CAPABILITY_ID");
  }
  if (options.version !== undefined && valid(options.version) !== options.version) {
    throw new AibaError(`Invalid capability version: ${options.version}`, "INVALID_CAPABILITY_VERSION");
  }
  const tokenEnvironmentVariable = options.tokenEnvironmentVariable ?? "AIBA_REGISTRY_TOKEN";
  if (!ENVIRONMENT_VARIABLE.test(tokenEnvironmentVariable)) {
    throw new AibaError("Invalid token environment variable name", "INVALID_TOKEN_ENVIRONMENT_VARIABLE");
  }
  const token = (options.environment ?? process.env)[tokenEnvironmentVariable];
  if (!token || token.length > MAX_TOKEN_SIZE || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new AibaError(
      `Registry token is missing or invalid in ${tokenEnvironmentVariable}`,
      "REGISTRY_TOKEN_INVALID",
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new AibaError("Registry timeout must be between 1 and 120000 ms", "INVALID_REGISTRY_TIMEOUT");
  }
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new AibaError("Registry verification time must be a valid date", "INVALID_REGISTRY_TIME");
  }
  const registryUrl = validateRegistryUrl(
    options.registryUrl,
    options.allowInsecureLocalhost ?? false,
  );
  const client = createRemoteClient(registryUrl, token, timeoutMs);
  const cacheRoot = resolve(options.cacheDirectory);
  const statePath = resolve(options.statePath);
  const registryTrustPolicyPath = resolve(options.registryTrustPolicyPath);
  const publisherTrustPolicyPath = resolve(options.publisherTrustPolicyPath);
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await assertRegularDirectory(cacheRoot, "Registry cache root");
  const staging = await mkdtemp(join(dirname(cacheRoot), ".aiba-fetch-"));
  let downloadedFiles = 0;
  try {
    const sequence = parseLatest(await client.get("v0/indexes/latest.json", MAX_LATEST_SIZE));
    const cachedSequence = await highestCachedSequence(cacheRoot);
    if (cachedSequence !== undefined && sequence < cachedSequence) {
      throw new AibaError(
        `Remote registry sequence ${sequence} is older than cached ${cachedSequence}`,
        "REGISTRY_ROLLBACK_DETECTED",
      );
    }
    const stagedSnapshot = join(staging, "snapshot");
    await mkdir(stagedSnapshot);
    const [indexBytes, indexSignatureBytes] = await Promise.all([
      client.get(`v0/indexes/${sequence}/index.json`, MAX_INDEX_SIZE),
      client.get(`v0/indexes/${sequence}/index.sig.json`, MAX_SIGNATURE_SIZE),
    ]);
    await Promise.all([
      writeDownloaded(join(stagedSnapshot, "index.json"), indexBytes),
      writeDownloaded(join(stagedSnapshot, "index.sig.json"), indexSignatureBytes),
    ]);
    const verifiedIndex = await verifyRegistryIndexSnapshot({
      snapshotDirectory: stagedSnapshot,
      sequence,
      registryTrustPolicyPath,
      now: () => now,
    });
    await assertRegistryIndexNotRolledBack(verifiedIndex, statePath);
    const selected = selectRegistryCapability(
      verifiedIndex.index,
      options.capabilityId,
      options.version,
    );

    const stagedBundle = join(staging, "bundle");
    await mkdir(stagedBundle);
    const bundleBase = `v0/bundles/${selected.capability}/${selected.version}`;
    const [bundleBytes, bundleSignatureBytes] = await Promise.all([
      client.get(`${bundleBase}/bundle.json`, MAX_BUNDLE_MANIFEST_SIZE),
      client.get(`${bundleBase}/bundle.sig.json`, MAX_SIGNATURE_SIZE),
    ]);
    await Promise.all([
      writeDownloaded(join(stagedBundle, "bundle.json"), bundleBytes),
      writeDownloaded(join(stagedBundle, "bundle.sig.json"), bundleSignatureBytes),
    ]);
    const envelope = await verifyCapabilityBundleEnvelope({
      bundleManifestPath: join(stagedBundle, "bundle.json"),
      bundleSignaturePath: join(stagedBundle, "bundle.sig.json"),
      trustPolicyPath: publisherTrustPolicyPath,
    });
    assertBundleMatchesIndex(envelope, selected);
    for (const file of envelope.bundle.files) {
      const bytes = await client.get(`${bundleBase}/${file.path}`, file.size, file.size);
      await writeDownloaded(join(stagedBundle, ...file.path.split("/")), bytes);
      downloadedFiles += 1;
    }
    const verifiedBundle = await verifyCapabilityBundle({
      bundleDirectory: stagedBundle,
      trustPolicyPath: publisherTrustPolicyPath,
    });
    assertBundleMatchesIndex({ ...envelope, ...verifiedBundle }, selected);

    const cachedBundle = join(cacheRoot, ...selected.path.split("/"));
    const cachedSnapshot = join(cacheRoot, "indexes", String(sequence));
    const validateExistingBundle = async (): Promise<void> => {
      const actual = await verifyCapabilityBundle({
        bundleDirectory: cachedBundle,
        trustPolicyPath: publisherTrustPolicyPath,
      });
      assertBundleMatchesIndex({ ...envelope, ...actual }, selected);
    };
    if (await pathExists(cachedSnapshot)) {
      await assertExistingSnapshot(
        cachedSnapshot,
        verifiedIndex,
        registryTrustPolicyPath,
        now,
      );
    }
    if (await pathExists(cachedBundle)) await validateExistingBundle();
    await publishDirectory(stagedBundle, cachedBundle, validateExistingBundle);
    await publishDirectory(
      stagedSnapshot,
      cachedSnapshot,
      () => assertExistingSnapshot(
        cachedSnapshot,
        verifiedIndex,
        registryTrustPolicyPath,
        now,
      ),
    );

    const resolved = await resolveRegistryCapability({
      registryDirectory: cacheRoot,
      registryTrustPolicyPath,
      publisherTrustPolicyPath,
      statePath,
      capabilityId: options.capabilityId,
      ...(options.version ? { version: options.version } : {}),
      now: () => now,
    });
    return {
      ...resolved,
      registryUrl: registryUrl.toString(),
      cacheDirectory: cacheRoot,
      downloadedFiles,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
