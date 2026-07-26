import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PublisherTrustPolicy } from "@aiba/spec";
import { createCapabilityBundle, generatePublisherKeyPair } from "./bundle.js";
import { importRegistryBundle } from "./registry.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];

async function createFixture(): Promise<{
  root: string;
  registryDirectory: string;
  trustPolicyPath: string;
  privateKeyPath: string;
  bundleDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "aiba-registry-import-test-"));
  roots.push(root);
  const registryDirectory = join(root, "registry");
  await mkdir(registryDirectory);
  const keys = await generatePublisherKeyPair({
    publisherId: "aiba-official",
    outputDirectory: join(root, "keys"),
  });
  const trustPolicyPath = join(root, "publisher-trust.json");
  const policy: PublisherTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "PublisherTrustPolicy",
    metadata: { id: "publisher-policy" },
    publishers: [{
      publisher: "aiba-official",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey: keys.publicKey,
      capabilities: ["identity"],
    }],
  };
  await writeFile(trustPolicyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const bundleDirectory = join(root, "identity-bundle");
  await createCapabilityBundle({
    packsDirectory: join(workspace, "capabilities"),
    capabilityId: "identity",
    outputDirectory: bundleDirectory,
    publisherId: "aiba-official",
    keyId: "root-1",
    privateKeyPath: keys.privateKeyPath,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  return {
    root,
    registryDirectory,
    trustPolicyPath,
    privateKeyPath: keys.privateKeyPath,
    bundleDirectory,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

describe("registry bundle import", () => {
  it("atomically imports a verified bundle and is idempotent", async () => {
    const fixture = await createFixture();
    const options = {
      registryDirectory: fixture.registryDirectory,
      bundleDirectory: fixture.bundleDirectory,
      publisherTrustPolicyPath: fixture.trustPolicyPath,
    };

    await expect(importRegistryBundle(options)).resolves.toMatchObject({
      imported: true,
      capability: "identity",
      version: "0.1.0",
      publisher: "aiba-official",
    });
    await expect(importRegistryBundle(options)).resolves.toMatchObject({
      imported: false,
      capability: "identity",
    });
  });

  it("never replaces an existing valid bundle with conflicting signed content", async () => {
    const fixture = await createFixture();
    await importRegistryBundle({
      registryDirectory: fixture.registryDirectory,
      bundleDirectory: fixture.bundleDirectory,
      publisherTrustPolicyPath: fixture.trustPolicyPath,
    });
    const destination = join(
      fixture.registryDirectory,
      "bundles",
      "identity",
      "0.1.0",
      "bundle.json",
    );
    const before = await readFile(destination, "utf8");
    const conflictingBundle = join(fixture.root, "conflicting-bundle");
    await createCapabilityBundle({
      packsDirectory: join(workspace, "capabilities"),
      capabilityId: "identity",
      outputDirectory: conflictingBundle,
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: fixture.privateKeyPath,
      now: () => new Date("2026-07-26T00:01:00.000Z"),
    });

    await expect(importRegistryBundle({
      registryDirectory: fixture.registryDirectory,
      bundleDirectory: conflictingBundle,
      publisherTrustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "REGISTRY_BUNDLE_CONFLICT" });
    await expect(readFile(destination, "utf8")).resolves.toBe(before);
  });

  it("rejects tampered source content before creating registry directories", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.bundleDirectory, "pack", "README.md"), "tampered\n");

    await expect(importRegistryBundle({
      registryDirectory: fixture.registryDirectory,
      bundleDirectory: fixture.bundleDirectory,
      publisherTrustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_FILE_TAMPERED" });
    await expect(lstat(join(fixture.registryDirectory, "bundles")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
