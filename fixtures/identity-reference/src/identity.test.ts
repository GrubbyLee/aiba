import { describe, expect, it } from "vitest";
import type { AuditEvent, Principal } from "aiba-spec";
import {
  createIdentityService,
  createPasswordCredential,
  IdentityError,
  type IdentityAttemptLimiter,
  type IdentityPolicy,
  type IdentitySession,
  type IdentitySessionStore,
  type IdentityUser,
  type IdentityUserStore,
} from "./identity.js";

const password = "correct horse battery staple";

class MemoryUsers implements IdentityUserStore {
  constructor(private readonly users: IdentityUser[]) {}

  async findByIdentifier(identifier: string): Promise<IdentityUser | undefined> {
    return this.users.find((user) => user.identifier === identifier);
  }
}

class MemorySessions implements IdentitySessionStore {
  readonly records = new Map<string, IdentitySession>();

  async save(session: IdentitySession): Promise<void> {
    this.records.set(session.tokenDigest, session);
  }

  async findByTokenDigest(tokenDigest: string): Promise<IdentitySession | undefined> {
    return this.records.get(tokenDigest);
  }

  async revoke(tokenDigest: string, revokedAt: string): Promise<boolean> {
    const session = this.records.get(tokenDigest);
    if (!session) return false;
    this.records.set(tokenDigest, { ...session, revokedAt });
    return true;
  }
}

class MemoryAttempts implements IdentityAttemptLimiter {
  private readonly windows = new Map<string, { startedAt: number; attempts: number }>();

  async consume(
    actorKey: string,
    maximumAttempts: number,
    windowMs: number,
    now: Date,
  ): Promise<boolean> {
    const current = this.windows.get(actorKey);
    if (!current || now.getTime() - current.startedAt >= windowMs) {
      this.windows.set(actorKey, { startedAt: now.getTime(), attempts: 1 });
      return true;
    }
    if (current.attempts >= maximumAttempts) return false;
    current.attempts += 1;
    return true;
  }

  async reset(actorKey: string): Promise<void> {
    this.windows.delete(actorKey);
  }
}

async function createFixture(overrides: Partial<IdentityPolicy> = {}) {
  let clock = new Date("2026-07-26T00:00:00Z");
  const credential = await createPasswordCredential(password);
  const dummyCredential = await createPasswordCredential("dummy password value");
  const user: IdentityUser = {
    id: "user-42",
    identifier: "owner@example.com",
    status: "active",
    credential,
    tenantId: "tenant-a",
  };
  const sessions = new MemorySessions();
  const events: AuditEvent[] = [];
  const policy: IdentityPolicy = {
    enabled: true,
    sessionTtlMs: 30 * 60 * 1000,
    maximumAttempts: 3,
    attemptWindowMs: 60_000,
    dummyCredential,
    ...overrides,
  };
  const service = createIdentityService({
    loadPolicy: () => policy,
    users: new MemoryUsers([user]),
    sessions,
    attempts: new MemoryAttempts(),
    audit: (event) => events.push(event),
    now: () => clock,
  });
  const context = {
    actorKey: "network:203.0.113.8",
    correlationId: "request-auth-001",
  };
  const authenticate = (input: unknown = {
    identifier: "OWNER@example.com ",
    password,
  }) => service.authenticate(context, input);
  return {
    authenticate,
    context,
    events,
    policy,
    service,
    sessions,
    user,
    setClock: (value: string) => { clock = new Date(value); },
  };
}

