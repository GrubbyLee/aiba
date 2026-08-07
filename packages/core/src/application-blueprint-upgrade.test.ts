import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ApplicationBlueprint, ApplicationTaskCustomization } from "aiba-spec";
import {
  acceptApplicationBlueprintUpgrade,
  planApplicationBlueprintUpgrade,
} from "./application-blueprint-upgrade.js";
import { compileApplicationBlueprint } from "./application-planner.js";
import { loadApplicationBlueprint } from "./loaders.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = join(workspace, "fixtures", "application-blueprint", "work-hub.yaml");
const packsDirectory = join(workspace, "capabilities");
const previousSha = "a".repeat(64);
const nextSha = "b".repeat(64);

async function versionPair(mutate: (next: ApplicationBlueprint) => void) {
  const previousBlueprint = await loadApplicationBlueprint(sourcePath);
  const nextBlueprint = structuredClone(previousBlueprint);
  nextBlueprint.metadata.version = "0.2.0";
  mutate(nextBlueprint);
  const previousPlan = await compileApplicationBlueprint({
    blueprint: previousBlueprint,
    blueprintSha256: previousSha,
    packsDirectory,
  });
  const nextPlan = await compileApplicationBlueprint({
    blueprint: nextBlueprint,
    blueprintSha256: nextSha,
    packsDirectory,
  });
  return { previousBlueprint, nextBlueprint, previousPlan, nextPlan };
}

const customizations: ApplicationTaskCustomization[] = [{
  taskId: "implement-work-item",
  ownership: "project",
  note: "Keep the project's repository and naming conventions.",
  evidencePaths: ["src/work-items.ts", "test/work-items.test.ts"],
}, {
  taskId: "adapt-notification",
  ownership: "project",
  note: "Keep the project-owned provider adapter.",
  evidencePaths: ["src/notification-adapter.ts"],
}];

