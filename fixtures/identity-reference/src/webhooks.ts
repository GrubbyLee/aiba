import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookDeliveryCommand, WebhookDeliveryRecord } from "aiba-spec";

export interface WebhookContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
}

export interface TrustedWebhookSubscription {
  id: string;
  tenantId: string;
  enabled: boolean;
  url: string;
  secret: string;
  allowedEvents: string[];
  maximumAttempts: number;
}

interface StoredDelivery extends WebhookDeliveryRecord {
  tenantId: string;
  resourceId: string;
  commandFingerprint: string;
}

export interface WebhookDependencies {
  loadSubscription: (id: string) => Promise<TrustedWebhookSubscription | undefined>;
  authorize: (context: WebhookContext, command: WebhookDeliveryCommand) => Promise<boolean>;
  projectEvent: (input: { tenantId: string; eventType: string; resourceId: string }) => Promise<Record<string, unknown>>;
  send: (input: { url: string; body: string; headers: Record<string, string> }) => Promise<void>;
  audit: (event: { action: string; outcome: string; reasonCode?: string; correlationId: string }) => void;
  now: () => Date;
  deliveryId: () => string;
}

function publicRecord(delivery: StoredDelivery): WebhookDeliveryRecord {
  const { tenantId: _tenant, resourceId: _resource, commandFingerprint: _fingerprint, ...record } = delivery;
  return record;
}

function signature(secret: string, timestamp: string, deliveryId: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${deliveryId}.${body}`).digest("hex");
}

export function createWebhookService(dependencies: WebhookDependencies) {
  const deliveries = new Map<string, StoredDelivery>();
  const idempotency = new Map<string, string>();

  async function enqueue(context: WebhookContext, command: WebhookDeliveryCommand): Promise<WebhookDeliveryRecord> {
    const subscription = await dependencies.loadSubscription(command.subscriptionId);
    if (!subscription?.enabled || subscription.tenantId !== context.tenantId
      || !subscription.allowedEvents.includes(command.eventType)
      || subscription.maximumAttempts < 1 || subscription.maximumAttempts > 20
      || !await dependencies.authorize(context, command)) throw new Error("webhook-unavailable");
    const key = `${context.tenantId}:${command.idempotencyKey}`;
    const fingerprint = JSON.stringify(command);
    const priorId = idempotency.get(key);
    if (priorId) {
      const prior = deliveries.get(priorId)!;
      if (prior.commandFingerprint !== fingerprint) throw new Error("idempotency-conflict");
      return publicRecord(prior);
    }
    const delivery: StoredDelivery = {
      deliveryId: dependencies.deliveryId(),
      subscriptionId: subscription.id,
      eventType: command.eventType,
      status: "pending",
      attempt: 0,
      maximumAttempts: subscription.maximumAttempts,
      createdAt: dependencies.now().toISOString(),
      tenantId: context.tenantId,
      resourceId: command.resourceId,
      commandFingerprint: fingerprint,
    };
    deliveries.set(delivery.deliveryId, delivery);
    idempotency.set(key, delivery.deliveryId);
    dependencies.audit({ action: "webhooks:enqueue", outcome: "succeeded", correlationId: context.correlationId });
    return publicRecord(delivery);
  }

  async function deliver(deliveryId: string): Promise<WebhookDeliveryRecord> {
    const delivery = deliveries.get(deliveryId);
    if (!delivery || !["pending", "retrying"].includes(delivery.status)) throw new Error("webhook-not-deliverable");
    const subscription = await dependencies.loadSubscription(delivery.subscriptionId);
    if (!subscription?.enabled || subscription.tenantId !== delivery.tenantId) throw new Error("webhook-not-deliverable");
    delivery.status = "delivering";
    delivery.attempt += 1;
    const timestamp = dependencies.now().toISOString();
    const projected = await dependencies.projectEvent({ tenantId: delivery.tenantId, eventType: delivery.eventType, resourceId: delivery.resourceId });
    const body = JSON.stringify({ id: delivery.deliveryId, type: delivery.eventType, occurredAt: timestamp, data: projected });
    try {
      await dependencies.send({
        url: subscription.url,
        body,
        headers: {
          "content-type": "application/json",
          "x-aiba-delivery": delivery.deliveryId,
          "x-aiba-timestamp": timestamp,
          "x-aiba-signature": `v1=${signature(subscription.secret, timestamp, delivery.deliveryId, body)}`,
        },
      });
      delivery.status = "delivered";
      delivery.deliveredAt = dependencies.now().toISOString();
      delete delivery.errorCode;
    } catch {
      delivery.errorCode = "delivery-failed";
      delivery.status = delivery.attempt >= delivery.maximumAttempts ? "failed" : "retrying";
    }
    return publicRecord(delivery);
  }

  return { deliver, enqueue };
}

export function createWebhookVerifier(options: { secret: string; now: () => Date; toleranceMs: number }) {
  const seen = new Set<string>();
  return (input: { deliveryId: string; timestamp: string; body: string; signature: string }): boolean => {
    const time = Date.parse(input.timestamp);
    if (!Number.isFinite(time) || Math.abs(options.now().getTime() - time) > options.toleranceMs || seen.has(input.deliveryId)) return false;
    const supplied = input.signature.startsWith("v1=") ? input.signature.slice(3) : "";
    const expected = signature(options.secret, input.timestamp, input.deliveryId, input.body);
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
    seen.add(input.deliveryId);
    return true;
  };
}
