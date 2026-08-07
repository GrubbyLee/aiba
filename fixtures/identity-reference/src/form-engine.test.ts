import { describe, expect, it } from "vitest";
import { createFormEngineService, type FormSchemaDefinition } from "./form-engine.js";

const baseSchema: FormSchemaDefinition = {
  formCode: "vehicle-intake",
  revision: 3,
  title: "Vehicle <Intake>",
  description: "Register a vehicle",
  enabled: true,
  fields: [
    { name: "plate", type: "string", label: "Plate", required: true, minLength: 5, maxLength: 12, pattern: "^[A-Z0-9-]+$" },
    { name: "kind", type: "select", label: "Kind", required: true, options: [{ value: "car", label: "Car" }, { value: "truck", label: "Truck" }, { value: "retired", label: "Retired", disabled: true }] },
    { name: "features", type: "multiselect", label: "Features", maximumSelections: 2, options: [{ value: "gps", label: "GPS" }, { value: "camera", label: "Camera" }] },
    { name: "registration", type: "file", label: "Registration file" },
    { name: "truckNote", type: "textarea", label: "Truck note", visibleWhen: { field: "kind", equals: "truck" }, dependsOn: ["kind"] },
    { name: "serverStatus", type: "string", label: "Status", readonly: true },
  ],
};

function fixture(options: { schema?: FormSchemaDefinition; authorized?: boolean; validAsset?: boolean } = {}) {
  const stored: unknown[] = [];
  const definition = options.schema ?? baseSchema;
  const service = createFormEngineService({
    loadSchema: async (tenantId, formCode, revision) => tenantId === "tenant-a" && formCode === definition.formCode
      && (revision === undefined || revision === definition.revision) ? definition : undefined,
    authorize: async () => options.authorized !== false,
    verifyFileReference: async ({ tenantId, formCode, assetId }) => options.validAsset !== false
      && tenantId === "tenant-a" && formCode === "vehicle-intake" && assetId === "asset-1",
    storeSubmission: async (input) => { stored.push(input); return "submission_001"; },
    sanitizeText: (value) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    now: () => new Date("2026-08-07T00:00:00Z"),
  });
  const context = { tenantId: "tenant-a", principalId: "user-1" };
  const command = { formCode: "vehicle-intake", expectedRevision: 3, data: { plate: "ABC-123", kind: "car" }, idempotencyKey: "form-submit-0001" };
  return { service, context, command, stored };
}

describe("form-engine reference boundary", () => {
  it("loads a sanitized, revisioned portable schema", async () => {
    const f = fixture();
    await expect(f.service.schema(f.context, { formCode: "vehicle-intake" })).resolves.toMatchObject({
      revision: 3,
      title: "Vehicle &lt;Intake&gt;",
      loadedAt: "2026-08-07T00:00:00.000Z",
    });
  });

  it("stores a valid normalized submission against the exact revision", async () => {
    const f = fixture();
    const result = await f.service.submit(f.context, f.command);
    expect(result).toMatchObject({ valid: true, submissionId: "submission_001", revision: 3 });
    expect(f.stored).toHaveLength(1);
  });

  it("rejects stale revisions and unauthorized or cross-tenant access", async () => {
    const f = fixture();
    await expect(f.service.submit(f.context, { ...f.command, expectedRevision: 2 })).rejects.toThrow("form-unavailable");
    await expect(f.service.schema({ ...f.context, tenantId: "tenant-b" }, { formCode: "vehicle-intake" })).rejects.toThrow("form-unavailable");
    const denied = fixture({ authorized: false });
    await expect(denied.service.schema(denied.context, { formCode: "vehicle-intake" })).rejects.toThrow("form-unavailable");
  });

  it("rejects missing, unknown, hidden, and readonly fields on the server", async () => {
    const f = fixture();
    const result = await f.service.submit(f.context, {
      ...f.command,
      data: { kind: "car", unexpected: "x", truckNote: "hidden", serverStatus: "forced" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["required", "unknown-field", "hidden-field", "readonly-field"]));
    expect(f.stored).toHaveLength(0);
  });

  it("enforces string patterns and length on the trusted server", async () => {
    const f = fixture();
    const result = await f.service.submit(f.context, { ...f.command, data: { plate: "!", kind: "car" } });
    expect(result.errors[0]?.code).toBe("invalid-length");
  });

  it("rejects disabled, unknown, and excessive selections", async () => {
    const f = fixture();
    const result = await f.service.submit(f.context, {
      ...f.command,
      data: { plate: "ABC-123", kind: "retired", features: ["gps", "camera", "other"] },
    });
    expect(result.errors.map((error) => error.code)).toEqual(["invalid-selection", "invalid-selection"]);
  });

  it("verifies file references against tenant and form scope", async () => {
    const f = fixture({ validAsset: false });
    const result = await f.service.submit(f.context, { ...f.command, data: { ...f.command.data, registration: "asset-other-tenant" } });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid-file-reference" }));
  });

  it("rejects cyclic dependencies and unsafe regular expressions", async () => {
    const cyclic = fixture({ schema: { ...baseSchema, fields: [
      { name: "a", type: "string", label: "A", dependsOn: ["b"] },
      { name: "b", type: "string", label: "B", dependsOn: ["a"] },
    ] } });
    await expect(cyclic.service.schema(cyclic.context, { formCode: "vehicle-intake" })).rejects.toThrow("field-dependency-cycle");
    const unsafe = fixture({ schema: { ...baseSchema, fields: [{ name: "value", type: "string", label: "Value", pattern: "(a+)+$" }] } });
    await expect(unsafe.service.schema(unsafe.context, { formCode: "vehicle-intake" })).rejects.toThrow("unsafe-field-pattern");
  });

  it("bounds total payload size even when runtime input bypasses static types", async () => {
    const f = fixture();
    await expect(f.service.submit(f.context, { ...f.command, data: { plate: "A".repeat(70_000), kind: "car" } })).rejects.toThrow("form-data-too-large");
  });

  it("deduplicates exact submissions and rejects changed key reuse", async () => {
    const f = fixture();
    expect(await f.service.submit(f.context, f.command)).toEqual(await f.service.submit(f.context, f.command));
    expect(f.stored).toHaveLength(1);
    await expect(f.service.submit(f.context, { ...f.command, data: { plate: "XYZ-999", kind: "car" } })).rejects.toThrow("idempotency-conflict");
  });
});
