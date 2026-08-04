import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CapabilityRegistryTrustPolicy,
  PublisherTrustPolicy,
} from "aiba-spec";
import {
  createCapabilityBundle,
  createRegistryIndex,
  fetchRegistryCapability,
  generatePublisherKeyPair,
} from "aiba-core";
import { createRegistryServer, type RegistryServerOptions } from "./index.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];
const servers: Array<Awaited<ReturnType<typeof createRegistryServer>>["server"]> = [];
const NOW = new Date("2026-07-26T00:00:00.000Z");
const TOKEN = "reference-registry-read-token";
const execFileAsync = promisify(execFile);

interface ServerFixture {
  root: string;
  registryDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  options: RegistryServerOptions;
}

async function createFixture(): Promise<ServerFixture> {
  const root = await mkdtemp(join(tmpdir(), "aiba-registry-server-test-"));
  roots.push(root);
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
      registry: "reference-registry",
      publisher: "registry-operator",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey: registryKeys.publicKey,
    }],
  };
  await writeFile(registryTrustPolicyPath, `${JSON.stringify(registryPolicy, null, 2)}\n`);
  await createRegistryIndex({
    registryDirectory,
    registryId: "reference-registry",
    publisherId: "registry-operator",
    keyId: "root-1",
    privateKeyPath: registryKeys.privateKeyPath,
    publisherTrustPolicyPath,
    sequence: 1,
    expiresAt: new Date("2026-07-27T00:00:00.000Z"),
    now: () => NOW,
  });
  const options = {
    registryDirectory,
    registryTrustPolicyPath,
    publisherTrustPolicyPath,
    token: TOKEN,
    now: () => NOW,
  };
  return {
    root,
    registryDirectory,
    registryTrustPolicyPath,
    publisherTrustPolicyPath,
    options,
  };
}

async function start(fixture: ServerFixture): Promise<string> {
  const created = await createRegistryServer(fixture.options);
  servers.push(created.server);
  await new Promise<void>((resolvePromise, reject) => {
    created.server.once("error", reject);
    created.server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = created.server.address();
  if (!address || typeof address === "string") throw new Error("Registry server did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

function request(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...init.headers,
    },
  });
}

async function rawStatus(baseUrl: string, path: string): Promise<number> {
  const url = new URL(baseUrl);
  return new Promise<number>((resolvePromise, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path,
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
    }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end();
  });
}

