import { describe, expect, it } from "vitest";
import { loadInterfaceSchema, loadProtocolSchema } from "./index.js";

describe("protocol schemas", () => {
  it.each([
    "ancestry.schema.json",
    "agent-protocol.schema.json",
    "error-envelope.schema.json",
    "signed-solution.schema.json",
    "solution-trust-policy.schema.json",
    "solution-state.schema.json",
    "behavior-challenge.schema.json",
    "behavior-proof.schema.json",
    "behavior-runner-trust-policy.schema.json",
    "bundle.schema.json",
    "bundle-signature.schema.json",
    "capability-approval.schema.json",
    "capability-catalog.schema.json",
    "capability.schema.json",
    "lock.schema.json",
    "migration.schema.json",
    "operation-plan.schema.json",
    "project.schema.json",
    "recipe.schema.json",
    "receipt.schema.json",
    "governance-policy.schema.json",
    "registry-index.schema.json",
    "registry-index-signature.schema.json",
    "registry-state.schema.json",
    "registry-trust-policy.schema.json",
    "solution.schema.json",
    "trust-policy.schema.json",
    "upgrade-plan.schema.json",
  ] as const)("loads %s", (name) => {
    const schema = loadProtocolSchema(name) as { $schema?: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it.each([
    "audit-event.schema.json",
    "authorization-decision.schema.json",
    "data-export-command.schema.json",
    "data-import-command.schema.json",
    "file-asset-record.schema.json",
    "file-asset-upload-command.schema.json",
    "import-export-job-record.schema.json",
    "notification-command.schema.json",
    "notification-receipt.schema.json",
    "principal.schema.json",
    "vehicle-create-command.schema.json",
    "vehicle-record.schema.json",
    "vehicle-update-command.schema.json",
    "wechat-miniprogram-login-command.schema.json",
    "wechat-miniprogram-login-result.schema.json",
  ] as const)("loads interface schema %s", (name) => {
    const schema = loadInterfaceSchema(name) as { $id?: string };
    expect(schema.$id).toContain("/interfaces/v0alpha1/");
  });
});
