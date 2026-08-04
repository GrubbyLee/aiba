import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { AibaError } from "./errors.js";

function isWithin(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export async function canonicalProjectRoot(projectRoot: string): Promise<string> {
  return realpath(resolve(projectRoot));
}

export async function resolveExistingProjectPath(
  projectRoot: string,
  projectPath: string,
): Promise<string> {
  if (isAbsolute(projectPath)) {
    throw new AibaError(
      `Project path must be relative: ${projectPath}`,
      "UNSAFE_PROJECT_PATH",
    );
  }

  const root = await canonicalProjectRoot(projectRoot);
  const lexicalTarget = resolve(root, projectPath);
  if (!isWithin(root, lexicalTarget)) {
    throw new AibaError(
      `Project path escapes the project root: ${projectPath}`,
      "UNSAFE_PROJECT_PATH",
    );
  }

  const target = await realpath(lexicalTarget);
  if (!isWithin(root, target)) {
    throw new AibaError(
      `Project path resolves outside the project root: ${projectPath}`,
      "UNSAFE_PROJECT_PATH",
    );
  }

  return target;
}
