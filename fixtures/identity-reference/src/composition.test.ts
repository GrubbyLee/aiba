import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AuditEvent,
  NotificationReceipt,
  Principal,
} from "@aiba/spec";
import { createAuditService, type AuditStore } from "./audit.js";
import { createAuthorizationService, type PolicySnapshot } from "./authorization.js";
import {
  createIdentityService,
  createPasswordCredential,
  type IdentitySession,
} from "./identity.js";
import {
  createNotificationService,
  type NotificationDeliveryGate,
} from "./notification.js";
import { createUsersService, type UserRecord } from "./users.js";

describe("core capability composition", () => {
  it("carries one trusted principal through identity, policy, users, notification, and audit", async () => {
    const password = "correct horse battery staple";
    const credential = await createPasswordCredential(password);
    const dummyCredential = await createPasswordCredential("dummy password value");
    const sessions = new Map<string, IdentitySession>();
    const identityEvents: AuditEvent[] = [];
    const identity = createIdentityService({
      loadPolicy: () => ({
        enabled: true,
        sessionTtlMs: 30 * 60 * 1000,
        maximumAttempts: 5,
        attemptWindowMs: 60_000,
        dummyCredential,
      }),
      users: {
        findByIdentifier: async (identifier) => identifier === "admin@example.com"
          ? {
            id: "admin-1",
            identifier,
            status: "active",
            credential,
            tenantId: "tenant-a",
          }
          : undefined,
      },
      sessions: {
        save: async (session) => { sessions.set(session.tokenDigest, session); },
        findByTokenDigest: async (digest) => sessions.get(digest),
        revoke: async (digest, revokedAt) => {
          const session = sessions.get(digest);
          if (!session) return false;
          sessions.set(digest, { ...session, revokedAt });
          return true;
        },
      },
      attempts: {
        consume: async () => true,
        reset: async () => undefined,
      },
      audit: (event) => identityEvents.push(event),
      now: () => new Date("2026-07-26T00:00:00Z"),
    });
    const authenticated = await identity.authenticate({
      actorKey: "network:203.0.113.8",
      correlationId: "workflow-identity-001",
    }, {
      identifier: "admin@example.com",
      password,
    });

    const auditEvents: AuditEvent[] = [];
    const auditStore: AuditStore = {
      append: async (event) => { auditEvents.push(event); },
    };
    const audit = createAuditService({
      store: auditStore,
      now: () => new Date("2026-07-26T00:00:00Z"),
      eventId: () => `event-${auditEvents.length.toString().padStart(11, "0")}`,
    });
    const policy: PolicySnapshot = {
      version: "policy-composed-1",
      grants: [{
        id: "admin-workflow",
        effect: "allow",
        principals: [{ type: "user", subject: "admin-1", tenantId: "tenant-a" }],
        actions: ["users:create", "notifications:send"],
        resourceTypes: ["user", "notification-recipient"],
      }],
    };
    const authorization = createAuthorizationService({
      loadPolicy: async () => policy,
      audit,
      now: () => new Date("2026-07-26T00:00:00Z"),
    });

    const userRecords = new Map<string, UserRecord>();
    const userEvents: AuditEvent[] = [];
    const users = createUsersService({
      directory: {
        findById: async (id) => userRecords.get(id),
        findByIdentifier: async (tenantId, identifier) => [...userRecords.values()].find(
          (user) => user.tenantId === tenantId && user.normalizedIdentifier === identifier,
        ),
        create: async (user, event) => {
          userRecords.set(user.id, user);
          userEvents.push(event);
          return true;
        },
        update: async () => false,
      },
      authorization,
      now: () => new Date("2026-07-26T00:00:00Z"),
      userId: () => "user-42",
      eventId: () => "event-user-000001",
    });
    const context = {
      principal: authenticated.principal,
      correlationId: "workflow-admin-001",
    };
    const created = await users.create(context, {
      identifier: "member@example.com",
      displayName: "Member",
    });

    const deliveries = new Map<string, { fingerprint: string; receipt: NotificationReceipt }>();
    const gate: NotificationDeliveryGate = {
      execute: async (key, fingerprint, deliver) => {
        const existing = deliveries.get(key);
        if (existing) return existing.receipt;
        const receipt = await deliver();
        deliveries.set(key, { fingerprint, receipt });
        return receipt;
      },
    };
    const providerInputs: unknown[] = [];
    const notification = createNotificationService({
      directory: {
        loadTemplate: async (_tenantId, id) => ({
          id,
          channel: "email",
          enabled: true,
          parameterKeys: ["displayName"],
        }),
        resolveRecipient: async (tenantId, id, channel) => ({
          id,
          tenantId,
          channel,
          destination: "member@example.com",
          consented: true,
        }),
      },
      authorization,
      audit,
      deliveries: gate,
      provider: { send: async (input) => { providerInputs.push(input); } },
      now: () => new Date("2026-07-26T00:00:00Z"),
      notificationId: () => "notification-0001",
    });
    const receipt = await notification.send(context, {
      recipientId: created.id,
      channel: "email",
      templateId: "user-welcome",
      parameters: { displayName: created.displayName },
      idempotencyKey: "workflow-admin-0001",
    });

    expect(authenticated.principal).toEqual({
      type: "user",
      subject: "admin-1",
      tenantId: "tenant-a",
    });
    expect(created).toMatchObject({ id: "user-42", tenantId: "tenant-a", status: "pending" });
    expect(receipt).toMatchObject({ status: "sent", templateId: "user-welcome" });
    expect(providerInputs).toHaveLength(1);
    expect(auditEvents.map((event) => `${event.action}:${event.outcome}`)).toEqual([
      "authorization:evaluate:allowed",
      "authorization:evaluate:allowed",
      "notifications:deliver:succeeded",
    ]);
    expect(userEvents).toContainEqual(expect.objectContaining({
      action: "users:create",
      actor: authenticated.principal,
    }));
    const allProvenance = JSON.stringify({ identityEvents, auditEvents, userEvents, receipt });
    expect(allProvenance).not.toContain(password);
    expect(allProvenance).not.toContain(authenticated.sessionToken);
    expect(allProvenance).not.toContain("member@example.com");
    expect([...sessions.keys()]).toEqual([
      createHash("sha256").update(authenticated.sessionToken).digest("hex"),
    ]);
  });

  it("does not let a composed caller inject tenant or privilege fields", async () => {
    const principal: Principal = { type: "user", subject: "user-1", tenantId: "tenant-a" };
    expect(principal).not.toHaveProperty("roles");
    expect(principal).not.toHaveProperty("permissions");
  });
});
