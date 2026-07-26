import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { initializeProject } from "./init.js";

describe("initializeProject", () => {
  it("creates project-owned text state from inspection", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiba-init-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "new-project",
      dependencies: { next: "latest", react: "latest" },
    }));
    await writeFile(join(root, "index.ts"), "export {};\n");

    const result = await initializeProject(
      root,
      () => new Date("2026-07-26T00:00:00Z"),
    );
    const manifest = parse(await readFile(result.manifestPath, "utf8")) as {
      project: { name: string; stack: { languages: string[]; frameworks: string[] } };
    };
    expect(manifest.project).toEqual({
      name: "new-project",
      stack: {
        languages: ["TypeScript"],
        frameworks: ["Next.js", "React"],
      },
    });
    expect(JSON.parse(await readFile(result.lockPath, "utf8"))).toMatchObject({
      kind: "Lock",
      capabilities: [],
    });
    await expect(readFile(join(root, ".aiba", ".gitignore"), "utf8"))
      .resolves.toBe("/registry-cache/\n");
  });

  it("does not overwrite existing AIBA state", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiba-init-existing-"));
    await initializeProject(root);
    await expect(initializeProject(root)).rejects.toMatchObject({
      code: "PROJECT_STATE_EXISTS",
    });
  });
});
