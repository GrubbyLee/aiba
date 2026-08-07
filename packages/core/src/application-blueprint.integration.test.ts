import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acceptApplicationBlueprintUpgrade,
  planApplicationBlueprintUpgrade,
} from "./application-blueprint-upgrade.js";
import { compileApplicationBlueprint } from "./application-planner.js";
import { sha256File } from "./hash.js";
import { loadApplicationBlueprint } from "./loaders.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const blueprintDirectory = join(workspace, "fixtures", "application-blueprint");
const previousPath = join(blueprintDirectory, "work-hub.yaml");
const nextPath = join(blueprintDirectory, "work-hub-v2.yaml");
const packsDirectory = join(workspace, "capabilities");

describe("domain-neutral Application Blueprint integration", () => {
  it("plans and upgrades a composed application without changing its source", async () => {
    const before = await Promise.all([readFile(previousPath, "utf8"), readFile(nextPath, "utf8")]);
    const [previousBlueprint, nextBlueprint] = await Promise.all([
      loadApplicationBlueprint(previousPath),
      loadApplicationBlueprint(nextPath),
    ]);
    const [previousBlueprintSha256, nextBlueprintSha256] = await Promise.all([
      sha256File(previousPath),
      sha256File(nextPath),
    ]);
    const [previousPlan, nextPlan] = await Promise.all([
      compileApplicationBlueprint({
        blueprint: previousBlueprint,
        blueprintSha256: previousBlueprintSha256,
        packsDirectory,
      }),
      compileApplicationBlueprint({
        blueprint: nextBlueprint,
        blueprintSha256: nextBlueprintSha256,
        packsDirectory,
      }),
    ]);

    expect(previousPlan.capabilities.map((item) => item.id)).toEqual(expect.arrayContaining([
      "audit",
      "authorization",
      "comments-activity",
      "data-dict",
      "file-assets",
      "form-engine",
      "import-export",
      "inbox",
      "notification",
      "reporting",
      "search",
      "tags",
      "workflow-approval",
    ]));
    expect(JSON.stringify(previousPlan)).not.toContain('"command"');

    const upgrade = planApplicationBlueprintUpgrade({
      previousBlueprint,
      previousBlueprintSha256,
      previousPlan,
      nextBlueprint,
      nextBlueprintSha256,
      nextPlan,
      customizations: [{
        taskId: "adapt-notification",
        ownership: "project",
        note: "Keep the project-owned provider adapter.",
        evidencePaths: ["src/notification-adapter.ts"],
      }],
    });
    expect(upgrade.changes).toContainEqual(expect.objectContaining({
      category: "additive",
      target: "work-item.priority",
    }));
    expect(acceptApplicationBlueprintUpgrade({
      plan: upgrade,
      currentPreviousBlueprintSha256: previousBlueprintSha256,
      currentNextBlueprintSha256: nextBlueprintSha256,
      currentNextPlan: nextPlan,
      resolutions: upgrade.requiredResolutions.map((changeId) => ({
        changeId,
        decision: "adapt",
        note: "Reviewed the affected project-owned application contract.",
      })),
    })).toMatchObject({ ok: true, blueprintId: "work-hub", version: "0.2.0" });
    expect(await Promise.all([readFile(previousPath, "utf8"), readFile(nextPath, "utf8")])).toEqual(before);
  });
});