describe("Application Blueprint customization-aware upgrades", () => {
  it("preserves project customizations across additive Blueprint changes", async () => {
    const pair = await versionPair((next) => {
      next.spec.resources[1]!.fields.push({
        id: "priority",
        type: "integer",
        required: false,
        sensitive: false,
        minimum: 0,
        maximum: 5,
      });
    });
    const plan = planApplicationBlueprintUpgrade({
      ...pair,
      previousBlueprintSha256: previousSha,
      nextBlueprintSha256: nextSha,
      customizations,
    });
    expect(plan.changes).toContainEqual(expect.objectContaining({
      category: "additive",
      targetType: "field",
      target: "work-item.priority",
      requiresResolution: false,
    }));
    expect(plan.requiredResolutions).toEqual([]);
    expect(plan.preservedCustomizations).toEqual(customizations);
    expect(acceptApplicationBlueprintUpgrade({
      plan,
      currentPreviousBlueprintSha256: previousSha,
      currentNextBlueprintSha256: nextSha,
      currentNextPlan: pair.nextPlan,
      resolutions: [],
    })).toMatchObject({ ok: true, version: "0.2.0", preservedCustomizations: customizations });
  });

  it("requires explicit decisions for security changes and customized task conflicts", async () => {
    const pair = await versionPair((next) => {
      next.spec.operations[0]!.authorization.action = "work-item.admin-create";
    });
    const plan = planApplicationBlueprintUpgrade({
      ...pair,
      previousBlueprintSha256: previousSha,
      nextBlueprintSha256: nextSha,
      customizations,
    });
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "security-sensitive", target: "create-item" }),
      expect.objectContaining({ category: "conflict", target: "implement-work-item" }),
    ]));
    expect(plan.preservedCustomizations).toEqual([customizations[1]]);
    expect(() => acceptApplicationBlueprintUpgrade({
      plan,
      currentPreviousBlueprintSha256: previousSha,
      currentNextBlueprintSha256: nextSha,
      currentNextPlan: pair.nextPlan,
      resolutions: [],
    })).toThrowError(expect.objectContaining({ code: "BLUEPRINT_UPGRADE_RESOLUTION_REQUIRED" }));

    const resolutions = plan.requiredResolutions.map((changeId) => ({
      changeId,
      decision: "adapt" as const,
      note: "Reviewed and will adapt the project-owned boundary.",
    }));
    expect(acceptApplicationBlueprintUpgrade({
      plan,
      currentPreviousBlueprintSha256: previousSha,
      currentNextBlueprintSha256: nextSha,
      currentNextPlan: pair.nextPlan,
      resolutions,
    }).resolutions).toEqual(resolutions);
  });

  it("rejects stale source and target-plan bindings", async () => {
    const pair = await versionPair((next) => {
      next.spec.resources[1]!.fields.push({
        id: "priority",
        type: "integer",
        required: false,
        sensitive: false,
      });
    });
    const plan = planApplicationBlueprintUpgrade({
      ...pair,
      previousBlueprintSha256: previousSha,
      nextBlueprintSha256: nextSha,
    });
    expect(() => acceptApplicationBlueprintUpgrade({
      plan,
      currentPreviousBlueprintSha256: "c".repeat(64),
      currentNextBlueprintSha256: nextSha,
      currentNextPlan: pair.nextPlan,
      resolutions: [],
    })).toThrowError(expect.objectContaining({ code: "BLUEPRINT_UPGRADE_STALE_PLAN" }));

    const changedPlan = structuredClone(pair.nextPlan);
    changedPlan.tasks[0]!.intents.push("Unrecorded plan mutation");
    expect(() => acceptApplicationBlueprintUpgrade({
      plan,
      currentPreviousBlueprintSha256: previousSha,
      currentNextBlueprintSha256: nextSha,
      currentNextPlan: changedPlan,
      resolutions: [],
    })).toThrowError(expect.objectContaining({ code: "BLUEPRINT_UPGRADE_STALE_PLAN" }));
  });

  it("rejects downgrade, ID changes, and unsafe customization evidence", async () => {
    const previousBlueprint = await loadApplicationBlueprint(sourcePath);
    const previousPlan = await compileApplicationBlueprint({
      blueprint: previousBlueprint,
      blueprintSha256: previousSha,
      packsDirectory,
    });
    const nextBlueprint = structuredClone(previousBlueprint);
    nextBlueprint.metadata.version = "0.0.9";
    const nextPlan = structuredClone(previousPlan);
    nextPlan.metadata.blueprint.version = "0.0.9";
    nextPlan.metadata.blueprint.sha256 = nextSha;
    expect(() => planApplicationBlueprintUpgrade({
      previousBlueprint,
      previousBlueprintSha256: previousSha,
      previousPlan,
      nextBlueprint,
      nextBlueprintSha256: nextSha,
      nextPlan,
    })).toThrowError(expect.objectContaining({ code: "BLUEPRINT_UPGRADE_VERSION_INVALID" }));

    nextBlueprint.metadata.version = "0.2.0";
    expect(() => planApplicationBlueprintUpgrade({
      previousBlueprint,
      previousBlueprintSha256: previousSha,
      previousPlan,
      nextBlueprint,
      nextBlueprintSha256: nextSha,
      nextPlan: { ...nextPlan, metadata: { ...nextPlan.metadata, blueprint: { ...nextPlan.metadata.blueprint, version: "0.2.0" } } },
      customizations: [{
        taskId: "implement-work-item",
        ownership: "project",
        note: "Unsafe evidence",
        evidencePaths: ["../outside.ts"],
      }],
    })).toThrowError(expect.objectContaining({ code: "BLUEPRINT_CUSTOMIZATION_INVALID" }));
  });

  it("rejects malformed customization and resolution items before property access", async () => {
    const pair = await versionPair((next) => {
      next.spec.resources[1]!.fields.push({
        id: "priority",
        type: "integer",
        required: false,
        sensitive: false,
      });
    });
    expect(() => planApplicationBlueprintUpgrade({
      ...pair,
      previousBlueprintSha256: previousSha,
      nextBlueprintSha256: nextSha,
      customizations: ["bad" as unknown as ApplicationTaskCustomization],
    })).toThrowError(expect.objectContaining({ code: "JSON_DOCUMENT_INVALID" }));

    const plan = planApplicationBlueprintUpgrade({
      ...pair,
      previousBlueprintSha256: previousSha,
      nextBlueprintSha256: nextSha,
    });
    expect(() => acceptApplicationBlueprintUpgrade({
      plan,
      currentPreviousBlueprintSha256: previousSha,
      currentNextBlueprintSha256: nextSha,
      currentNextPlan: pair.nextPlan,
      resolutions: ["bad" as never],
    })).toThrowError(expect.objectContaining({ code: "JSON_DOCUMENT_INVALID" }));
  });
});