describe("identity reference boundary", () => {
  it("stores a one-way memory-hard credential", async () => {
    const credential = await createPasswordCredential(password);
    expect(credential).toMatchObject({ algorithm: "scrypt-v1" });
    expect(credential.salt).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(credential.digest).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(credential)).not.toContain(password);
  });

  it("derives a user principal on the server and issues an opaque session", async () => {
    const fixture = await createFixture();
    const result = await fixture.authenticate();
    expect(result.principal).toEqual({
      type: "user",
      subject: "user-42",
      tenantId: "tenant-a",
    });
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toBe("2026-07-26T00:30:00.000Z");
    expect([...fixture.sessions.records.keys()]).not.toContain(result.sessionToken);
    expect(await fixture.service.validateSession("request-session-001", result.sessionToken))
      .toEqual(result.principal);
  });

  it("rejects client attempts to assert principal, tenant, roles, or permissions", async () => {
    const fixture = await createFixture();
    await expect(fixture.authenticate({
      identifier: "owner@example.com",
      password,
      principal: { type: "service", subject: "admin" },
      tenantId: "other-tenant",
      roles: ["admin"],
      permissions: ["users:write"],
    })).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("uses one public failure for unknown, disabled, and invalid credentials", async () => {
    const wrong = await createFixture();
    const unknown = await createFixture();
    const disabled = await createFixture();
    disabled.user.status = "disabled";
    const attempts = [
      () => wrong.authenticate({ identifier: "owner@example.com", password: "wrong password value" }),
      () => unknown.authenticate({ identifier: "missing@example.com", password: "wrong password value" }),
      () => disabled.authenticate(),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({
        name: "IdentityError",
        code: "authentication-failed",
        message: "Authentication failed",
      });
    }
  });

  it("expires and revokes sessions in trusted storage", async () => {
    const expired = await createFixture();
    const expiredSession = await expired.authenticate();
    expired.setClock("2026-07-26T00:30:00.001Z");
    await expect(expired.service.validateSession(
      "request-expired-001",
      expiredSession.sessionToken,
    )).rejects.toMatchObject({ code: "session-invalid" });

    const revoked = await createFixture();
    const revokedSession = await revoked.authenticate();
    const operator: Principal = { type: "service", subject: "identity-admin" };
    await revoked.service.revokeSession(
      { actor: operator, correlationId: "request-revoke-001" },
      revokedSession.sessionToken,
    );
    await expect(revoked.service.validateSession(
      "request-revoked-001",
      revokedSession.sessionToken,
    )).rejects.toMatchObject({ code: "session-invalid" });
  });

  it("rate limits a trusted actor even when identifiers change", async () => {
    const fixture = await createFixture({ maximumAttempts: 2 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(fixture.authenticate({
        identifier: `changed-${attempt}@example.com`,
        password: "wrong password value",
      })).rejects.toBeInstanceOf(IdentityError);
    }
    await expect(fixture.authenticate()).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("audits outcomes without raw credentials, hashes, or session tokens", async () => {
    const fixture = await createFixture();
    await expect(fixture.authenticate({
      identifier: "owner@example.com",
      password: "wrong password value",
    })).rejects.toBeInstanceOf(IdentityError);
    const session = await fixture.authenticate();
    await fixture.service.validateSession("request-session-002", session.sessionToken);
    await fixture.service.revokeSession(
      {
        actor: { type: "service", subject: "identity-admin" },
        correlationId: "request-revoke-002",
      },
      session.sessionToken,
    );

    expect(fixture.events.map((event) => `${event.action}:${event.outcome}`)).toEqual([
      "identity:authenticate:denied",
      "identity:authenticate:allowed",
      "identity:validate-session:allowed",
      "identity:revoke-session:succeeded",
    ]);
    const serialized = JSON.stringify(fixture.events);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain("wrong password value");
    expect(serialized).not.toContain(session.sessionToken);
    expect(serialized).not.toContain(fixture.user.credential.digest);
  });

  it("rejects unsafe policy and weak provisioning passwords", async () => {
    await expect(createPasswordCredential("too-short"))
      .rejects.toMatchObject({ code: "invalid-request" });
    const fixture = await createFixture({ sessionTtlMs: 0 });
    await expect(fixture.authenticate()).rejects.toMatchObject({ code: "invalid-policy" });
  });
});
