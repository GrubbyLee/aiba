import { describe, expect, it } from "vitest";
import type { AuditEvent, Principal } from "aiba-spec";
import { createAuditService, type AuditStore } from "./audit.js";
import {
  AuthorizationError,
  createAuthorizationService,
  type PolicySnapshot,
} from "./authorization.js";

class MemoryAuditStore implements AuditStore {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> { this.events.push(event); }
}

function createFixture(grants: PolicySnapshot["grants"] = []) {
  const store = new MemoryAuditStore();
  const audit = createAuditService({
    store,
    now: () => new Date("2026-07-26T00:00:00Z"),
    eventId: () => `event-${store.events.length.toString().padStart(11, "0")}`,
  });
  const policy: PolicySnapshot = { version: "policy-7", grants };
  const service = createAuthorizationService({
    loadPolicy: async () => policy,
    audit,
    now: () => new Date("2026-07-26T00:00:00Z"),
    decisionId: () => "decision-00000001",
  });
  const principal: Principal = {
    type: "user",
    subject: "user-42",
    tenantId: "tenant-a",
  };
  const context = { principal, correlationId: "request-authz-001" };
  return { audit, context, policy, principal, service, store };
}

const allowUsersRead: PolicySnapshot["grants"][number] = {
  id: "allow-users-read",
  effect: "allow",
  principals: [{ type: "user", subject: "user-42", tenantId: "tenant-a" }],
  actions: ["users:read"],
  resourceTypes: ["user"],
};

describe("authorization reference boundary", () => {
  it("returns an attributable explicit allow decision", async () => {
    const fixture = createFixture([allowUsersRead]);
    const decision = await fixture.service.decide(fixture.context, {
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
    });
    expect(decision).toEqual({
      decisionId: "decision-00000001",
      principal: fixture.principal,
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
      allowed: true,
      reasonCode: "explicit-allow",
      policyVersion: "policy-7",
      evaluatedAt: "2026-07-26T00:00:00.000Z",
    });
    expect(fixture.store.events[0]).toMatchObject({
      action: "authorization:evaluate",
      outcome: "allowed",
      reasonCode: "explicit-allow",
    });
  });

  it("defaults to deny when no exact grant matches", async () => {
    const fixture = createFixture([allowUsersRead]);
    const decision = await fixture.service.decide(fixture.context, {
      action: "users:delete",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
    });
    expect(decision).toMatchObject({ allowed: false, reasonCode: "default-deny" });
  });

  it("rejects client principal, role, permission, tenant, and policy injection", async () => {
    const fixture = createFixture([allowUsersRead]);
    const decision = await fixture.service.decide(fixture.context, {
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
      principal: { type: "service", subject: "admin" },
      roles: ["admin"],
      permissions: ["users:delete"],
      tenantId: "tenant-b",
      policy: { allow: true },
    });
    expect(decision).toMatchObject({ allowed: false, reasonCode: "invalid-request" });
    expect(decision.principal).toEqual(fixture.principal);
  });

  it("denies cross-tenant object access before matching an allow", async () => {
    const fixture = createFixture([allowUsersRead]);
    const decision = await fixture.service.decide(fixture.context, {
      action: "users:read",
      resource: { type: "user", id: "user-in-tenant-b", tenantId: "tenant-b" },
    });
    expect(decision).toMatchObject({ allowed: false, reasonCode: "cross-tenant" });
  });

  it("gives an applicable explicit deny precedence over allow", async () => {
    const fixture = createFixture([
      allowUsersRead,
      { ...allowUsersRead, id: "deny-user-99", effect: "deny", resourceIds: ["user-99"] },
    ]);
    const denied = await fixture.service.decide(fixture.context, {
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
    });
    expect(denied).toMatchObject({ allowed: false, reasonCode: "explicit-deny" });
  });

  it("fails closed when policy loading or validation fails", async () => {
    const store = new MemoryAuditStore();
    const audit = createAuditService({ store });
    const principal: Principal = { type: "service", subject: "api" };
    const service = createAuthorizationService({
      loadPolicy: async () => { throw new Error("policy unavailable"); },
      audit,
    });
    const decision = await service.decide(
      { principal, correlationId: "request-authz-002" },
      { action: "system:admin", resource: { type: "system" } },
    );
    expect(decision).toMatchObject({ allowed: false, reasonCode: "policy-unavailable" });
  });

  it("does not return an allow decision when required audit delivery fails", async () => {
    const fixture = createFixture([allowUsersRead]);
    const service = createAuthorizationService({
      loadPolicy: async () => fixture.policy,
      audit: { record: async () => { throw new Error("audit unavailable"); } },
    });
    await expect(service.decide(fixture.context, {
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
    })).rejects.toEqual(expect.objectContaining<Partial<AuthorizationError>>({
      code: "authorization-unavailable",
    }));
  });
});
