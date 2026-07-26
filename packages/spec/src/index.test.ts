import { describe, expect, it } from "vitest";
import { loadProtocolSchema } from "./index.js";

describe("protocol schemas", () => {
  it.each([
    "ancestry.schema.json",
    "capability.schema.json",
    "lock.schema.json",
    "migration.schema.json",
    "operation-plan.schema.json",
    "project.schema.json",
    "recipe.schema.json",
    "receipt.schema.json",
    "upgrade-plan.schema.json",
  ] as const)("loads %s", (name) => {
    const schema = loadProtocolSchema(name) as { $schema?: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});
