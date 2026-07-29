import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  packageArtifactFilename,
  packageMetadata,
  runChecked,
  workspace,
} from "./packages.mjs";

const directoryIndex = process.argv.indexOf("--dir");
if (directoryIndex < 0) throw new Error("Usage: node scripts/release/publish.mjs --dir <directory>");
const directory = resolve(workspace, process.argv[directoryIndex + 1] ?? "");

for (const { manifest } of packageMetadata()) {
  const filename = packageArtifactFilename(manifest.name, manifest.version);
  const artifact = join(directory, filename);
  if (!existsSync(artifact)) throw new Error(`Missing release artifact: ${artifact}`);

  let publishedIntegrity;
  try {
    publishedIntegrity = runChecked("npm", [
      "view",
      `${manifest.name}@${manifest.version}`,
      "dist.integrity",
      "--registry=https://registry.npmjs.org/",
    ], workspace).trim();
  } catch (error) {
    if (!String(error).includes("E404")) throw error;
  }

  const localIntegrity = `sha512-${createHash("sha512").update(readFileSync(artifact)).digest("base64")}`;
  if (publishedIntegrity) {
    if (publishedIntegrity !== localIntegrity) {
      throw new Error(`${manifest.name}@${manifest.version} exists with different bytes`);
    }
    process.stdout.write(`${manifest.name}@${manifest.version}: already published with matching integrity\n`);
    continue;
  }

  runChecked("npm", [
    "publish",
    artifact,
    "--access",
    "public",
    "--provenance",
    "--registry=https://registry.npmjs.org/",
  ], workspace);
  process.stdout.write(`${manifest.name}@${manifest.version}: published\n`);
}
