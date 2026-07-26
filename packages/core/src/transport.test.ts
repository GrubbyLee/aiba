import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CapabilityRegistryTrustPolicy,
  PublisherTrustPolicy,
} from "@aiba/spec";
import { createCapabilityBundle, generatePublisherKeyPair } from "./bundle.js";
import { createRegistryIndex } from "./registry.js";
import { fetchRegistryCapability } from "./transport.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];
const NOW = new Date("2026-07-26T00:00:00.000Z");
const TOMORROW = new Date("2026-07-27T00:00:00.000Z");
const TOKEN = "private-registry-token-that-must-not-reach-disk";

interface TransportFixture {
  root: string;
  registryDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  publisherPrivateKeyPath: string;
  registryPrivateKeyPath: string;
  cacheDirectory: string;
  statePath: string;
}

interface ResponseOverride {
  status?: number;
  headers?: Record<string, string>;
  body?: Buffer | string;
  destroy?: boolean;
}

type RequestOverride = (
  request: IncomingMessage,
  pathname: string,
) => ResponseOverride | undefined;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aiba-transport-test-"));
  roots.push(root);
  return root;
}

async function createFixture(): Promise<TransportFixture> {
  const root = await temporaryRoot();
  const registryDirectory = join(root, "registry");
  await mkdir(join(registryDirectory, "bundles", "identity"), { recursive: true });
  const publisherKeys = await generatePublisherKeyPair({
    publisherId: "capability-publisher",
    outputDirectory: join(root, "publisher-keys"),
  });
  const publisherTrustPolicyPath = join(root, "publisher-trust.json");
  const publisherPolicy: PublisherTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "PublisherTrustPolicy",
    metadata: { id: "publisher-policy" },
    publishers: [{
      publisher: "capability-publisher",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey: publisherKeys.publicKey,
      capabilities: ["identity"],
    }],
  };
  await writeFile(publisherTrustPolicyPath, `${JSON.stringify(publisherPolicy, null, 2)}\n`);
  await createCapabilityBundle({
    packsDirectory: join(workspace, "capabilities"),
    capabilityId: "identity",
    outputDirectory: join(registryDirectory, "bundles", "identity", "0.1.0"),
    publisherId: "capability-publisher",
    keyId: "root-1",
    privateKeyPath: publisherKeys.privateKeyPath,
    now: () => NOW,
  });
  const registryKeys = await generatePublisherKeyPair({
    publisherId: "registry-operator",
    outputDirectory: join(root, "registry-keys"),
  });
  const registryTrustPolicyPath = join(root, "registry-trust.json");
  const registryPolicy: CapabilityRegistryTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "CapabilityRegistryTrustPolicy",
    metadata: { id: "registry-policy" },
    registries: [{
      registry: "private-registry",
      publisher: "registry-operator",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey: registryKeys.publicKey,
    }],
  };
  await writeFile(registryTrustPolicyPath, `${JSON.stringify(registryPolicy, null, 2)}\n`);
  const fixture = {
    root,
    registryDirectory,
    registryTrustPolicyPath,
    publisherTrustPolicyPath,
    publisherPrivateKeyPath: publisherKeys.privateKeyPath,
    registryPrivateKeyPath: registryKeys.privateKeyPath,
    cacheDirectory: join(root, "cache"),
    statePath: join(root, "state.json"),
  };
  await createIndex(fixture, 1);
  return fixture;
}

async function createIndex(fixture: TransportFixture, sequence: number): Promise<void> {
  await createRegistryIndex({
    registryDirectory: fixture.registryDirectory,
    registryId: "private-registry",
    publisherId: "registry-operator",
    keyId: "root-1",
    privateKeyPath: fixture.registryPrivateKeyPath,
    publisherTrustPolicyPath: fixture.publisherTrustPolicyPath,
    sequence,
    expiresAt: TOMORROW,
    now: () => new Date(NOW.getTime() + (sequence - 1) * 1000),
  });
}

