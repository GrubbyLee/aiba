import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { renderCompletion } from "./completion.js";

function testProgram(): Command {
  const program = new Command().name("aiba").option("--json");
  program.command("inspect").option("--max-files <number>");
  const create = program.command("create").option("--out <path>");
  create.command("capability");
  create.command("solution");
  return program;
}

describe("shell completion", () => {
  it("renders Bash commands, nested commands, and options", () => {
    const script = renderCompletion(testProgram(), "bash");
    expect(script).toContain("complete -F _aiba_completion aiba");
    expect(script).toContain("inspect create --help --version");
    expect(script).toContain('compgen -W "capability solution"');
    expect(script).toContain("--max-files");
    expect(script).toContain("--json");
    expect(script).toContain("--out");
  });

  it("renders native Zsh and Fish registration", () => {
    expect(renderCompletion(testProgram(), "zsh")).toContain("compdef _aiba aiba");
    const fish = renderCompletion(testProgram(), "fish");
    expect(fish).toContain("complete -c aiba -f");
    expect(fish).toContain("-l max-files");
  });
});
