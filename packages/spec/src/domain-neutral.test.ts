import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workspace = new URL("../../../", import.meta.url);

async function textFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) files.push(...await textFiles(url));
    else if (/\.(?:json|md|ts|ya?ml)$/.test(entry.name)) files.push(url);
  }
  return files;
}

describe("official product surfaces remain domain neutral", () => {
  it("does not publish the historical demo domain as a protocol or pack", async () => {
    const forbidden = ["vehi", "cle"].join("");
    const files = [
      ...await textFiles(new URL("capabilities/", workspace)),
      ...await textFiles(new URL("solutions/", workspace)),
      ...await textFiles(new URL("packages/spec/schema/", workspace)),
      new URL("packages/spec/src/index.ts", workspace),
    ];

    for (const file of files) {
      const content = (await readFile(file, "utf8")).toLowerCase();
      expect(content, file.pathname).not.toContain(forbidden);
    }
  });
});
