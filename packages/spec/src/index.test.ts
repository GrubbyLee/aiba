import { describe, expect, it } from "vitest";
import { loadInterfaceSchema, loadProtocolSchema } from "./index.js";

describe("protocol schemas", () => {
  it.each([
    "ancestry.schema.json",
    "bundle.schema.json",
    "bundle-signature.schema.json",
    "capability.schema.json",
    "lock.schema.json",
    "migration.schema.json",
    "operation-plan.schema.json",
    "project.schema.json",
    "recipe.schema.json",
    "receipt.schema.json",
    "trust-policy.schema.json",
    "upgrade-plan.schema.json",
  ] as const)("loads %s", (name) => {
    const schema = loadProtocolSchema(name) as { $schema?: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it.each([
    "audit-event.schema.json",
    "authorization-decision.schema.json",
    "notification-command.schema.json",
    "notification-receipt.schema.json",
    "principal.schema.json",
  ] as const)("loads interface schema %s", (name) => {
    const schema = loadInterfaceSchema(name) as { $id?: string };
    expect(schema.$id).toContain("/interfaces/v0alpha1/");
  });
});
