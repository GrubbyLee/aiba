import { describe, expect, it } from "vitest";
import {
  validateAuditEvent,
  validateAuthorizationDecision,
  validateNotificationCommand,
  validateNotificationReceipt,
  validatePrincipal,
} from "./validation.js";

describe("core security interfaces", () => {
  it("accepts a minimal server-derived principal", () => {
    expect(validatePrincipal({
      type: "user",
      subject: "user-42",
      tenantId: "tenant-a",
    })).toEqual({ type: "user", subject: "user-42", tenantId: "tenant-a" });
  });

  it("rejects roles, permissions, and unknown principal claims", () => {
    expect(() => validatePrincipal({
      type: "user",
      subject: "user-42",
      roles: ["admin"],
      permissions: ["users:write"],
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates an explicit authorization decision", () => {
    expect(validateAuthorizationDecision({
      decisionId: "decision-00000001",
      principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
      allowed: false,
      reasonCode: "not-owner",
      policyVersion: "policy-7",
      evaluatedAt: "2026-07-26T00:00:00Z",
    }).allowed).toBe(false);
    expect(() => validateAuthorizationDecision({
      decisionId: "decision-00000001",
      principal: { type: "user", subject: "user-42" },
      action: "admin",
      resource: { type: "system" },
      allowed: true,
      reasonCode: "admin",
      policyVersion: "policy-7",
      evaluatedAt: "2026-07-26T00:00:00Z",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("rejects reusable secrets in the portable audit event shape", () => {
    expect(validateAuditEvent({
      eventId: "event-00000000001",
      action: "identity:authenticate",
      outcome: "denied",
      actor: { type: "anonymous", subject: "transport:hashed" },
      reasonCode: "invalid-credentials",
      occurredAt: "2026-07-26T00:00:00Z",
      correlationId: "request-001",
    }).outcome).toBe("denied");
    expect(() => validateAuditEvent({
      eventId: "event-00000000001",
      action: "identity:authenticate",
      outcome: "denied",
      actor: { type: "anonymous", subject: "transport:hashed" },
      occurredAt: "2026-07-26T00:00:00Z",
      correlationId: "request-001",
      password: "reusable-secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates template notification commands and minimized receipts", () => {
    expect(validateNotificationCommand({
      recipientId: "user-42",
      channel: "wechat-template",
      templateId: "account-disabled",
      parameters: { displayName: "User" },
      idempotencyKey: "workflow-00000001",
    }).channel).toBe("wechat-template");
    expect(validateNotificationReceipt({
      notificationId: "notification-0001",
      status: "sent",
      channel: "wechat-template",
      templateId: "account-disabled",
      createdAt: "2026-07-26T00:00:00Z",
    }).status).toBe("sent");
    expect(() => validateNotificationCommand({
      recipientId: "user-42",
      channel: "wechat-template",
      templateId: "account-disabled",
      parameters: {},
      idempotencyKey: "workflow-00000001",
      providerSecret: "secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });
});
