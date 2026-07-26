import { createHash, randomUUID } from "node:crypto";
import type {
  AuthorizationDecision,
  NotificationChannel,
  NotificationCommand,
  NotificationReceipt,
  Principal,
} from "@aiba/spec";
import type { AuditContext } from "./audit.js";

export interface NotificationTemplate {
  id: string;
  channel: NotificationChannel;
  enabled: boolean;
  parameterKeys: string[];
}

export interface NotificationRecipient {
  id: string;
  tenantId: string;
  channel: NotificationChannel;
  destination: string;
  consented: boolean;
}

export interface NotificationDirectory {
  loadTemplate(tenantId: string, templateId: string): Promise<NotificationTemplate | undefined>;
  resolveRecipient(
    tenantId: string,
    recipientId: string,
    channel: NotificationChannel,
  ): Promise<NotificationRecipient | undefined>;
}

export interface NotificationProvider {
  send(input: {
    destination: string;
    templateId: string;
    parameters: Record<string, string>;
    idempotencyKey: string;
  }): Promise<void>;
}

export interface NotificationDeliveryGate {
  execute(
    scopedKey: string,
    commandFingerprint: string,
    deliver: () => Promise<NotificationReceipt>,
  ): Promise<NotificationReceipt>;
}

export interface NotificationAuthorizer {
  decide(
    context: { principal: Principal; correlationId: string },
    input: {
      action: "notifications:send";
      resource: { type: "notification-recipient"; id: string; tenantId: string };
    },
  ): Promise<AuthorizationDecision>;
}

export interface NotificationAudit {
  record(
    context: AuditContext,
    input: {
      action: string;
      outcome: "succeeded" | "failed";
      reasonCode: string;
      target: { type: "notification"; id: string; tenantId: string };
    },
  ): Promise<unknown>;
}

export interface NotificationDependencies {
  directory: NotificationDirectory;
  authorization: NotificationAuthorizer;
  audit: NotificationAudit;
  deliveries: NotificationDeliveryGate;
  provider: NotificationProvider;
  now?: () => Date;
  notificationId?: () => string;
}

export interface NotificationContext {
  principal: Principal;
  correlationId: string;
}

export class NotificationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "delivery-failed"
      | "forbidden"
      | "idempotency-conflict"
      | "invalid-request",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "NotificationError";
  }
}

const channels = new Set<NotificationChannel>([
  "in-app",
  "email",
  "sms",
  "wechat-template",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parseCommand(input: unknown): NotificationCommand | undefined {
  const body = record(input);
  const parameters = record(body?.parameters);
  if (
    !body
    || !hasExactKeys(body, ["channel", "idempotencyKey", "parameters", "recipientId", "templateId"])
    || typeof body.recipientId !== "string"
    || body.recipientId.length < 1
    || body.recipientId.length > 255
    || typeof body.channel !== "string"
    || !channels.has(body.channel as NotificationChannel)
    || typeof body.templateId !== "string"
    || !/^[a-z][a-z0-9-]{1,95}$/.test(body.templateId)
    || typeof body.idempotencyKey !== "string"
    || body.idempotencyKey.length < 16
    || body.idempotencyKey.length > 255
    || !parameters
    || Object.keys(parameters).length > 30
    || Object.entries(parameters).some(([key, value]) =>
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
      || typeof value !== "string"
      || value.length > 1000)
  ) return undefined;
  return {
    recipientId: body.recipientId,
    channel: body.channel as NotificationChannel,
    templateId: body.templateId,
    parameters: parameters as Record<string, string>,
    idempotencyKey: body.idempotencyKey,
  };
}

function fingerprint(command: NotificationCommand): string {
  const parameters = Object.fromEntries(Object.entries(command.parameters).sort(([left], [right]) =>
    left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify({ ...command, parameters }), "utf8").digest("hex");
}

export function createNotificationService(dependencies: NotificationDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const notificationId = dependencies.notificationId ?? randomUUID;

  async function audit(
    context: NotificationContext,
    id: string,
    outcome: "succeeded" | "failed",
    reasonCode: string,
    tenantId: string,
  ): Promise<void> {
    await dependencies.audit.record({
      actor: context.principal,
      correlationId: context.correlationId,
    }, {
      action: "notifications:deliver",
      outcome,
      reasonCode,
      target: { type: "notification", id, tenantId },
    });
  }

  async function send(
    context: NotificationContext,
    input: unknown,
  ): Promise<NotificationReceipt> {
    const tenantId = context.principal.tenantId;
    const command = parseCommand(input);
    if (!tenantId || !context.correlationId || context.correlationId.length < 8 || !command) {
      throw new NotificationError("Notification request is invalid", "invalid-request");
    }
    const decision = await dependencies.authorization.decide(context, {
      action: "notifications:send",
      resource: {
        type: "notification-recipient",
        id: command.recipientId,
        tenantId,
      },
    });
    if (!decision.allowed) throw new NotificationError("Notification send is forbidden", "forbidden");
    const [template, recipient] = await Promise.all([
      dependencies.directory.loadTemplate(tenantId, command.templateId),
      dependencies.directory.resolveRecipient(tenantId, command.recipientId, command.channel),
    ]);
    if (
      !template
      || !template.enabled
      || template.channel !== command.channel
      || Object.keys(command.parameters).some((key) => !template.parameterKeys.includes(key))
      || template.parameterKeys.some((key) => !(key in command.parameters))
    ) throw new NotificationError("Notification request is invalid", "invalid-request");

    const scopedKey = createHash("sha256")
      .update(`${tenantId}\0${command.idempotencyKey}`, "utf8")
      .digest("hex");
    try {
      return await dependencies.deliveries.execute(scopedKey, fingerprint(command), async () => {
        const id = notificationId();
        const createdAt = now().toISOString();
        if (
          !recipient
          || !recipient.consented
          || recipient.tenantId !== tenantId
          || recipient.channel !== command.channel
        ) {
          const receipt: NotificationReceipt = {
            notificationId: id,
            status: "suppressed",
            channel: command.channel,
            templateId: command.templateId,
            createdAt,
          };
          await audit(context, id, "succeeded", "not-deliverable", tenantId);
          return receipt;
        }
        const providerKey = createHash("sha256")
          .update(`${tenantId}\0${command.idempotencyKey}\0provider`, "utf8")
          .digest("hex");
        try {
          await dependencies.provider.send({
            destination: recipient.destination,
            templateId: template.id,
            parameters: { ...command.parameters },
            idempotencyKey: providerKey,
          });
        } catch (error) {
          try {
            await audit(context, id, "failed", "provider-failed", tenantId);
          } catch {
            // The caller still receives a visible failure; the adapter should use an audit outbox.
          }
          throw new NotificationError("Notification delivery failed", "delivery-failed", {
            cause: error,
          });
        }
        try {
          await audit(context, id, "succeeded", "sent", tenantId);
        } catch (error) {
          throw new NotificationError("Notification audit delivery failed", "delivery-failed", {
            cause: error,
          });
        }
        return {
          notificationId: id,
          status: "sent",
          channel: command.channel,
          templateId: command.templateId,
          createdAt,
        };
      });
    } catch (error) {
      if (error instanceof NotificationError) throw error;
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "IDEMPOTENCY_CONFLICT") {
        throw new NotificationError("Idempotency key is bound to another command", "idempotency-conflict");
      }
      throw new NotificationError("Notification delivery failed", "delivery-failed", {
        cause: error,
      });
    }
  }

  return Object.freeze({ send });
}
