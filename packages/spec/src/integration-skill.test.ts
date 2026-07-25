import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillDirectory = new URL("../../../integrations/aiba-capabilities/", import.meta.url);

describe("portable AIBA Agent Skill", () => {
  it("exposes one provider-independent workflow for Codex and Claude Code", async () => {
    const skill = await readFile(new URL("SKILL.md", skillDirectory), "utf8");
    const metadata = await readFile(new URL("agents/openai.yaml", skillDirectory), "utf8");

    expect(fileURLToPath(skillDirectory)).toContain("integrations/aiba-capabilities");
    expect(skill).toMatch(/^---\nname: aiba-capabilities\ndescription: .+\n---/);
    expect(skill).not.toContain("TODO");
    expect(skill).toContain("aiba inspect --json");
    expect(skill).toContain("aiba add <capability> --json");
    expect(skill).toContain("--finalize --agent <codex-or-claude-code>");
    expect(skill).toContain("aiba verify <capability> --json");
    expect(skill).toContain("Never\nedit a receipt, lock hash, or verifier output");
    expect(metadata).toContain("$aiba-capabilities");
  });
});
