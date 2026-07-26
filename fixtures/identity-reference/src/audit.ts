import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditOutcome, AuthorizationResource, Principal } from "@aiba/spec";

const ACTION = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const REASON = /^[a-z][a-z0-9-]*$/;
const PRINCIPAL_TYPES = new Set(["user", "service", "reviewer", "anonymous"]);
const OUTCOMES = new Set<AuditOutcome>(["allowed", "denied", "succeeded", "failed"]);

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
}

export interface AuditDependencies {
  store: AuditStore;
  now?: () => Date;
  eventId?: () => string;
}

export interface AuditContext {
  actor: Principal;
  correlationId: string;
}

export class AuditError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid-audit-context" | "invalid-audit-event" | "audit-delivery-failed",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "AuditError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validPrincipal(principal: Principal): boolean {
  return PRINCIPAL_TYPES.has(principal.type)
    && typeof principal.subject === "string"
    && principal.subject.length > 0
    && principal.subject.length <= 255
    && (!principal.tenantId || principal.tenantId.length <= 255);
}

function parseTarget(value: unknown): AuthorizationResource | undefined | null {
  if (value === undefined) return undefined;
  const target = record(value);
  if (
    !target
    || !hasOnlyKeys(target, ["type", "id", "tenantId"])
    || typeof target.type !== "string"
    || !/^[a-z][a-z0-9-]*$/.test(target.type)
    || (target.id !== undefined && (typeof target.id !== "string" || target.id.length < 1))
    || (target.tenantId !== undefined
      && (typeof target.tenantId !== "string" || target.tenantId.length < 1))
  ) return null;
  return {
    type: target.type,
    ...(typeof target.id === "string" ? { id: target.id } : {}),
    ...(typeof target.tenantId === "string" ? { tenantId: target.tenantId } : {}),
  };
}

export function createAuditService(dependencies: AuditDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const eventId = dependencies.eventId ?? randomUUID;

  async function recordEvent(context: AuditContext, input: unknown): Promise<AuditEvent> {
    if (
      !validPrincipal(context.actor)
      || typeof context.correlationId !== "string"
      || context.correlationId.length < 8
      || context.correlationId.length > 255
    ) {
      throw new AuditError("Trusted audit context is invalid", "invalid-audit-context");
    }
    const body = record(input);
    const target = parseTarget(body?.target);
    if (
      !body
      || !hasOnlyKeys(body, ["action", "outcome", "reasonCode", "target"])
      || typeof body.action !== "string"
      || !ACTION.test(body.action)
      || !OUTCOMES.has(body.outcome as AuditOutcome)
      || (body.reasonCode !== undefined
        && (typeof body.reasonCode !== "string" || !REASON.test(body.reasonCode)))
      || target === null
    ) {
      throw new AuditError("Audit event is invalid", "invalid-audit-event");
    }
    const event: AuditEvent = {
      eventId: eventId(),
      action: body.action,
      outcome: body.outcome as AuditOutcome,
      actor: { ...context.actor },
      ...(target ? { target } : {}),
      ...(typeof body.reasonCode === "string" ? { reasonCode: body.reasonCode } : {}),
      occurredAt: now().toISOString(),
      correlationId: context.correlationId,
    };
    try {
      await dependencies.store.append(event);
    } catch (error) {
      throw new AuditError("Audit event delivery failed", "audit-delivery-failed", {
        cause: error,
      });
    }
    return event;
  }

  return Object.freeze({ record: recordEvent });
}
