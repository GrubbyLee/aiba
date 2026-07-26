import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workspace } from "./packages.mjs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version) throw new Error("Usage: node scripts/release/notes.mjs <version>");
const changelog = readFileSync(join(workspace, "CHANGELOG.md"), "utf8");
const heading = `## [${version}]`;
const start = changelog.indexOf(heading);
if (start < 0) throw new Error(`No changelog section for ${version}`);
const next = changelog.indexOf("\n## [", start + heading.length);
const section = changelog.slice(start, next < 0 ? undefined : next).trim();
process.stdout.write(`${section}\n`);
