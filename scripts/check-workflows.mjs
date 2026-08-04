import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const files = readdirSync(workflowDirectory)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();

if (files.length === 0) throw new Error("No GitHub Actions workflows found");

const workflows = new Map();
for (const file of files) {
  const text = readFileSync(new URL(file, workflowDirectory), "utf8");
  const document = parseDocument(text, { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new Error(`${file}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const workflow = document.toJS();
  if (!workflow || typeof workflow !== "object" || !workflow.jobs) {
    throw new Error(`${file}: workflow must define jobs`);
  }
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!job || typeof job !== "object" || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (!step || typeof step !== "object" || typeof step.uses !== "string") continue;
      if (!/^[^@\s]+@[0-9a-f]{40}$/.test(step.uses)) {
        throw new Error(`${file}:${jobName} action is not pinned to a full commit: ${step.uses}`);
      }
    }
  }
  workflows.set(file, workflow);
}

const ci = workflows.get("ci.yml");
const portability = ci?.jobs?.portability;
const portabilityPlatforms = JSON.stringify(portability?.strategy?.matrix?.include ?? []);
for (const platform of ["macos-latest", "windows-latest"]) {
  if (!portabilityPlatforms.includes(platform)) {
    throw new Error(`ci.yml portability matrix is missing ${platform}`);
  }
}

process.stdout.write(`GitHub Actions workflows: ${files.map((file) => join(".github/workflows", file)).join(", ")}\n`);
process.stdout.write("Workflow configuration: ok\n");
