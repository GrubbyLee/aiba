import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acceptCompiledApplicationBlueprintUpgrade,
  compileApplicationBlueprintPair,
  diffApplicationBlueprintFiles,
} from "./application-blueprint-diff.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const blueprintDirectory = join(workspace, "fixtures", "application-blueprint");
const previousPath = join(blueprintDirectory, "work-hub.yaml");
const nextPath = join(blueprintDirectory, "work-hub-v2.yaml");
const packsDirectory = join(workspace, "capabilities");

describe("Application Blueprint diff workflow", () => {
  it("is deterministic and classifies the domain-neutral v1-to-v2 change", async () => {
    const first = await diffApplicationBlueprintFiles({ previousPath, nextPath, packsDirectory });
    const second = await diffApplicationBlueprintFiles({ previousPath, nextPath, packsDirectory });
    expect(first).toEqual(second);
    expect(first.changes).toContainEqual(expect.objectContaining({
      category: "additive",
      targetType: "field",
      target: "work-item.priority",
      requiresResolution: false,
    }));
    expect(first.requiredResolutions).toEqual([]);
    const pair = await compileApplicationBlueprintPair({ previousPath, nextPath, packsDirectory });
    expect(acceptCompiledApplicationBlueprintUpgrade({
      pair,
      plan: first,
      resolutions: [],
    })).toMatchObject({ ok: true, blueprintId: "work-hub", version: "0.2.0" });
  });

  it("preserves compatible project customizations", async () => {
    const plan = await diffApplicationBlueprintFiles({
      previousPath,
      nextPath,
      packsDirectory,
      customizations: [{
        taskId: "implement-work-item",
        ownership: "project",
        note: "Keep project-owned persistence conventions.",
        evidencePaths: ["src/work-items.ts"],
      }],
    });
    expect(plan.preservedCustomizations).toEqual([expect.objectContaining({ taskId: "implement-work-item" })]);
    expect(plan.requiredResolutions).toEqual([]);
  });
});
