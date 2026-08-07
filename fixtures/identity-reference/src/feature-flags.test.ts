import { describe, expect, it } from "vitest";
import { createFeatureFlagService, type FeatureFlagDefinition } from "./feature-flags.js";

const definition: FeatureFlagDefinition = {
  key: "task.beta", tenantId: "tenant-a", enabled: true, revision: 3, salt: "trusted-rollout-salt",
  defaultVariant: "control", disabledVariant: "off",
  targets: [{ attribute: "plan", equals: "enterprise", variant: "full" }],
  rollout: [{ variant: "compact", basisPoints: 5000 }],
};

function service(value: FeatureFlagDefinition = definition) {
  return createFeatureFlagService({ loadDefinition: async (_tenant, key) => key === value.key ? value : undefined, now: () => new Date("2026-08-05T01:00:00Z") });
}

describe("feature flags reference boundary", () => {
  it("evaluates trusted target attributes before rollout", async () => {
    const result = await service().evaluate({ tenantId: "tenant-a", subjectId: "user-1", attributes: { plan: "enterprise" } }, { flagKey: "task.beta", expectedRevision: 3 });
    expect(result).toMatchObject({ enabled: true, variant: "full", reason: "target-match", policyRevision: 3 });
  });

  it("is deterministic for one subject and revision", async () => {
    const context = { tenantId: "tenant-a", subjectId: "user-22", attributes: {} };
    expect(await service().evaluate(context, { flagKey: "task.beta" })).toEqual(await service().evaluate(context, { flagKey: "task.beta" }));
  });

  it("rejects unknown tenant scope and stale policy revisions", async () => {
    await expect(service().evaluate({ tenantId: "tenant-b", subjectId: "user-1", attributes: {} }, { flagKey: "task.beta" })).rejects.toThrow("flag-unavailable");
    await expect(service().evaluate({ tenantId: "tenant-a", subjectId: "user-1", attributes: {} }, { flagKey: "task.beta", expectedRevision: 2 })).rejects.toThrow("policy-revision-conflict");
  });

  it("uses an explicit disabled variant", async () => {
    await expect(service({ ...definition, enabled: false }).evaluate({ tenantId: "tenant-a", subjectId: "user-1", attributes: {} }, { flagKey: "task.beta" })).resolves.toMatchObject({ enabled: false, variant: "off", reason: "disabled" });
  });

  it("rejects rollout allocations beyond the fixed bucket", async () => {
    const invalid = { ...definition, targets: [], rollout: [{ variant: "a", basisPoints: 6000 }, { variant: "b", basisPoints: 5000 }] };
    await expect(service(invalid).evaluate({ tenantId: "tenant-a", subjectId: "user-1", attributes: {} }, { flagKey: "task.beta" })).rejects.toThrow("flag-policy-invalid");
  });
});
