import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const workspace = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const releasePackages = [
  { directory: "packages/spec", name: "aiba-spec", license: "LICENSE-PROTOCOL" },
  { directory: "packages/core", name: "aiba-core", license: "LICENSE" },
  { directory: "packages/registry-server", name: "aiba-registry-server", license: "LICENSE" },
  {
    directory: "packages/cli",
    name: "@grubbylee/aiba",
    license: "LICENSE",
    capabilities: true,
  },
];

export function packageArtifactFilename(name, version) {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
}

function packagePathSegment(name) {
  return name.replace(/^@/, "").replaceAll("/", "-");
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function packageMetadata() {
  return releasePackages.map((definition) => ({
    ...definition,
    manifest: readJson(join(workspace, definition.directory, "package.json")),
  }));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" },
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function copyReleaseTree(source, target) {
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !path.endsWith(".map") && !/\.test\.(?:d\.ts|js)$/.test(path),
  });
}

function releaseManifest(manifest, versions) {
  const result = structuredClone(manifest);
  delete result.scripts;
  delete result.devDependencies;
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (!result[section]) continue;
    for (const [name, range] of Object.entries(result[section])) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        const version = versions.get(name);
        if (!version) throw new Error(`Unknown workspace dependency ${name}`);
        result[section][name] = `^${version}`;
      }
    }
  }
  const rootExport = result.exports?.["."];
  if (rootExport && typeof rootExport === "object") {
    rootExport.types = "./dist/index.d.ts";
    delete rootExport.development;
  }
  return result;
}

export function createPackageArtifacts(outputPath) {
  const outputDirectory = resolve(outputPath);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error(`Artifact directory must be empty: ${outputDirectory}`);
  }
  mkdirSync(outputDirectory, { recursive: true });

  const packages = packageMetadata();
  const versions = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]));
  const stagingRoot = mkdtempSync(join(tmpdir(), "aiba-pack-stage-"));
  const artifacts = [];
  try {
    for (const definition of packages) {
      const source = join(workspace, definition.directory);
      const staging = join(stagingRoot, packagePathSegment(definition.name));
      mkdirSync(staging);
      for (const required of ["dist", "README.md"]) {
        const path = join(source, required);
        if (!existsSync(path)) throw new Error(`Missing release input: ${path}`);
        copyReleaseTree(path, join(staging, required));
      }
      if (definition.name === "aiba-spec") {
        copyReleaseTree(join(source, "schema"), join(staging, "schema"));
      }
      if (definition.capabilities) {
        copyReleaseTree(join(workspace, "capabilities"), join(staging, "capabilities"));
        cpSync(
          join(workspace, "GENERATED_OUTPUT_EXCEPTION.md"),
          join(staging, "GENERATED_OUTPUT_EXCEPTION.md"),
        );
      }
      cpSync(join(workspace, definition.license), join(staging, "LICENSE"));
      const manifest = releaseManifest(definition.manifest, versions);
      writeFileSync(join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

      const packed = JSON.parse(run("npm", [
        "pack",
        staging,
        "--pack-destination",
        outputDirectory,
        "--ignore-scripts",
        "--json",
      ], workspace));
      if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
        throw new Error(`Unexpected npm pack output for ${definition.name}`);
      }
      artifacts.push({
        name: definition.name,
        version: definition.manifest.version,
        path: join(outputDirectory, packed[0].filename),
        files: packed[0].files,
      });
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  return artifacts;
}

export function runChecked(command, args, cwd, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}
