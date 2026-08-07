import { describe, expect, it } from "vitest";
import { createWebhookService, createWebhookVerifier } from "./webhooks.js";

function fixture(options: { authorized?: boolean; failures?: number } = {}) {
  let failures = options.failures ?? 0;
  const sent: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const subscription = { id: "subscription_0001", tenantId: "tenant-a", enabled: true, url: "https://hooks.example.test/a", secret: "trusted-secret", allowedEvents: ["task.updated"], maximumAttempts: 2 };
  const service = createWebhookService({
    loadSubscription: async (id) => id === subscription.id ? subscription : undefined,
    authorize: async () => options.authorized !== false,
    projectEvent: async ({ resourceId }) => ({ resourceId, status: "active" }),
    send: async (request) => { if (failures-- > 0) throw new Error("provider secret response"); sent.push(request); },
    audit: () => undefined,
    now: () => new Date("2026-08-05T01:00:00Z"),
    deliveryId: () => "delivery_0001",
  });
  return { service, sent, subscription, context: { tenantId: "tenant-a", principalId: "user-1", correlationId: "request-1" }, command: { subscriptionId: subscription.id, eventType: "task.updated", resourceId: "task-1", idempotencyKey: "webhook-0001" } };
}

describe("webhook reference boundary", () => {
  it("uses a trusted destination and emits a verifiable signed event", async () => {
    const f = fixture();
    const record = await f.service.enqueue(f.context, f.command);
    expect(record).not.toHaveProperty("resourceId");
    await f.service.deliver(record.deliveryId);
    expect(f.sent[0]!.url).toBe(f.subscription.url);
    const request = f.sent[0]!;
    const verify = createWebhookVerifier({ secret: f.subscription.secret, now: () => new Date(request.headers["x-aiba-timestamp"]!), toleranceMs: 300_000 });
    const signed = { deliveryId: request.headers["x-aiba-delivery"]!, timestamp: request.headers["x-aiba-timestamp"]!, body: request.body, signature: request.headers["x-aiba-signature"]! };
    expect(verify(signed)).toBe(true);
    expect(verify(signed)).toBe(false);
  });

  it("rejects unknown events, subscriptions, and authorization without accepting a URL", async () => {
    const f = fixture({ authorized: false });
    await expect(f.service.enqueue(f.context, f.command)).rejects.toThrow("webhook-unavailable");
    await expect(f.service.enqueue({ ...f.context, tenantId: "tenant-b" }, f.command)).rejects.toThrow("webhook-unavailable");
    await expect(f.service.enqueue(f.context, { ...f.command, eventType: "secret.exfiltrate" })).rejects.toThrow("webhook-unavailable");
  });

  it("deduplicates exact commands and rejects changed reuse", async () => {
    const f = fixture();
    expect(await f.service.enqueue(f.context, f.command)).toEqual(await f.service.enqueue(f.context, f.command));
    await expect(f.service.enqueue(f.context, { ...f.command, resourceId: "task-2" })).rejects.toThrow("idempotency-conflict");
  });

  it("bounds retries and minimizes provider failures", async () => {
    const f = fixture({ failures: 2 });
    const record = await f.service.enqueue(f.context, f.command);
    expect(await f.service.deliver(record.deliveryId)).toMatchObject({ status: "retrying", errorCode: "delivery-failed", attempt: 1 });
    const failed = await f.service.deliver(record.deliveryId);
    expect(failed).toMatchObject({ status: "failed", attempt: 2 });
    expect(JSON.stringify(failed)).not.toContain("provider secret");
    await expect(f.service.deliver(record.deliveryId)).rejects.toThrow("webhook-not-deliverable");
  });

  it("rejects stale and tampered receiver signatures", () => {
    const verify = createWebhookVerifier({ secret: "trusted-secret", now: () => new Date("2026-08-05T01:10:00Z"), toleranceMs: 300_000 });
    expect(verify({ deliveryId: "delivery_0001", timestamp: "2026-08-05T01:00:00Z", body: "{}", signature: `v1=${"a".repeat(64)}` })).toBe(false);
  });
});
