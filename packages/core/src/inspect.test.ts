import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectProject } from "./inspect.js";

describe("inspectProject", () => {
  it("detects a TypeScript WeChat project", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiba-inspect-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(join(root, "project.config.json"), "{}\n");
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture",
      dependencies: { react: "latest", next: "latest" },
    }));

    const report = await inspectProject(root);
    expect(report.name).toBe("fixture");
    expect(report.packageManager).toBe("pnpm");
    expect(report.frameworks).toEqual(["Next.js", "React", "WeChat Mini Program"]);
    expect(report.languages).toContainEqual({ name: "TypeScript", files: 1 });
  });
});
