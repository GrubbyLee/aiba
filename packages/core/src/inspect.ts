import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

export interface ProjectInspection {
  root: string;
  name: string;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  languages: Array<{ name: string; files: number }>;
  frameworks: string[];
  aiba: {
    initialized: boolean;
    manifestPath?: string;
  };
  filesScanned: number;
  truncated: boolean;
}

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

const languageByExtension: Record<string, string> = {
  ".go": "Go",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".php": "PHP",
  ".py": "Python",
  ".rs": "Rust",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".wxml": "WeChat WXML",
  ".wxss": "WeChat WXSS",
};

const frameworkDependencies: Record<string, string> = {
  "@nestjs/core": "NestJS",
  "@remix-run/react": "Remix",
  "@tarojs/taro": "Taro",
  "@vitejs/plugin-react": "Vite React",
  "better-auth": "Better Auth",
  "drizzle-orm": "Drizzle ORM",
  fastify: "Fastify",
  hono: "Hono",
  next: "Next.js",
  prisma: "Prisma",
  react: "React",
  vue: "Vue",
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(root: string): Promise<ProjectInspection["packageManager"]> {
  if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(root, "yarn.lock"))) return "yarn";
  if (await exists(join(root, "bun.lock"))) return "bun";
  if (await exists(join(root, "package-lock.json"))) return "npm";
  return "unknown";
}

async function readPackageMetadata(root: string): Promise<{
  name?: string;
  frameworks: string[];
}> {
  try {
    const source = await readFile(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(source) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    const frameworks = Object.entries(frameworkDependencies)
      .filter(([dependency]) => dependency in dependencies)
      .map(([, framework]) => framework);
    return { ...(pkg.name ? { name: pkg.name } : {}), frameworks };
  } catch {
    return { frameworks: [] };
  }
}

export async function inspectProject(
  projectRoot: string,
  maximumFiles = 5000,
): Promise<ProjectInspection> {
  const root = resolve(projectRoot);
  const languageCounts = new Map<string, number>();
  const stack = [root];
  let filesScanned = 0;
  let truncated = false;

  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) stack.push(path);
        continue;
      }
      if (!entry.isFile()) continue;

      filesScanned += 1;
      const language = languageByExtension[extname(entry.name).toLowerCase()];
      if (language) {
        languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
      }
      if (filesScanned >= maximumFiles) {
        truncated = stack.length > 0;
        stack.length = 0;
        break;
      }
    }
  }

  const packageMetadata = await readPackageMetadata(root);
  const frameworks = new Set(packageMetadata.frameworks);
  if (await exists(join(root, "project.config.json"))) {
    frameworks.add("WeChat Mini Program");
  }
  const manifestPath = join(root, ".aiba", "manifest.yaml");
  const initialized = await exists(manifestPath);

  return {
    root,
    name: packageMetadata.name ?? basename(root),
    packageManager: await detectPackageManager(root),
    languages: [...languageCounts.entries()]
      .map(([name, files]) => ({ name, files }))
      .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name)),
    frameworks: [...frameworks].sort(),
    aiba: {
      initialized,
      ...(initialized ? { manifestPath } : {}),
    },
    filesScanned,
    truncated,
  };
}
