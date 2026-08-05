import { describe, expect, it } from "vitest";
import { createOrganizationService } from "./organization.js";

const owner = { membershipId: "membership_owner", organizationId: "organization-1", userId: "user-1", roleId: "owner", status: "active" as const, revision: 1, createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z" };
function fixture(authorized = true) {
  let ids = 0;
  const service = createOrganizationService({ authorize: async () => authorized, roleExists: async (_t, _o, role) => ["owner", "manager", "member"].includes(role), userExists: async (_t, user) => user.startsWith("user-"), audit: () => undefined, now: () => new Date("2026-08-05T01:00:00Z"), membershipId: () => `membership_${++ids}`.padEnd(12, "0"), initialMemberships: [owner], initialTenantId: "tenant-a" });
  return { service, context: { tenantId: "tenant-a", organizationId: "organization-1", principalId: "user-1", correlationId: "request-1" } };
}

describe("organization reference boundary", () => {
  it("adds and changes an authorized member with revisions", async () => {
    const f = fixture();
    const added = await f.service.mutate(f.context, { action: "add", userId: "user-2", roleId: "member", idempotencyKey: "member-add-0001" });
    expect(added).toMatchObject({ organizationId: "organization-1", roleId: "member", revision: 1 });
    expect(added).not.toHaveProperty("tenantId");
    await expect(f.service.mutate(f.context, { action: "change-role", userId: "user-2", roleId: "manager", expectedRevision: 1, idempotencyKey: "member-role-001" })).resolves.toMatchObject({ roleId: "manager", revision: 2 });
  });
  it("rejects authorization and stale revisions", async () => {
    await expect(fixture(false).service.mutate(fixture(false).context, { action: "add", userId: "user-2", roleId: "member", idempotencyKey: "member-add-0001" })).rejects.toThrow("membership-unavailable");
    const f = fixture();
    await f.service.mutate(f.context, { action: "add", userId: "user-2", roleId: "member", idempotencyKey: "member-add-0001" });
    await expect(f.service.mutate(f.context, { action: "remove", userId: "user-2", expectedRevision: 2, idempotencyKey: "member-remove-1" })).rejects.toThrow("membership-conflict");
  });
  it("preserves the last active owner", async () => {
    const f = fixture();
    await expect(f.service.mutate(f.context, { action: "remove", userId: "user-1", expectedRevision: 1, idempotencyKey: "owner-remove-01" })).rejects.toThrow("last-owner-required");
    await expect(f.service.mutate(f.context, { action: "change-role", userId: "user-1", roleId: "member", expectedRevision: 1, idempotencyKey: "owner-demote-01" })).rejects.toThrow("last-owner-required");
  });
  it("deduplicates exact mutations and rejects changed reuse", async () => {
    const f = fixture();
    const command = { action: "add" as const, userId: "user-2", roleId: "member", idempotencyKey: "member-add-0001" };
    expect(await f.service.mutate(f.context, command)).toEqual(await f.service.mutate(f.context, command));
    await expect(f.service.mutate(f.context, { ...command, userId: "user-3" })).rejects.toThrow("idempotency-conflict");
  });
  it("rejects unknown users and roles", async () => {
    const f = fixture();
    await expect(f.service.mutate(f.context, { action: "add", userId: "external", roleId: "member", idempotencyKey: "member-add-0001" })).rejects.toThrow("membership-unavailable");
    await expect(f.service.mutate(f.context, { action: "add", userId: "user-2", roleId: "super-root", idempotencyKey: "member-add-0002" })).rejects.toThrow("membership-unavailable");
  });
});
