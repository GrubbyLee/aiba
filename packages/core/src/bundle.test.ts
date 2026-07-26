import { generateKeyPairSync } from "node:crypto";
import {
  chmod,
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
import type { PublisherTrustPolicy } from "aiba-spec";
import {
  createCapabilityBundle,
  generatePublisherKeyPair,
  verifyCapabilityBundle,
} from "./bundle.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const temporaryRoots: string[] = [];

interface BundleFixture {
  root: string;
  keyDirectory: string;
  bundleDirectory: string;
  trustPolicyPath: string;
  publicKey: string;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aiba-bundle-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeTrustPolicy(
  path: string,
  publicKey: string,
  overrides: Partial<PublisherTrustPolicy["publishers"][number]> = {},
): Promise<void> {
  const policy: PublisherTrustPolicy = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "PublisherTrustPolicy",
    metadata: { id: "test-policy" },
    publishers: [{
      publisher: "aiba-official",
      keyId: "root-1",
      algorithm: "Ed25519",
      publicKey,
      capabilities: ["identity"],
      ...overrides,
    }],
  };
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`);
}

async function createFixture(capabilityId = "identity"): Promise<BundleFixture> {
  const root = await temporaryRoot();
  const keyDirectory = join(root, "keys");
  const keys = await generatePublisherKeyPair({
    publisherId: "aiba-official",
    keyId: "root-1",
    outputDirectory: keyDirectory,
  });
  const bundleDirectory = join(root, "bundle");
  await createCapabilityBundle({
    packsDirectory: join(workspace, "capabilities"),
    capabilityId,
    outputDirectory: bundleDirectory,
    publisherId: "aiba-official",
    keyId: "root-1",
    privateKeyPath: keys.privateKeyPath,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  const trustPolicyPath = join(root, "trust-policy.json");
  await writeTrustPolicy(trustPolicyPath, keys.publicKey, {
    capabilities: [capabilityId],
  });
  return {
    root,
    keyDirectory,
    bundleDirectory,
    trustPolicyPath,
    publicKey: keys.publicKey,
  };
}

async function copiedPack(source: string, capabilityId: string): Promise<{
  root: string;
  packsDirectory: string;
  packDirectory: string;
}> {
  const root = await temporaryRoot();
  const packsDirectory = join(root, "packs");
  const packDirectory = join(packsDirectory, capabilityId);
  await mkdir(packsDirectory, { recursive: true });
  await cp(source, packDirectory, { recursive: true });
  return { root, packsDirectory, packDirectory };
}

async function signingKey(root: string) {
  return generatePublisherKeyPair({
    publisherId: "aiba-official",
    outputDirectory: join(root, "keys"),
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

describe("signed capability bundles", () => {
  it("creates and verifies an official identity bundle", async () => {
    const fixture = await createFixture();

    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).resolves.toMatchObject({
      ok: true,
      capability: "identity",
      version: "0.1.0",
      publisher: "aiba-official",
      keyId: "root-1",
      files: 3,
    });
    const bundlePath = join(fixture.bundleDirectory, "bundle.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
    await writeFile(bundlePath, JSON.stringify(bundle));
    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).resolves.toMatchObject({ ok: true, capability: "identity" });
    expect((await lstat(join(fixture.keyDirectory, "private.pem"))).mode & 0o777).toBe(0o600);
  });

  it("rejects a modified pack file", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.bundleDirectory, "pack", "README.md"), "tampered\n");

    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_FILE_TAMPERED" });
  });

  it("rejects modified manifests and signatures", async () => {
    const manifestFixture = await createFixture();
    const manifestPath = join(manifestFixture.bundleDirectory, "bundle.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      metadata: { createdAt: string };
    };
    manifest.metadata.createdAt = "2026-07-26T01:00:00.000Z";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyCapabilityBundle({
      bundleDirectory: manifestFixture.bundleDirectory,
      trustPolicyPath: manifestFixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_MANIFEST_TAMPERED" });

    const signatureFixture = await createFixture();
    const signaturePath = join(signatureFixture.bundleDirectory, "bundle.sig.json");
    const signature = JSON.parse(await readFile(signaturePath, "utf8")) as {
      signature: string;
    };
    signature.signature = `${signature.signature[0] === "A" ? "B" : "A"}${signature.signature.slice(1)}`;
    await writeFile(signaturePath, JSON.stringify(signature));
    await expect(verifyCapabilityBundle({
      bundleDirectory: signatureFixture.bundleDirectory,
      trustPolicyPath: signatureFixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_SIGNATURE_INVALID" });
  });

  it("requires an exact trusted publisher, key, and capability", async () => {
    const fixture = await createFixture();
    await writeTrustPolicy(fixture.trustPolicyPath, fixture.publicKey, {
      publisher: "other-publisher",
    });
    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "UNTRUSTED_PUBLISHER_KEY" });

    await writeTrustPolicy(fixture.trustPolicyPath, fixture.publicKey, {
      capabilities: ["audit"],
    });
    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "CAPABILITY_NOT_TRUSTED" });
  });

  it("rejects symlinks, scripts, and undeclared files", async () => {
    const symlinkPack = await copiedPack(
      join(workspace, "capabilities", "identity"),
      "identity",
    );
    const symlinkKeys = await signingKey(symlinkPack.root);
    await symlink(
      join(symlinkPack.packDirectory, "README.md"),
      join(symlinkPack.packDirectory, "recipes", "linked.yaml"),
    );
    await expect(createCapabilityBundle({
      packsDirectory: symlinkPack.packsDirectory,
      capabilityId: "identity",
      outputDirectory: join(symlinkPack.root, "bundle"),
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: symlinkKeys.privateKeyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_SYMLINK_REJECTED" });

    const scriptPack = await copiedPack(
      join(workspace, "capabilities", "identity"),
      "identity",
    );
    const scriptKeys = await signingKey(scriptPack.root);
    await writeFile(join(scriptPack.packDirectory, "install.sh"), "exit 0\n");
    await chmod(join(scriptPack.packDirectory, "install.sh"), 0o755);
    await expect(createCapabilityBundle({
      packsDirectory: scriptPack.packsDirectory,
      capabilityId: "identity",
      outputDirectory: join(scriptPack.root, "bundle"),
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: scriptKeys.privateKeyPath,
    })).rejects.toMatchObject({ code: "FORBIDDEN_BUNDLE_PATH" });

    const fixture = await createFixture();
    await writeFile(
      join(fixture.bundleDirectory, "pack", "recipes", "undeclared.yaml"),
      await readFile(join(fixture.bundleDirectory, "pack", "recipes", "typescript-reference.yaml")),
    );
    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_FILE_SET_MISMATCH" });

    const bundleLink = join(fixture.root, "bundle-link");
    await symlink(fixture.bundleDirectory, bundleLink, "dir");
    await expect(verifyCapabilityBundle({
      bundleDirectory: bundleLink,
      trustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "INVALID_BUNDLE_LAYOUT" });
  });

  it("does not replace existing bundle output", async () => {
    const root = await temporaryRoot();
    const keys = await signingKey(root);
    const output = join(root, "existing-bundle");
    const sentinel = join(output, "owned.txt");
    await mkdir(output);
    await writeFile(sentinel, "preserve me\n");

    await expect(createCapabilityBundle({
      packsDirectory: join(workspace, "capabilities"),
      capabilityId: "identity",
      outputDirectory: output,
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: keys.privateKeyPath,
    })).rejects.toMatchObject({ code: "BUNDLE_OUTPUT_EXISTS" });
    await expect(readFile(sentinel, "utf8")).resolves.toBe("preserve me\n");
  });

  it("rejects path traversal and non-Ed25519 keys", async () => {
    const fixture = await createFixture();
    const manifestPath = join(fixture.bundleDirectory, "bundle.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    manifest.files[0]!.path = "pack/recipes\\..\\capability.yaml";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyCapabilityBundle({
      bundleDirectory: fixture.bundleDirectory,
      trustPolicyPath: fixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "FORBIDDEN_BUNDLE_PATH" });

    const rsaRoot = await temporaryRoot();
    const rsa = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const rsaPrivate = join(rsaRoot, "rsa-private.pem");
    await writeFile(rsaPrivate, rsa.privateKey, { mode: 0o600 });
    await expect(createCapabilityBundle({
      packsDirectory: join(workspace, "capabilities"),
      capabilityId: "identity",
      outputDirectory: join(rsaRoot, "bundle"),
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: rsaPrivate,
    })).rejects.toMatchObject({ code: "UNSUPPORTED_SIGNING_KEY" });

    const publicKeyFixture = await createFixture();
    await writeTrustPolicy(publicKeyFixture.trustPolicyPath, rsa.publicKey);
    await expect(verifyCapabilityBundle({
      bundleDirectory: publicKeyFixture.bundleDirectory,
      trustPolicyPath: publicKeyFixture.trustPolicyPath,
    })).rejects.toMatchObject({ code: "UNSUPPORTED_SIGNING_KEY" });
  });

  it("rejects capability, recipe, and migration semantic mismatches", async () => {
    const capabilityPack = await copiedPack(
      join(workspace, "capabilities", "identity"),
      "identity",
    );
    const capabilityKeys = await signingKey(capabilityPack.root);
    const capabilityPath = join(capabilityPack.packDirectory, "capability.yaml");
    const capability = parse(await readFile(capabilityPath, "utf8")) as {
      metadata: { id: string };
    };
    capability.metadata.id = "audit";
    await writeFile(capabilityPath, stringify(capability));
    await expect(createCapabilityBundle({
      packsDirectory: capabilityPack.packsDirectory,
      capabilityId: "identity",
      outputDirectory: join(capabilityPack.root, "bundle"),
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: capabilityKeys.privateKeyPath,
    })).rejects.toMatchObject({ code: "CAPABILITY_ID_MISMATCH" });

    const recipePack = await copiedPack(
      join(workspace, "capabilities", "identity"),
      "identity",
    );
    const recipeKeys = await signingKey(recipePack.root);
    const recipePath = join(recipePack.packDirectory, "recipes", "typescript-reference.yaml");
    const recipe = parse(await readFile(recipePath, "utf8")) as {
      spec: { capability: { version: string } };
    };
    recipe.spec.capability.version = "9.9.9";
    await writeFile(recipePath, stringify(recipe));
    await expect(createCapabilityBundle({
      packsDirectory: recipePack.packsDirectory,
      capabilityId: "identity",
      outputDirectory: join(recipePack.root, "bundle"),
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: recipeKeys.privateKeyPath,
    })).rejects.toMatchObject({ code: "RECIPE_CAPABILITY_MISMATCH" });

    const migrationPack = await copiedPack(
      join(workspace, "fixtures", "capability-packs", "review-access-v2", "review-access"),
      "review-access",
    );
    const migrationKeys = await signingKey(migrationPack.root);
    await writeFile(join(migrationPack.packDirectory, "README.md"), "# Review access v2\n");
    const migrationPath = join(
      migrationPack.packDirectory,
      "migrations",
      "0.1.0-to-0.2.0.yaml",
    );
    const migration = parse(await readFile(migrationPath, "utf8")) as {
      spec: { operations: Array<{ affectedInvariants: string[] }> };
    };
    migration.spec.operations[0]!.affectedInvariants = ["unknown-invariant"];
    await writeFile(migrationPath, stringify(migration));
    await expect(createCapabilityBundle({
      packsDirectory: migrationPack.packsDirectory,
      capabilityId: "review-access",
      outputDirectory: join(migrationPack.root, "bundle"),
      publisherId: "aiba-official",
      keyId: "root-1",
      privateKeyPath: migrationKeys.privateKeyPath,
    })).rejects.toMatchObject({ code: "UNKNOWN_MIGRATION_INVARIANT" });
  });
});
