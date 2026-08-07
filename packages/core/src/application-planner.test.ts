import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { compileApplicationBlueprint } from "./application-planner.js";
import { sha256File } from "./hash.js";
import { loadApplicationBlueprint } from "./loaders.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = join(workspace, "fixtures", "application-blueprint", "work-hub.yaml");
const packsDirectory = join(workspace, "capabilities");

async function compile(packs = packsDirectory) {
  return compileApplicationBlueprint({
    blueprint: await loadApplicationBlueprint(sourcePath),
    blueprintSha256: await sha256File(sourcePath),
    packsDirectory: packs,
  });
}

describe("deterministic Application Blueprint planner", () => {
  it("infers reusable capabilities, closes dependencies, and emits an ordered task graph", async () => {
    const first = await compile();
    const second = await compile();
    expect(first).toEqual(second);
    expect(first.metadata.blueprint.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.capabilities.map((item) => item.id)).toEqual(expect.arrayContaining([
      "audit", "identity", "authorization", "data-dict", "file-assets", "tags",
      "form-engine", "search", "notification", "inbox", "comments-activity",
      "workflow-approval", "reporting", "import-export",
    ]));
    const positions = new Map(first.capabilities.map((item, index) => [item.id, index]));
    for (const capability of first.capabilities) {
      for (const dependency of capability.dependencies) {
        expect(positions.get(dependency), `${capability.id} -> ${dependency}`)
          .toBeLessThan(positions.get(capability.id)!);
      }
    }
    const taskPositions = new Map(first.tasks.map((task, index) => [task.id, index]));
    for (const task of first.tasks) {
      for (const dependency of task.dependsOn) {
        expect(taskPositions.get(dependency), `${task.id} -> ${dependency}`)
          .toBeLessThan(taskPositions.get(task.id)!);
      }
    }
    expect(first.tasks.at(-1)).toMatchObject({
      id: "verify-application",
      kind: "acceptance-verification",
      invariants: ["tenant-scope-enforced", "transitions-are-concurrent"],
    });
    expect(JSON.stringify(first)).not.toContain('"command"');
  });

  it("rejects missing and version-incompatible capabilities", async () => {
    const missing = await loadApplicationBlueprint(sourcePath);
    missing.spec.events[0]!.triggers[0]!.capability = "unpublished-provider";
    await expect(compileApplicationBlueprint({
      blueprint: missing,
      blueprintSha256: "a".repeat(64),
      packsDirectory,
    })).rejects.toMatchObject({ code: "BLUEPRINT_CAPABILITY_NOT_FOUND" });

    const incompatible = await loadApplicationBlueprint(sourcePath);
    incompatible.spec.requirements[0]!.version = "^9.0.0";
    await expect(compileApplicationBlueprint({
      blueprint: incompatible,
      blueprintSha256: "b".repeat(64),
      packsDirectory,
    })).rejects.toMatchObject({ code: "BLUEPRINT_CAPABILITY_VERSION_UNSATISFIED" });
  });

  it("rejects capability dependency cycles", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiba-blueprint-cycle-"));
    const packs = join(root, "capabilities");
    await cp(packsDirectory, packs, { recursive: true });
    const auditPath = join(packs, "audit", "capability.yaml");
    const audit = parse(await readFile(auditPath, "utf8")) as {
      spec: { dependencies: Array<{ id: string; version: string; optional: boolean }> };
    };
    audit.spec.dependencies.push({ id: "identity", version: "^0.1.0", optional: false });
    await writeFile(auditPath, stringify(audit));
    const identityPath = join(packs, "identity", "capability.yaml");
    const identity = parse(await readFile(identityPath, "utf8")) as {
      spec: { dependencies: Array<{ id: string; version: string; optional: boolean }> };
    };
    const auditDependency = identity.spec.dependencies.find((item) => item.id === "audit")!;
    auditDependency.optional = false;
    await writeFile(identityPath, stringify(identity));
    await expect(compile(packs)).rejects.toMatchObject({ code: "BLUEPRINT_CAPABILITY_CYCLE" });
  });

  it("rejects a malformed source binding", async () => {
    await expect(compileApplicationBlueprint({
      blueprint: await loadApplicationBlueprint(sourcePath),
      blueprintSha256: "not-a-hash",
      packsDirectory,
    })).rejects.toMatchObject({ code: "APPLICATION_BLUEPRINT_PLAN_INVALID" });
  });
});
