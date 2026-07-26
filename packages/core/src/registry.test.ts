import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import type {
  CapabilityRegistryState,
  CapabilityRegistryTrustPolicy,
  PublisherTrustPolicy,
} from "aiba-spec";
import { createCapabilityBundle, generatePublisherKeyPair } from "./bundle.js";
import { createRegistryIndex, resolveRegistryCapability } from "./registry.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];
const NOW = new Date("2026-07-26T00:00:00.000Z");
const TOMORROW = new Date("2026-07-27T00:00:00.000Z");

interface RegistryFixture {
  root: string;
  registryDirectory: string;
  publisherTrustPolicyPath: string;
  registryTrustPolicyPath: string;
  publisherPrivateKeyPath: string;
  registryPrivateKeyPath: string;
  statePath: string;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aiba-registry-test-"));
  roots.push(root);
  return root;
}

async function writePublisherPolicy(
  path: string,
  publicKey: string,
): Promise<void> {
  const policy: PublisherTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "PublisherTrustPolicy",
    metadata: { id: "publisher-policy" },
    publishers: [{
      publisher: "capability-publisher",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey,
      capabilities: ["audit", "identity"],
    }],
  };
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`);
}

async function writeRegistryPolicy(
  path: string,
  publicKey: string,
  overrides: Partial<CapabilityRegistryTrustPolicy["registries"][number]> = {},
): Promise<void> {
  const policy: CapabilityRegistryTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "CapabilityRegistryTrustPolicy",
    metadata: { id: "registry-policy" },
    registries: [{
      registry: "local-registry",
      publisher: "registry-operator",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey,
      ...overrides,
    }],
  };
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`);
}

async function createFixture(capabilities = ["identity"]): Promise<RegistryFixture> {
  const root = await temporaryRoot();
  const registryDirectory = join(root, "registry");
  await mkdir(join(registryDirectory, "bundles"), { recursive: true });
  const publisherKeys = await generatePublisherKeyPair({
    publisherId: "capability-publisher",
    outputDirectory: join(root, "publisher-keys"),
  });
  const publisherTrustPolicyPath = join(root, "publisher-trust.json");
  await writePublisherPolicy(publisherTrustPolicyPath, publisherKeys.publicKey);
  for (const capability of capabilities) {
    await createCapabilityBundle({
      packsDirectory: join(workspace, "capabilities"),
      capabilityId: capability,
      outputDirectory: join(
        registryDirectory,
        "bundles",
        capability,
        "0.1.0",
      ),
      publisherId: "capability-publisher",
      keyId: "root-1",
      privateKeyPath: publisherKeys.privateKeyPath,
      now: () => NOW,
    });
  }
  const registryKeys = await generatePublisherKeyPair({
    publisherId: "registry-operator",
    outputDirectory: join(root, "registry-keys"),
  });
  const registryTrustPolicyPath = join(root, "registry-trust.json");
  await writeRegistryPolicy(registryTrustPolicyPath, registryKeys.publicKey);
  return {
    root,
    registryDirectory,
    publisherTrustPolicyPath,
    registryTrustPolicyPath,
    publisherPrivateKeyPath: publisherKeys.privateKeyPath,
    registryPrivateKeyPath: registryKeys.privateKeyPath,
    statePath: join(root, "state", "local-registry.json"),
  };
}

async function addIdentityVersion(fixture: RegistryFixture, version: string): Promise<void> {
  const packsDirectory = join(fixture.root, `identity-${version}-packs`);
  const packDirectory = join(packsDirectory, "identity");
  await mkdir(packsDirectory, { recursive: true });
  await cp(join(workspace, "capabilities", "identity"), packDirectory, { recursive: true });
  const manifestPath = join(packDirectory, "capability.yaml");
  const manifest = parse(await readFile(manifestPath, "utf8")) as {
    metadata: { version: string };
  };
  manifest.metadata.version = version;
  await writeFile(manifestPath, stringify(manifest));
  const recipePath = join(packDirectory, "recipes", "typescript-reference.yaml");
  const recipe = parse(await readFile(recipePath, "utf8")) as {
    metadata: { version: string };
    spec: { capability: { version: string } };
  };
  recipe.metadata.version = version;
  recipe.spec.capability.version = version;
  await writeFile(recipePath, stringify(recipe));
  await createCapabilityBundle({
    packsDirectory,
    capabilityId: "identity",
    outputDirectory: join(
      fixture.registryDirectory,
      "bundles",
      "identity",
      version,
    ),
    publisherId: "capability-publisher",
    keyId: "root-1",
    privateKeyPath: fixture.publisherPrivateKeyPath,
    now: () => NOW,
  });
}

