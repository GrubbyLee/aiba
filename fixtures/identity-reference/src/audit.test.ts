import { describe, expect, it } from "vitest";
import type { AuditEvent } from "aiba-spec";
import { AuditError, createAuditService, type AuditStore } from "./audit.js";

class MemoryAuditStore implements AuditStore {
  readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

describe("audit reference boundary", () => {
  it("derives trusted envelope fields and appends one immutable-shaped event", async () => {
    const store = new MemoryAuditStore();
    const service = createAuditService({
      store,
      now: () => new Date("2026-07-26T00:00:00Z"),
      eventId: () => "event-00000000001",
    });
    const event = await service.record({
      actor: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      correlationId: "request-001",
    }, {
      action: "users:disable",
      outcome: "succeeded",
      reasonCode: "operator-approved",
      target: { type: "user", id: "user-99", tenantId: "tenant-a" },
    });

    expect(event).toEqual({
      eventId: "event-00000000001",
      action: "users:disable",
      outcome: "succeeded",
      actor: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      target: { type: "user", id: "user-99", tenantId: "tenant-a" },
      reasonCode: "operator-approved",
      occurredAt: "2026-07-26T00:00:00.000Z",
      correlationId: "request-001",
    });
    expect(store.events).toEqual([event]);
    expect(Object.keys(service)).toEqual(["record"]);
  });

  it("rejects payload attempts to replace actor, time, identity, or correlation", async () => {
    const service = createAuditService({ store: new MemoryAuditStore() });
    await expect(service.record({
      actor: { type: "service", subject: "api" },
      correlationId: "request-002",
    }, {
      action: "identity:authenticate",
      outcome: "allowed",
      actor: { type: "user", subject: "forged" },
      occurredAt: "2000-01-01T00:00:00Z",
      eventId: "chosen",
      correlationId: "chosen",
    })).rejects.toMatchObject({ code: "invalid-audit-event" });
  });

  it.each(["password", "sessionToken", "credentialDigest", "authorizationHeader"])(
    "rejects reusable secret field %s",
    async (field) => {
      const service = createAuditService({ store: new MemoryAuditStore() });
      await expect(service.record({
        actor: { type: "anonymous", subject: "transport:hashed" },
        correlationId: "request-003",
      }, {
        action: "identity:authenticate",
        outcome: "denied",
        [field]: "reusable-secret",
      })).rejects.toMatchObject({ code: "invalid-audit-event" });
    },
  );

  it("rejects malformed actions, outcomes, targets, and trusted context", async () => {
    const service = createAuditService({ store: new MemoryAuditStore() });
    await expect(service.record({
      actor: { type: "service", subject: "api" },
      correlationId: "short",
    }, { action: "identity:login", outcome: "allowed" }))
      .rejects.toMatchObject({ code: "invalid-audit-context" });
    await expect(service.record({
      actor: { type: "service", subject: "api" },
      correlationId: "request-004",
    }, { action: "login", outcome: "maybe", target: { type: "../secret" } }))
      .rejects.toMatchObject({ code: "invalid-audit-event" });
  });

  it("surfaces append failure instead of claiming delivery", async () => {
    const store: AuditStore = {
      append: async () => { throw new Error("storage unavailable"); },
    };
    const service = createAuditService({ store });
    await expect(service.record({
      actor: { type: "service", subject: "api" },
      correlationId: "request-005",
    }, {
      action: "audit:write",
      outcome: "failed",
      reasonCode: "storage-unavailable",
    })).rejects.toEqual(expect.objectContaining<Partial<AuditError>>({
      code: "audit-delivery-failed",
    }));
  });
});