async function startRegistry(
  fixture: TransportFixture,
  latestSequence: () => number,
  override?: RequestOverride,
): Promise<string> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const custom = override?.(request, pathname);
    if (custom?.destroy) {
      request.socket.destroy();
      return;
    }
    if (custom) {
      response.writeHead(custom.status ?? 200, custom.headers);
      response.end(custom.body);
      return;
    }
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401);
      response.end("unauthorized");
      return;
    }
    if (pathname === "/v0/indexes/latest.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ sequence: latestSequence() }));
      return;
    }
    const indexMatch = /^\/v0\/indexes\/(\d+)\/(index(?:\.sig)?\.json)$/.exec(pathname);
    if (indexMatch) {
      const bytes = await readFile(join(
        fixture.registryDirectory,
        "indexes",
        indexMatch[1] as string,
        indexMatch[2] as string,
      ));
      response.end(bytes);
      return;
    }
    const bundlePrefix = "/v0/bundles/identity/0.1.0/";
    if (pathname.startsWith(bundlePrefix)) {
      const relativePath = pathname.slice(bundlePrefix.length);
      const bytes = await readFile(join(
        fixture.registryDirectory,
        "bundles",
        "identity",
        "0.1.0",
        ...relativePath.split("/"),
      ));
      response.end(bytes);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  servers.push(server);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test registry did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

function fetchOptions(fixture: TransportFixture, registryUrl: string) {
  return {
    registryUrl,
    cacheDirectory: fixture.cacheDirectory,
    registryTrustPolicyPath: fixture.registryTrustPolicyPath,
    publisherTrustPolicyPath: fixture.publisherTrustPolicyPath,
    statePath: fixture.statePath,
    capabilityId: "identity",
    environment: { AIBA_REGISTRY_TOKEN: TOKEN },
    allowInsecureLocalhost: true,
    now: () => NOW,
  } as const;
}

async function readTree(path: string): Promise<string> {
  if (!(await pathExists(path))) return "";
  const info = await lstat(path);
  if (info.isFile()) return readFile(path, "utf8");
  if (!info.isDirectory() || info.isSymbolicLink()) return "";
  const entries = await readdir(path);
  return (await Promise.all(entries.map((entry) => readTree(join(path, entry))))).join("");
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
    server.closeAllConnections();
  })));
  await Promise.all(roots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

describe("authenticated registry transport", () => {
  it("fetches a bearer-authenticated capability into a verified cache without persisting the token", async () => {
    const fixture = await createFixture();
    const registryUrl = await startRegistry(fixture, () => 1);

    const result = await fetchRegistryCapability(fetchOptions(fixture, registryUrl));

    expect(result).toMatchObject({
      registry: "private-registry",
      sequence: 1,
      capability: "identity",
      version: "0.1.0",
      downloadedFiles: 3,
    });
    expect(await pathExists(join(fixture.cacheDirectory, "indexes", "1"))).toBe(true);
    expect(await readTree(fixture.cacheDirectory)).not.toContain(TOKEN);
    expect(await readTree(fixture.statePath)).not.toContain(TOKEN);
  });

  it("fails closed on missing credentials and HTTP 401", async () => {
    const fixture = await createFixture();
    const registryUrl = await startRegistry(fixture, () => 1);
    await expect(fetchRegistryCapability({
      ...fetchOptions(fixture, registryUrl),
      environment: {},
    })).rejects.toMatchObject({ code: "REGISTRY_TOKEN_INVALID" });
    await expect(fetchRegistryCapability({
      ...fetchOptions(fixture, registryUrl),
      environment: { AIBA_REGISTRY_TOKEN: "wrong" },
    })).rejects.toMatchObject({ code: "REGISTRY_AUTHENTICATION_FAILED" });
  });

  it("rejects redirects without forwarding the bearer token", async () => {
    const fixture = await createFixture();
    let redirectedAuthorization: string | undefined;
    const target = createServer((request, response) => {
      redirectedAuthorization = request.headers.authorization;
      response.end("unexpected");
    });
    servers.push(target);
    await new Promise<void>((resolvePromise) => target.listen(0, "127.0.0.1", resolvePromise));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Redirect target did not bind TCP");
    const registryUrl = await startRegistry(fixture, () => 1, (_request, pathname) => (
      pathname === "/v0/indexes/latest.json"
        ? { status: 302, headers: { location: `http://127.0.0.1:${address.port}/capture` } }
        : undefined
    ));

    await expect(fetchRegistryCapability(fetchOptions(fixture, registryUrl))).rejects.toMatchObject({
      code: "REGISTRY_REDIRECT_REJECTED",
    });
    expect(redirectedAuthorization).toBeUndefined();
  });

  it("enforces streaming response size limits", async () => {
    const fixture = await createFixture();
    const registryUrl = await startRegistry(fixture, () => 1, (_request, pathname) => (
      pathname === "/v0/indexes/latest.json"
        ? { body: Buffer.alloc(1025, 0x20) }
        : undefined
    ));

    await expect(fetchRegistryCapability(fetchOptions(fixture, registryUrl))).rejects.toMatchObject({
      code: "REGISTRY_RESPONSE_TOO_LARGE",
    });
  });

  it("requires HTTPS unless localhost HTTP is explicitly enabled", async () => {
    const fixture = await createFixture();
    await expect(fetchRegistryCapability({
      ...fetchOptions(fixture, "http://127.0.0.1:1"),
      allowInsecureLocalhost: false,
    })).rejects.toMatchObject({ code: "INSECURE_REGISTRY_TRANSPORT" });
  });

  it.each([
    ["index", "/v0/indexes/1/index.json", "REGISTRY_INDEX_TAMPERED"],
    ["bundle envelope", "/v0/bundles/identity/0.1.0/bundle.json", "BUNDLE_MANIFEST_TAMPERED"],
    ["pack file", "/v0/bundles/identity/0.1.0/pack/README.md", "BUNDLE_FILE_TAMPERED"],
  ])("rejects tampered %s bytes", async (_label, tamperedPath, expectedCode) => {
    const fixture = await createFixture();
    const registryUrl = await startRegistry(fixture, () => 1, (_request, pathname) => {
      if (pathname !== tamperedPath) return undefined;
      if (pathname.endsWith("index.json")) {
        const path = join(fixture.registryDirectory, "indexes", "1", "index.json");
        const document = JSON.parse(readFileSync(path, "utf8")) as {
          entries: Array<{ bundleManifestSha256: string }>;
        };
        document.entries[0]!.bundleManifestSha256 = "0".repeat(64);
        return { body: JSON.stringify(document) };
      }
      if (pathname.endsWith("bundle.json")) {
        const path = join(
          fixture.registryDirectory,
          "bundles",
          "identity",
          "0.1.0",
          "bundle.json",
        );
        const document = JSON.parse(readFileSync(path, "utf8")) as {
          metadata: { createdAt: string };
        };
        document.metadata.createdAt = "2026-07-26T00:00:01.000Z";
        return { body: JSON.stringify(document) };
      }
      const original = readFileSync(join(
        fixture.registryDirectory,
        "bundles",
        "identity",
        "0.1.0",
        "pack",
        "README.md",
      ));
      original[0] = original[0] === 0x41 ? 0x42 : 0x41;
      return { body: original };
    });

    await expect(fetchRegistryCapability(fetchOptions(fixture, registryUrl))).rejects.toMatchObject({
      code: expectedCode,
    });
    expect(await pathExists(fixture.statePath)).toBe(false);
  });

  it("rejects a stale remote sequence after accepting a newer snapshot", async () => {
    const fixture = await createFixture();
    await createIndex(fixture, 2);
    let latest = 2;
    const registryUrl = await startRegistry(fixture, () => latest);
    await fetchRegistryCapability(fetchOptions(fixture, registryUrl));
    latest = 1;

    await expect(fetchRegistryCapability(fetchOptions(fixture, registryUrl))).rejects.toMatchObject({
      code: "REGISTRY_ROLLBACK_DETECTED",
    });
    const state = JSON.parse(await readFile(fixture.statePath, "utf8")) as {
      registry: { sequence: number };
    };
    expect(state.registry.sequence).toBe(2);
  });

  it("never replaces an existing valid but conflicting cache bundle", async () => {
    const fixture = await createFixture();
    const conflictingSource = join(fixture.root, "conflicting-bundle");
    await createCapabilityBundle({
      packsDirectory: join(workspace, "capabilities"),
      capabilityId: "identity",
      outputDirectory: conflictingSource,
      publisherId: "capability-publisher",
      keyId: "root-1",
      privateKeyPath: fixture.publisherPrivateKeyPath,
      now: () => new Date("2026-07-26T00:01:00.000Z"),
    });
    const cachedBundle = join(fixture.cacheDirectory, "bundles", "identity", "0.1.0");
    await mkdir(dirname(cachedBundle), { recursive: true });
    await cp(conflictingSource, cachedBundle, { recursive: true });
    const before = await readFile(join(cachedBundle, "bundle.json"), "utf8");
    const registryUrl = await startRegistry(fixture, () => 1);

    await expect(fetchRegistryCapability(fetchOptions(fixture, registryUrl))).rejects.toMatchObject({
      code: "REGISTRY_BUNDLE_MISMATCH",
    });
    expect(await readFile(join(cachedBundle, "bundle.json"), "utf8")).toBe(before);
    expect(await pathExists(join(fixture.cacheDirectory, "indexes"))).toBe(false);
    expect(await pathExists(fixture.statePath)).toBe(false);
  });

  it("does not publish cache entries or state after an interrupted file response", async () => {
    const fixture = await createFixture();
    const registryUrl = await startRegistry(fixture, () => 1, (_request, pathname) => (
      pathname.endsWith("/pack/README.md") ? { destroy: true } : undefined
    ));

    await expect(fetchRegistryCapability(fetchOptions(fixture, registryUrl))).rejects.toMatchObject({
      code: "REGISTRY_REQUEST_FAILED",
    });
    expect(await pathExists(join(fixture.cacheDirectory, "indexes"))).toBe(false);
    expect(await pathExists(fixture.statePath)).toBe(false);
  });
});
