import { access, readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workspace = new URL("../../../", import.meta.url);
const docs = [
  new URL("docs/CAPABILITY_MODEL.md", workspace),
  new URL("docs/CAPABILITY_MODEL.zh-CN.md", workspace),
];

async function officialCapabilityIds(): Promise<string[]> {
  const entries = await readdir(new URL("capabilities/", workspace), {
    withFileTypes: true,
  });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      await access(new URL(`capabilities/${entry.name}/capability.yaml`, workspace));
      ids.push(entry.name);
    } catch {
      // Supporting directories are not catalog capabilities.
    }
  }
  return ids.sort();
}

describe("bilingual capability model documentation", () => {
  it("covers every official capability and Solution in both languages", async () => {
    const ids = await officialCapabilityIds();

    for (const documentUrl of docs) {
      const document = await readFile(documentUrl, "utf8");
      for (const id of ids) {
        expect(document, `${documentUrl.pathname} omits ${id}`).toContain(`\`${id}\``);
      }
      expect(document).toContain("`secure-workspace`");
      expect(document).toContain("CAPABILITY_MODEL.md");
      expect(document).toContain("CAPABILITY_MODEL.zh-CN.md");
    }
  });

  it("keeps new README and model-document links resolvable", async () => {
    const sources = [
      new URL("README.md", workspace),
      new URL("README.zh-CN.md", workspace),
      ...docs,
    ];

    for (const sourceUrl of sources) {
      const source = await readFile(sourceUrl, "utf8");
      const links = source.matchAll(/\[[^\]]+\]\((?!https?:\/\/|#)([^)#]+)(?:#[^)]*)?\)/g);
      for (const match of links) {
        const target = new URL(match[1]!, sourceUrl);
        await expect(access(target), `${sourceUrl.pathname} links to ${match[1]}`).resolves.toBeUndefined();
      }
    }
  });
});