async function secureGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const request = httpsRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      rejectUnauthorized: false,
      headers: { authorization: `Bearer ${TOKEN}` },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolvePromise({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => {
    server.closeAllConnections();
    server.close(() => resolvePromise());
  })));
  await Promise.all(roots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

describe("reference registry server", () => {
  it("serves authenticated health, readiness, metrics, limits, and redacted audit events", async () => {
    const fixture = await createFixture();
    const events: Array<{ event: string; routeClass: string; status: number }> = [];
    fixture.options.requestLimitPerMinute = 4;
    fixture.options.audit = (event) => events.push(event);
    const baseUrl = await start(fixture);
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(401);
    await expect((await request(baseUrl, "/healthz")).json()).resolves.toEqual({ status: "ok" });
    await expect((await request(baseUrl, "/readyz")).json()).resolves.toEqual({
      status: "ready",
      registry: "reference-registry",
      sequence: 1,
    });
    const metrics = await (await request(baseUrl, "/metrics")).text();
    expect(metrics).toContain("aiba_registry_up 1");
    expect(metrics).toContain("aiba_registry_unauthorized_total 1");
    expect((await request(baseUrl, "/healthz")).status).toBe(200);
    const limited = await request(baseUrl, "/healthz");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "unauthorized", routeClass: "health", status: 401 }),
      expect.objectContaining({ event: "rate-limited", routeClass: "health", status: 429 }),
    ]));
  });

  it("serves only verified indexed content through authenticated GET and HEAD", async () => {
    const fixture = await createFixture();
    const baseUrl = await start(fixture);

    const latest = await request(baseUrl, "/v0/indexes/latest.json");
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toEqual({ sequence: 1 });
    expect(latest.headers.get("cache-control")).toBe("no-store");
    expect(latest.headers.get("x-content-type-options")).toBe("nosniff");

    const head = await request(baseUrl, "/v0/bundles/identity/0.1.0/bundle.json", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
    await expect(head.text()).resolves.toBe("");
    expect((await request(baseUrl, "/v0/bundles/audit/0.1.0/bundle.json")).status)
      .toBe(404);
  });

  it("interoperates with Core authenticated fetch and verified caching", async () => {
    const fixture = await createFixture();
    const baseUrl = await start(fixture);
    const result = await fetchRegistryCapability({
      registryUrl: baseUrl,
      cacheDirectory: join(fixture.root, "client-cache"),
      registryTrustPolicyPath: fixture.registryTrustPolicyPath,
      publisherTrustPolicyPath: fixture.publisherTrustPolicyPath,
      statePath: join(fixture.root, "client-state.json"),
      capabilityId: "identity",
      environment: { AIBA_REGISTRY_TOKEN: TOKEN },
      allowInsecureLocalhost: true,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      registry: "reference-registry",
      sequence: 1,
      capability: "identity",
      version: "0.1.0",
    });
  });

  it("rejects missing credentials, mutations, queries, and encoded paths", async () => {
    const fixture = await createFixture();
    const baseUrl = await start(fixture);

    expect((await fetch(`${baseUrl}/v0/indexes/latest.json`)).status).toBe(401);
    const mutation = await request(baseUrl, "/v0/indexes/latest.json", { method: "POST" });
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET, HEAD");
    expect((await request(baseUrl, "/v0/indexes/latest.json?sequence=0")).status).toBe(400);
    await expect(rawStatus(baseUrl, "/v0/bundles/%2e%2e/secret")).resolves.toBe(400);
  });

  it("refuses startup when indexed bundle content is invalid", async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.registryDirectory, "bundles", "identity", "0.1.0", "pack", "README.md"),
      "tampered\n",
    );

    await expect(createRegistryServer(fixture.options)).rejects.toMatchObject({
      code: "BUNDLE_FILE_TAMPERED",
    });
  });

  it("does not follow a route file replaced by a symlink after startup", async () => {
    const fixture = await createFixture();
    const baseUrl = await start(fixture);
    const readme = join(
      fixture.registryDirectory,
      "bundles",
      "identity",
      "0.1.0",
      "pack",
      "README.md",
    );
    const moved = join(fixture.root, "original-readme.md");
    const secret = join(fixture.root, "outside-secret.txt");
    await rename(readme, moved);
    await writeFile(secret, "must-not-be-served\n");
    await symlink(secret, readme);

    const response = await request(baseUrl, "/v0/bundles/identity/0.1.0/pack/README.md");
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("must-not-be-served");
    await expect(readFile(moved, "utf8")).resolves.toContain("Identity");
  });

  it("requires complete TLS configuration and a valid environment token", async () => {
    const fixture = await createFixture();
    await expect(createRegistryServer({
      ...fixture.options,
      token: "",
    })).rejects.toMatchObject({ code: "REGISTRY_TOKEN_INVALID" });
    await expect(createRegistryServer({
      ...fixture.options,
      tlsCertificatePath: join(fixture.root, "cert.pem"),
    })).rejects.toMatchObject({ code: "INCOMPLETE_TLS_CONFIG" });
    await expect(createRegistryServer({
      ...fixture.options,
      requestLimitPerMinute: 0,
    })).rejects.toMatchObject({ code: "INVALID_REGISTRY_REQUEST_LIMIT" });
  });

  it("serves the same verified route set over direct TLS", async () => {
    const fixture = await createFixture();
    const certificate = join(fixture.root, "tls-cert.pem");
    const privateKey = join(fixture.root, "tls-key.pem");
    await execFileAsync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      privateKey,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ]);
    await chmod(privateKey, 0o600);
    const created = await createRegistryServer({
      ...fixture.options,
      tlsCertificatePath: certificate,
      tlsPrivateKeyPath: privateKey,
    });
    servers.push(created.server);
    await new Promise<void>((resolvePromise) => created.server.listen(0, "127.0.0.1", resolvePromise));
    const address = created.server.address();
    if (!address || typeof address === "string") throw new Error("TLS registry did not bind TCP");

    expect(created.secure).toBe(true);
    await expect(secureGet(address.port, "/v0/indexes/latest.json")).resolves.toEqual({
      status: 200,
      body: "{\"sequence\":1}\n",
    });
  });
});
