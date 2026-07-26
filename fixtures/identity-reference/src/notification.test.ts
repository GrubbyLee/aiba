import { describe, expect, it } from "vitest";
import type {
  AuditEvent,
  AuthorizationDecision,
  NotificationCommand,
  NotificationReceipt,
  Principal,
} from "aiba-spec";
import { createAuditService, type AuditStore } from "./audit.js";
import {
  createNotificationService,
  type NotificationDeliveryGate,
  type NotificationProvider,
} from "./notification.js";

class MemoryAuditStore implements AuditStore {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> { this.events.push(event); }
}

class MemoryGate implements NotificationDeliveryGate {
  private readonly records = new Map<string, { fingerprint: string; receipt: NotificationReceipt }>();
  async execute(
    key: string,
    fingerprint: string,
    deliver: () => Promise<NotificationReceipt>,
  ): Promise<NotificationReceipt> {
    const existing = this.records.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw Object.assign(new Error("idempotency conflict"), { code: "IDEMPOTENCY_CONFLICT" });
      }
      return existing.receipt;
    }
    const receipt = await deliver();
    this.records.set(key, { fingerprint, receipt });
    return receipt;
  }
}

function createFixture(options: { consented?: boolean; allowed?: boolean } = {}) {
  const auditStore = new MemoryAuditStore();
  const audit = createAuditService({
    store: auditStore,
    now: () => new Date("2026-07-26T00:00:00Z"),
    eventId: () => `event-${auditStore.events.length.toString().padStart(11, "0")}`,
  });
  const providerCalls: Parameters<NotificationProvider["send"]>[0][] = [];
  const provider: NotificationProvider = {
    send: async (input) => { providerCalls.push(input); },
  };
  const principal: Principal = { type: "service", subject: "workflow", tenantId: "tenant-a" };
  const allowed = options.allowed ?? true;
  const service = createNotificationService({
    directory: {
      loadTemplate: async (_tenantId, templateId) => ({
        id: templateId,
        channel: "wechat-template",
        enabled: true,
        parameterKeys: ["displayName"],
      }),
      resolveRecipient: async (tenantId, recipientId, channel) => ({
        id: recipientId,
        tenantId,
        channel,
        destination: "openid-sensitive-value",
        consented: options.consented ?? true,
      }),
    },
    authorization: {
      decide: async (context, input): Promise<AuthorizationDecision> => ({
        decisionId: "decision-00000001",
        principal: context.principal,
        action: input.action,
        resource: input.resource,
        allowed,
        reasonCode: allowed ? "explicit-allow" : "default-deny",
        policyVersion: "policy-7",
        evaluatedAt: "2026-07-26T00:00:00Z",
      }),
    },
    audit,
    deliveries: new MemoryGate(),
    provider,
    now: () => new Date("2026-07-26T00:00:00Z"),
    notificationId: () => "notification-0001",
  });
  const context = { principal, correlationId: "request-notify-001" };
  const command: NotificationCommand = {
    recipientId: "user-42",
    channel: "wechat-template",
    templateId: "account-disabled",
    parameters: { displayName: "User" },
    idempotencyKey: "workflow-event-0001",
  };
  return { auditStore, command, context, provider, providerCalls, service };
}

describe("notification reference boundary", () => {
  it("sends a trusted template and returns a minimized receipt", async () => {
    const fixture = createFixture();
    const receipt = await fixture.service.send(fixture.context, fixture.command);
    expect(receipt).toEqual({
      notificationId: "notification-0001",
      status: "sent",
      channel: "wechat-template",
      templateId: "account-disabled",
      createdAt: "2026-07-26T00:00:00.000Z",
    });
    expect(fixture.providerCalls).toHaveLength(1);
    expect(fixture.providerCalls[0]).toMatchObject({
      destination: "openid-sensitive-value",
      templateId: "account-disabled",
      parameters: { displayName: "User" },
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const provenance = JSON.stringify({ receipt, events: fixture.auditStore.events });
    expect(provenance).not.toContain("openid-sensitive-value");
    expect(provenance).not.toContain("displayName");
  });

  it("deduplicates the same command and provider call", async () => {
    const fixture = createFixture();
    const first = await fixture.service.send(fixture.context, fixture.command);
    const second = await fixture.service.send(fixture.context, fixture.command);
    expect(second).toEqual(first);
    expect(fixture.providerCalls).toHaveLength(1);
    expect(fixture.auditStore.events).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key for another command", async () => {
    const fixture = createFixture();
    await fixture.service.send(fixture.context, fixture.command);
    await expect(fixture.service.send(fixture.context, {
      ...fixture.command,
      recipientId: "user-99",
    })).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(fixture.providerCalls).toHaveLength(1);
  });

  it("suppresses delivery without consent", async () => {
    const fixture = createFixture({ consented: false });
    const receipt = await fixture.service.send(fixture.context, fixture.command);
    expect(receipt.status).toBe("suppressed");
    expect(fixture.providerCalls).toHaveLength(0);
    expect(fixture.auditStore.events[0]).toMatchObject({ reasonCode: "not-deliverable" });
  });

  it("requires explicit authorization before recipient resolution and delivery", async () => {
    const fixture = createFixture({ allowed: false });
    await expect(fixture.service.send(fixture.context, fixture.command))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.providerCalls).toHaveLength(0);
  });

  it("rejects tenant, destination, body, provider, credential, and unknown parameters", async () => {
    const fixture = createFixture();
    await expect(fixture.service.send(fixture.context, {
      ...fixture.command,
      tenantId: "tenant-b",
      destination: "attacker@example.com",
      body: "arbitrary content",
      provider: "chosen-provider",
      credential: "provider-secret",
    })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(fixture.service.send(fixture.context, {
      ...fixture.command,
      parameters: { displayName: "User", adminLink: "https://internal" },
    })).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("surfaces provider failure and records no sent receipt", async () => {
    const fixture = createFixture();
    fixture.provider.send = async () => { throw new Error("provider unavailable"); };
    await expect(fixture.service.send(fixture.context, fixture.command))
      .rejects.toMatchObject({ code: "delivery-failed" });
    expect(fixture.auditStore.events).toContainEqual(expect.objectContaining({
      outcome: "failed",
      reasonCode: "provider-failed",
    }));
  });

  it("does not return a sent receipt when required audit delivery fails", async () => {
    const fixture = createFixture();
    fixture.auditStore.append = async () => { throw new Error("audit unavailable"); };
    await expect(fixture.service.send(fixture.context, fixture.command))
      .rejects.toMatchObject({ code: "delivery-failed" });
    expect(fixture.providerCalls).toHaveLength(1);
  });
});
