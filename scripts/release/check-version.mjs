import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageMetadata, readJson, workspace } from "./packages.mjs";

const root = readJson(join(workspace, "package.json"));
const packages = packageMetadata();
const errors = [];

if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(root.version)) {
  errors.push(`Root version is not valid SemVer: ${root.version}`);
}

for (const definition of packages) {
  const { manifest } = definition;
  if (manifest.name !== definition.name) {
    errors.push(`${definition.directory} must be named ${definition.name}`);
  }
  if (manifest.version !== root.version) {
    errors.push(`${manifest.name} version ${manifest.version} differs from root ${root.version}`);
  }
  if (manifest.private === true) errors.push(`${manifest.name} remains private`);
  if (manifest.engines?.node !== ">=22") errors.push(`${manifest.name} must require Node >=22`);
  if (manifest.publishConfig?.access !== "public") errors.push(`${manifest.name} is not public`);
  if (manifest.publishConfig?.provenance !== true) errors.push(`${manifest.name} lacks provenance`);
  if (!manifest.scripts?.prepublishOnly?.includes("reject-direct-publish")) {
    errors.push(`${manifest.name} does not reject direct workspace publication`);
  }
}

const expectedLicenses = new Map([
  ["aiba-spec", "Apache-2.0"],
  ["aiba-core", "AGPL-3.0-only"],
  ["aiba-registry-server", "AGPL-3.0-only"],
  ["@grubbylee/aiba", "AGPL-3.0-only"],
]);
for (const { manifest } of packages) {
  if (manifest.license !== expectedLicenses.get(manifest.name)) {
    errors.push(`${manifest.name} has unexpected license ${manifest.license}`);
  }
}

const changelog = readFileSync(join(workspace, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${root.version}]`)) {
  errors.push(`CHANGELOG.md has no ${root.version} section`);
}

if (process.env.AIBA_RELEASE_TAG && process.env.AIBA_RELEASE_TAG !== `v${root.version}`) {
  errors.push(`Tag ${process.env.AIBA_RELEASE_TAG} does not match package version v${root.version}`);
}

const cliSource = readFileSync(join(workspace, "packages/cli/src/index.ts"), "utf8");
if (/\.version\(["'][0-9]/.test(cliSource)) {
  errors.push("CLI version must be read from package metadata");
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Release metadata: ${packages.length} packages at ${root.version}\n`);
