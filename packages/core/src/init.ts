import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import {
  AIBA_API_VERSION,
  type ProjectLock,
  type ProjectManifest,
} from "aiba-spec";
import { AibaError } from "./errors.js";
import { inspectProject } from "./inspect.js";

export interface InitializeProjectResult {
  root: string;
  manifestPath: string;
  lockPath: string;
  receiptsPath: string;
}

export async function initializeProject(
  projectRoot: string,
  now: () => Date = () => new Date(),
): Promise<InitializeProjectResult> {
  const root = resolve(projectRoot);
  const inspection = await inspectProject(root);
  const stateDirectory = join(root, ".aiba");

  try {
    await mkdir(stateDirectory);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "EEXIST") {
      throw new AibaError(
        `AIBA state already exists at ${stateDirectory}`,
        "PROJECT_STATE_EXISTS",
      );
    }
    throw error;
  }

  const manifestPath = join(stateDirectory, "manifest.yaml");
  const lockPath = join(stateDirectory, "lock.json");
  const ignorePath = join(stateDirectory, ".gitignore");
  const receiptsPath = join(stateDirectory, "receipts");
  const manifest: ProjectManifest = {
    apiVersion: AIBA_API_VERSION,
    kind: "Project",
    project: {
      name: inspection.name,
      stack: {
        languages: inspection.languages.map((language) => language.name),
        frameworks: inspection.frameworks,
      },
    },
    capabilities: [],
  };
  const lock: ProjectLock = {
    apiVersion: AIBA_API_VERSION,
    kind: "Lock",
    generatedAt: now().toISOString(),
    capabilities: [],
  };

  try {
    await mkdir(receiptsPath);
    await writeFile(ignorePath, "/registry-cache/\n", { encoding: "utf8", flag: "wx" });
    await writeFile(manifestPath, stringify(manifest), { encoding: "utf8", flag: "wx" });
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(stateDirectory, { recursive: true, force: true });
    throw new AibaError("Failed to initialize AIBA project state", "PROJECT_INIT_FAILED", {
      cause: error,
    });
  }

  return { root, manifestPath, lockPath, receiptsPath };
}
