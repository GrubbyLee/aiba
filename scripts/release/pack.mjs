import { resolve } from "node:path";
import { createPackageArtifacts, workspace } from "./packages.mjs";

const outIndex = process.argv.indexOf("--out");
const output = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
if (!output) throw new Error("Usage: node scripts/release/pack.mjs --out <directory>");

const artifacts = createPackageArtifacts(resolve(workspace, output));
for (const artifact of artifacts) {
  process.stdout.write(`${artifact.name}@${artifact.version}: ${artifact.path}\n`);
}
