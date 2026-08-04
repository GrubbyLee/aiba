import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { AibaError } from "./errors.js";
import { sha256File } from "./hash.js";
import { verifyCapabilityBundle } from "./bundle.js";
import { verifyRegistryIndexSnapshot } from "./registry.js";

interface BackupManifest {
  format: "aiba-registry-backup/v1";
  createdAt: string;
  registry: string;
  latestSequence: number;
  files: Array<{ path: string; size: number; sha256: string }>;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function safeRelative(path: string): boolean {
  return path.length > 0 && path === posix.normalize(path) && !path.startsWith("/") && !path.split("/").includes("..") && !path.includes("\\") && !path.includes("\0");
}

async function regularFiles(root: string): Promise<Array<{ absolute: string; relative: string }>> {
  const files: Array<{ absolute: string; relative: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new AibaError("Registry operations reject symlinks", "REGISTRY_OPERATION_SYMLINK");
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push({ absolute, relative: relative(root, absolute).split(sep).join("/") });
      else throw new AibaError("Registry operations reject special files", "REGISTRY_OPERATION_SPECIAL_FILE");
    }
  }
  await visit(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function sequences(root: string): Promise<number[]> {
  const entries = await readdir(join(root, "indexes"), { withFileTypes: true });
  const values = entries.map((entry) => Number(entry.name));
  if (values.some((value, index) => !entries[index]!.isDirectory() || entries[index]!.isSymbolicLink() || !Number.isSafeInteger(value) || value < 1 || String(value) !== entries[index]!.name)) throw new AibaError("Registry index layout is invalid", "INVALID_REGISTRY_LAYOUT");
  return values.sort((a, b) => a - b);
}

export async function verifyRegistryForOperations(options: {
  registryDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  now?: () => Date;
}): Promise<{ registry: string; sequences: number[]; bundles: string[] }> {
  const root = resolve(options.registryDirectory);
  const values = await sequences(root);
  if (values.length === 0) throw new AibaError("Registry has no index snapshots", "REGISTRY_INDEX_NOT_FOUND");
  let registry = "";
  const bundles = new Set<string>();
  for (const sequence of values) {
    const verified = await verifyRegistryIndexSnapshot({ snapshotDirectory: join(root, "indexes", String(sequence)), sequence, registryTrustPolicyPath: resolve(options.registryTrustPolicyPath), ...(options.now ? { now: options.now } : {}) });
    if (registry && registry !== verified.index.metadata.id) throw new AibaError("Registry history changes identity", "REGISTRY_HISTORY_ID_MISMATCH");
    registry = verified.index.metadata.id;
    for (const entry of verified.index.entries) {
      const path = entry.path;
      if (!safeRelative(path)) throw new AibaError("Registry entry path is unsafe", "INVALID_REGISTRY_ENTRY_PATH");
      const bundle = await verifyCapabilityBundle({ bundleDirectory: join(root, ...path.split("/")), trustPolicyPath: resolve(options.publisherTrustPolicyPath) });
      if (bundle.capability !== entry.capability || bundle.version !== entry.version || bundle.manifestSha256 !== entry.bundleManifestSha256 || bundle.publisher !== entry.publisher || bundle.keyId !== entry.keyId) throw new AibaError("Registry entry does not match bundle", "REGISTRY_BUNDLE_MISMATCH");
      bundles.add(path);
    }
  }
  return { registry, sequences: values, bundles: [...bundles].sort() };
}

export async function backupRegistry(options: {
  registryDirectory: string;
  outputDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  now?: () => Date;
}): Promise<{ outputDirectory: string; files: number; latestSequence: number; registry: string }> {
  const verified = await verifyRegistryForOperations(options);
  const source = resolve(options.registryDirectory);
  const output = resolve(options.outputDirectory);
  if (await exists(output)) throw new AibaError("Backup output already exists", "REGISTRY_BACKUP_EXISTS");
  const staging = `${output}.${randomUUID()}.tmp`;
  try {
    await mkdir(staging, { recursive: false });
    await cp(source, join(staging, "registry"), { recursive: true, errorOnExist: true, force: false });
    const files = await regularFiles(join(staging, "registry"));
    const manifest: BackupManifest = {
      format: "aiba-registry-backup/v1",
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      registry: verified.registry,
      latestSequence: verified.sequences.at(-1)!,
      files: await Promise.all(files.map(async (file) => ({ path: file.relative, size: (await lstat(file.absolute)).size, sha256: await sha256File(file.absolute) }))),
    };
    await writeFile(join(staging, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(staging, output);
    return { outputDirectory: output, files: manifest.files.length, latestSequence: manifest.latestSequence, registry: manifest.registry };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function validateBackup(backup: string): Promise<BackupManifest> {
  const root = resolve(backup);
  const manifestPath = join(root, "backup-manifest.json");
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 10 * 1024 * 1024) throw new AibaError("Backup manifest is invalid", "INVALID_BACKUP_MANIFEST");
  const value = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<BackupManifest>;
  if (value.format !== "aiba-registry-backup/v1" || !Array.isArray(value.files) || typeof value.registry !== "string" || !Number.isSafeInteger(value.latestSequence)) throw new AibaError("Backup manifest shape is invalid", "INVALID_BACKUP_MANIFEST");
  const manifest = value as BackupManifest;
  const actual = await regularFiles(join(root, "registry"));
  if (actual.length !== manifest.files.length || new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length) throw new AibaError("Backup file set differs from manifest", "BACKUP_FILE_SET_MISMATCH");
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of actual) {
    const entry = expected.get(file.relative);
    if (!entry || !safeRelative(entry.path) || (await lstat(file.absolute)).size !== entry.size || await sha256File(file.absolute) !== entry.sha256) throw new AibaError(`Backup file verification failed: ${file.relative}`, "BACKUP_FILE_TAMPERED");
  }
  return manifest;
}

export async function restoreRegistry(options: {
  backupDirectory: string;
  targetDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  now?: () => Date;
}): Promise<{ targetDirectory: string; registry: string; latestSequence: number }> {
  const backup = resolve(options.backupDirectory);
  const target = resolve(options.targetDirectory);
  if (await exists(target)) throw new AibaError("Restore target already exists", "REGISTRY_RESTORE_TARGET_EXISTS");
  const manifest = await validateBackup(backup);
  const staging = `${target}.${randomUUID()}.tmp`;
  try {
    await cp(join(backup, "registry"), staging, { recursive: true, errorOnExist: true, force: false });
    const verified = await verifyRegistryForOperations({ registryDirectory: staging, registryTrustPolicyPath: options.registryTrustPolicyPath, publisherTrustPolicyPath: options.publisherTrustPolicyPath, ...(options.now ? { now: options.now } : {}) });
    if (verified.registry !== manifest.registry || verified.sequences.at(-1) !== manifest.latestSequence) throw new AibaError("Restored Registry does not match backup metadata", "REGISTRY_BACKUP_METADATA_MISMATCH");
    await mkdir(dirname(target), { recursive: true });
    await rename(staging, target);
    return { targetDirectory: target, registry: verified.registry, latestSequence: manifest.latestSequence };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function planRegistryRetention(options: {
  registryDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  keepIndexes: number;
  apply?: boolean;
  now?: () => Date;
}): Promise<{ dryRun: boolean; keptIndexes: number[]; removableIndexes: number[]; removableBundles: string[] }> {
  if (!Number.isSafeInteger(options.keepIndexes) || options.keepIndexes < 1) throw new AibaError("Retention must keep at least one index", "INVALID_REGISTRY_RETENTION");
  const root = resolve(options.registryDirectory);
  const verified = await verifyRegistryForOperations(options);
  const keptIndexes = verified.sequences.slice(-options.keepIndexes);
  const referenced = new Set<string>();
  for (const sequence of keptIndexes) {
    const index = await verifyRegistryIndexSnapshot({ snapshotDirectory: join(root, "indexes", String(sequence)), sequence, registryTrustPolicyPath: resolve(options.registryTrustPolicyPath), ...(options.now ? { now: options.now } : {}) });
    for (const entry of index.index.entries) referenced.add(entry.path);
  }
  const removableIndexes = verified.sequences.filter((value) => !keptIndexes.includes(value));
  const removableBundles = verified.bundles.filter((path) => !referenced.has(path));
  if (options.apply) {
    for (const sequence of removableIndexes) await rm(join(root, "indexes", String(sequence)), { recursive: true, force: false });
    for (const path of removableBundles) await rm(join(root, ...path.split("/")), { recursive: true, force: false });
  }
  return { dryRun: !options.apply, keptIndexes, removableIndexes, removableBundles };
}
