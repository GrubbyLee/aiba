import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { CapabilityRegistryTrustPolicy, PublisherTrustPolicy } from "aiba-spec";
import { createCapabilityBundle, generatePublisherKeyPair } from "./bundle.js";
import { createRegistryIndex } from "./registry.js";
import { backupRegistry, planRegistryRetention, restoreRegistry, verifyRegistryForOperations } from "./registry-operations.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];
const NOW = new Date("2026-08-05T00:00:00.000Z");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aiba-registry-ops-test-"));
  roots.push(root);
  const registryDirectory = join(root, "registry");
  await mkdir(registryDirectory);
  const publisherKeys = await generatePublisherKeyPair({ publisherId: "publisher", outputDirectory: join(root, "publisher-keys") });
  const publisherTrustPolicyPath = join(root, "publisher-trust.json");
  const publisherPolicy: PublisherTrustPolicy = { apiVersion: "aiba.dev/v0alpha1", kind: "PublisherTrustPolicy", metadata: { id: "publishers" }, publishers: [{ publisher: "publisher", keyId: "root-1", algorithm: "Ed25519", publicKey: publisherKeys.publicKey, capabilities: ["audit", "identity"] }] };
  await writeFile(publisherTrustPolicyPath, `${JSON.stringify(publisherPolicy, null, 2)}\n`);
  const registryKeys = await generatePublisherKeyPair({ publisherId: "registry-operator", outputDirectory: join(root, "registry-keys") });
  const registryTrustPolicyPath = join(root, "registry-trust.json");
  const registryPolicy: CapabilityRegistryTrustPolicy = { apiVersion: "aiba.dev/v0alpha1", kind: "CapabilityRegistryTrustPolicy", metadata: { id: "registry-trust" }, registries: [{ registry: "ops-registry", publisher: "registry-operator", keyId: "root-1", algorithm: "Ed25519", publicKey: registryKeys.publicKey }] };
  await writeFile(registryTrustPolicyPath, `${JSON.stringify(registryPolicy, null, 2)}\n`);
  await createCapabilityBundle({ packsDirectory: join(workspace, "capabilities"), capabilityId: "audit", outputDirectory: join(registryDirectory, "bundles", "audit", "0.1.0"), publisherId: "publisher", keyId: "root-1", privateKeyPath: publisherKeys.privateKeyPath, now: () => NOW });
  await createRegistryIndex({ registryDirectory, registryId: "ops-registry", publisherId: "registry-operator", keyId: "root-1", privateKeyPath: registryKeys.privateKeyPath, publisherTrustPolicyPath, sequence: 1, expiresAt: new Date("2026-08-06T00:00:00.000Z"), now: () => NOW });
  await createCapabilityBundle({ packsDirectory: join(workspace, "capabilities"), capabilityId: "identity", outputDirectory: join(registryDirectory, "bundles", "identity", "0.1.0"), publisherId: "publisher", keyId: "root-1", privateKeyPath: publisherKeys.privateKeyPath, now: () => NOW });
  await createRegistryIndex({ registryDirectory, registryId: "ops-registry", publisherId: "registry-operator", keyId: "root-1", privateKeyPath: registryKeys.privateKeyPath, publisherTrustPolicyPath, sequence: 2, expiresAt: new Date("2026-08-06T00:00:00.000Z"), now: () => NOW });
  return { root, registryDirectory, publisherTrustPolicyPath, registryTrustPolicyPath, now: () => NOW };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Registry operator workflows", () => {
  it("creates and restores a hash-verified backup atomically", async () => {
    const value = await fixture();
    const backup = join(value.root, "backup");
    const result = await backupRegistry({ ...value, outputDirectory: backup });
    expect(result).toMatchObject({ registry: "ops-registry", latestSequence: 2 });
    const target = join(value.root, "restored");
    await expect(restoreRegistry({ backupDirectory: backup, targetDirectory: target, registryTrustPolicyPath: value.registryTrustPolicyPath, publisherTrustPolicyPath: value.publisherTrustPolicyPath, now: value.now })).resolves.toMatchObject({ registry: "ops-registry", latestSequence: 2 });
    await expect(verifyRegistryForOperations({ registryDirectory: target, registryTrustPolicyPath: value.registryTrustPolicyPath, publisherTrustPolicyPath: value.publisherTrustPolicyPath, now: value.now })).resolves.toMatchObject({ sequences: [1, 2] });
    await expect(restoreRegistry({ backupDirectory: backup, targetDirectory: target, registryTrustPolicyPath: value.registryTrustPolicyPath, publisherTrustPolicyPath: value.publisherTrustPolicyPath, now: value.now })).rejects.toMatchObject({ code: "REGISTRY_RESTORE_TARGET_EXISTS" });
  });

  it("rejects tampered backup bytes before creating a target", async () => {
    const value = await fixture();
    const backup = join(value.root, "backup");
    await backupRegistry({ ...value, outputDirectory: backup });
    await writeFile(join(backup, "registry", "indexes", "2", "index.json"), "{}\n");
    const target = join(value.root, "restored");
    await expect(restoreRegistry({ backupDirectory: backup, targetDirectory: target, registryTrustPolicyPath: value.registryTrustPolicyPath, publisherTrustPolicyPath: value.publisherTrustPolicyPath, now: value.now })).rejects.toMatchObject({ code: "BACKUP_FILE_TAMPERED" });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports retention before applying it and preserves referenced closure", async () => {
    const value = await fixture();
    let plan = await planRegistryRetention({ ...value, keepIndexes: 1 });
    expect(plan).toEqual({ dryRun: true, keptIndexes: [2], removableIndexes: [1], removableBundles: [] });
    await expect(readFile(join(value.registryDirectory, "indexes", "1", "index.json"))).resolves.toBeTruthy();
    plan = await planRegistryRetention({ ...value, keepIndexes: 1, apply: true });
    expect(plan.dryRun).toBe(false);
    await expect(readFile(join(value.registryDirectory, "indexes", "1", "index.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(verifyRegistryForOperations({ registryDirectory: value.registryDirectory, registryTrustPolicyPath: value.registryTrustPolicyPath, publisherTrustPolicyPath: value.publisherTrustPolicyPath, now: value.now })).resolves.toMatchObject({ sequences: [2] });
  });
});