async function createIndex(
  fixture: RegistryFixture,
  sequence: number,
  now = NOW,
  expiresAt = TOMORROW,
) {
  return createRegistryIndex({
    registryDirectory: fixture.registryDirectory,
    registryId: "local-registry",
    publisherId: "registry-operator",
    keyId: "root-1",
    privateKeyPath: fixture.registryPrivateKeyPath,
    publisherTrustPolicyPath: fixture.publisherTrustPolicyPath,
    sequence,
    expiresAt,
    now: () => now,
  });
}

async function resolveIdentity(
  fixture: RegistryFixture,
  now = NOW,
) {
  return resolveRegistryCapability({
    registryDirectory: fixture.registryDirectory,
    registryTrustPolicyPath: fixture.registryTrustPolicyPath,
    publisherTrustPolicyPath: fixture.publisherTrustPolicyPath,
    statePath: fixture.statePath,
    capabilityId: "identity",
    now: () => now,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

describe("signed capability registries", () => {
  it("indexes verified bundles and resolves without executing them", async () => {
    const fixture = await createFixture(["identity", "audit"]);
    const created = await createIndex(fixture, 1);
    expect(created).toMatchObject({
      registry: "local-registry",
      sequence: 1,
      entries: 2,
    });

    const resolved = await resolveIdentity(fixture);
    expect(resolved).toMatchObject({
      registry: "local-registry",
      sequence: 1,
      capability: "identity",
      version: "0.1.0",
      publisher: "capability-publisher",
    });
    expect(resolved.packDirectory).toBe(join(resolved.bundleDirectory, "pack"));
    const state = JSON.parse(await readFile(fixture.statePath, "utf8")) as CapabilityRegistryState;
    expect(state.registry).toMatchObject({
      id: "local-registry",
      sequence: 1,
      indexSha256: created.indexSha256,
    });
    expect((await lstat(fixture.statePath)).mode & 0o777).toBe(0o600);
  });

  it("selects the highest version unless an exact version is requested", async () => {
    const fixture = await createFixture();
    await addIdentityVersion(fixture, "0.2.0");
    await createIndex(fixture, 1);

    await expect(resolveIdentity(fixture)).resolves.toMatchObject({
      capability: "identity",
      version: "0.2.0",
    });
    await expect(resolveRegistryCapability({
      registryDirectory: fixture.registryDirectory,
      registryTrustPolicyPath: fixture.registryTrustPolicyPath,
      publisherTrustPolicyPath: fixture.publisherTrustPolicyPath,
      statePath: fixture.statePath,
      capabilityId: "identity",
      version: "0.1.0",
      now: () => NOW,
    })).resolves.toMatchObject({ capability: "identity", version: "0.1.0" });
  });

  it("rejects tampered index content and signatures", async () => {
    const contentFixture = await createFixture();
    await createIndex(contentFixture, 1);
    const indexPath = join(contentFixture.registryDirectory, "indexes", "1", "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      entries: Array<{ bundleManifestSha256: string }>;
    };
    index.entries[0]!.bundleManifestSha256 = "0".repeat(64);
    await writeFile(indexPath, JSON.stringify(index));
    await expect(resolveIdentity(contentFixture)).rejects.toMatchObject({
      code: "REGISTRY_INDEX_TAMPERED",
    });

    const signatureFixture = await createFixture();
    await createIndex(signatureFixture, 1);
    const signaturePath = join(
      signatureFixture.registryDirectory,
      "indexes",
      "1",
      "index.sig.json",
    );
    const signature = JSON.parse(await readFile(signaturePath, "utf8")) as {
      signature: string;
    };
    signature.signature = `${signature.signature.startsWith("A") ? "B" : "A"}${signature.signature.slice(1)}`;
    await writeFile(signaturePath, JSON.stringify(signature));
    await expect(resolveIdentity(signatureFixture)).rejects.toMatchObject({
      code: "REGISTRY_SIGNATURE_INVALID",
    });
  });

  it("requires the exact trusted registry signer", async () => {
    const fixture = await createFixture();
    await createIndex(fixture, 1);
    const publicKey = await readFile(join(fixture.root, "registry-keys", "public.pem"), "utf8");
    await writeRegistryPolicy(fixture.registryTrustPolicyPath, publicKey, {
      registry: "other-registry",
    });

    await expect(resolveIdentity(fixture)).rejects.toMatchObject({
      code: "UNTRUSTED_REGISTRY_SIGNER",
    });
  });

  it("rejects rollback and same-sequence equivocation", async () => {
    const fixture = await createFixture();
    const first = await createIndex(fixture, 1);
    await resolveIdentity(fixture);
    await createIndex(
      fixture,
      2,
      new Date("2026-07-26T01:00:00.000Z"),
      new Date("2026-07-27T01:00:00.000Z"),
    );
    await resolveIdentity(fixture, new Date("2026-07-26T01:00:00.000Z"));
    await rm(join(fixture.registryDirectory, "indexes", "2"), {
      recursive: true,
      force: true,
    });
    await expect(resolveIdentity(
      fixture,
      new Date("2026-07-26T02:00:00.000Z"),
    )).rejects.toMatchObject({ code: "REGISTRY_ROLLBACK_DETECTED" });

    const state: CapabilityRegistryState = {
      apiVersion: "aiba.dev/v0alpha1",
      kind: "CapabilityRegistryState",
      registry: {
        id: "local-registry",
        sequence: 1,
        indexSha256: "0".repeat(64),
        verifiedAt: NOW.toISOString(),
      },
    };
    await writeFile(fixture.statePath, JSON.stringify(state));
    expect(first.indexSha256).not.toBe(state.registry.indexSha256);
    await expect(resolveIdentity(fixture)).rejects.toMatchObject({
      code: "REGISTRY_EQUIVOCATION_DETECTED",
    });
  });

  it("rejects expired and future-dated indexes", async () => {
    const expired = await createFixture();
    await createIndex(expired, 1, NOW, new Date("2026-07-26T01:00:00.000Z"));
    await expect(resolveIdentity(
      expired,
      new Date("2026-07-26T02:00:00.000Z"),
    )).rejects.toMatchObject({ code: "REGISTRY_INDEX_EXPIRED" });

    const future = await createFixture();
    await createIndex(
      future,
      1,
      new Date("2026-07-26T01:00:00.000Z"),
      new Date("2026-07-27T01:00:00.000Z"),
    );
    await expect(resolveIdentity(future, NOW)).rejects.toMatchObject({
      code: "REGISTRY_INDEX_FROM_FUTURE",
    });
  });

  it("does not advance rollback state when the selected bundle fails", async () => {
    const fixture = await createFixture();
    await createIndex(fixture, 1);
    await writeFile(
      join(
        fixture.registryDirectory,
        "bundles",
        "identity",
        "0.1.0",
        "pack",
        "README.md",
      ),
      "tampered\n",
    );

    await expect(resolveIdentity(fixture)).rejects.toMatchObject({
      code: "BUNDLE_FILE_TAMPERED",
    });
    await expect(lstat(fixture.statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects identity mismatches, symlink snapshots, and reused sequences", async () => {
    const mismatch = await createFixture(["identity", "audit"]);
    await createIndex(mismatch, 1);
    const identityBundle = join(
      mismatch.registryDirectory,
      "bundles",
      "identity",
      "0.1.0",
    );
    await rm(identityBundle, { recursive: true, force: true });
    await cp(
      join(mismatch.registryDirectory, "bundles", "audit", "0.1.0"),
      identityBundle,
      { recursive: true },
    );
    await expect(resolveIdentity(mismatch)).rejects.toMatchObject({
      code: "REGISTRY_BUNDLE_MISMATCH",
    });

    const symlinkFixture = await createFixture();
    await createIndex(symlinkFixture, 1);
    const snapshot = join(symlinkFixture.registryDirectory, "indexes", "1");
    const movedSnapshot = join(symlinkFixture.registryDirectory, "snapshot-real");
    await cp(snapshot, movedSnapshot, { recursive: true });
    await rm(snapshot, { recursive: true, force: true });
    await symlink(movedSnapshot, snapshot, "dir");
    await expect(resolveIdentity(symlinkFixture)).rejects.toMatchObject({
      code: "INVALID_REGISTRY_LAYOUT",
    });

    const sequenceFixture = await createFixture();
    await createIndex(sequenceFixture, 1);
    await expect(createIndex(sequenceFixture, 1)).rejects.toMatchObject({
      code: "REGISTRY_SEQUENCE_NOT_INCREASING",
    });
  });
});
