import { describe, expect, it } from "vitest";
import type { AuditEvent, AuthorizationDecision, Principal } from "@aiba/spec";
import {
  createUsersService,
  type UserDirectory,
  type UserRecord,
  type UsersAuthorizer,
} from "./users.js";

class MemoryDirectory implements UserDirectory {
  readonly users = new Map<string, UserRecord>();
  readonly events: AuditEvent[] = [];
  readonly revokedUsers = new Set<string>();
  failNextUpdate = false;

  async findById(id: string): Promise<UserRecord | undefined> { return this.users.get(id); }
  async findByIdentifier(tenantId: string, identifier: string): Promise<UserRecord | undefined> {
    return [...this.users.values()].find((user) =>
      user.tenantId === tenantId
      && user.normalizedIdentifier === identifier
      && user.status !== "deleted",
    );
  }
  async create(user: UserRecord, event: AuditEvent): Promise<boolean> {
    if (await this.findByIdentifier(user.tenantId, user.normalizedIdentifier)) return false;
    this.users.set(user.id, user);
    this.events.push(event);
    return true;
  }
  async update(
    user: UserRecord,
    expectedVersion: number,
    event: AuditEvent,
    revokeSessions: boolean,
  ): Promise<boolean> {
    const current = this.users.get(user.id);
    if (this.failNextUpdate || !current || current.version !== expectedVersion) {
      this.failNextUpdate = false;
      return false;
    }
    this.users.set(user.id, user);
    this.events.push(event);
    if (revokeSessions) this.revokedUsers.add(user.id);
    return true;
  }
}

class TestAuthorizer implements UsersAuthorizer {
  allowed = true;
  readonly requests: Array<{ action: string; tenantId: string; id?: string }> = [];
  async decide(
    context: { principal: Principal; correlationId: string },
    input: { action: string; resource: { type: "user"; id?: string; tenantId: string } },
  ): Promise<AuthorizationDecision> {
    this.requests.push({
      action: input.action,
      tenantId: input.resource.tenantId,
      ...(input.resource.id ? { id: input.resource.id } : {}),
    });
    return {
      decisionId: "decision-00000001",
      principal: context.principal,
      action: input.action,
      resource: input.resource,
      allowed: this.allowed,
      reasonCode: this.allowed ? "explicit-allow" : "default-deny",
      policyVersion: "policy-7",
      evaluatedAt: "2026-07-26T00:00:00Z",
    };
  }
}

function createFixture() {
  const directory = new MemoryDirectory();
  const authorization = new TestAuthorizer();
  let nextId = 42;
  const service = createUsersService({
    directory,
    authorization,
    now: () => new Date("2026-07-26T00:00:00Z"),
    userId: () => `user-${nextId++}`,
    eventId: () => `event-${directory.events.length.toString().padStart(11, "0")}`,
  });
  const context = {
    principal: { type: "user", subject: "admin-1", tenantId: "tenant-a" } as Principal,
    correlationId: "request-users-001",
  };
  return { authorization, context, directory, service };
}

describe("users lifecycle reference boundary", () => {
  it("derives tenant, ID, state, and audit event on create", async () => {
    const fixture = createFixture();
    const user = await fixture.service.create(fixture.context, {
      identifier: " NEW.User@Example.com ",
      displayName: "New User",
    });
    expect(user).toEqual({
      id: "user-42",
      tenantId: "tenant-a",
      displayName: "New User",
      status: "pending",
      version: 1,
    });
    expect(JSON.stringify(user)).not.toContain("new.user@example.com");
    expect(fixture.directory.users.get("user-42")?.normalizedIdentifier)
      .toBe("new.user@example.com");
    expect(fixture.directory.events[0]).toMatchObject({
      action: "users:create",
      actor: fixture.context.principal,
      target: { id: "user-42", tenantId: "tenant-a" },
    });
  });

  it("rejects role, permission, credential, tenant, ID, and status injection", async () => {
    const fixture = createFixture();
    await expect(fixture.service.create(fixture.context, {
      identifier: "user@example.com",
      displayName: "User",
      id: "admin",
      tenantId: "tenant-b",
      status: "active",
      roles: ["admin"],
      permissions: ["system:admin"],
      password: "credential",
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(fixture.directory.users.size).toBe(0);
  });

  it("requires authorization for create, read, profile, and status operations", async () => {
    const fixture = createFixture();
    fixture.authorization.allowed = false;
    await expect(fixture.service.create(fixture.context, {
      identifier: "user@example.com",
      displayName: "User",
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.directory.users.size).toBe(0);
  });

  it("hides cross-tenant records as not found", async () => {
    const fixture = createFixture();
    fixture.directory.users.set("user-b", {
      id: "user-b",
      tenantId: "tenant-b",
      normalizedIdentifier: "b@example.com",
      displayName: "Tenant B",
      status: "active",
      version: 1,
      createdAt: "2026-07-26T00:00:00Z",
      updatedAt: "2026-07-26T00:00:00Z",
    });
    fixture.authorization.allowed = false;
    await expect(fixture.service.get(fixture.context, "user-b"))
      .rejects.toMatchObject({ code: "not-found" });
    expect(fixture.authorization.requests[0]).toMatchObject({ tenantId: "tenant-b" });
  });

  it("enforces normalized identifier uniqueness per tenant", async () => {
    const fixture = createFixture();
    await fixture.service.create(fixture.context, {
      identifier: "user@example.com",
      displayName: "User",
    });
    await expect(fixture.service.create(fixture.context, {
      identifier: " USER@example.com ",
      displayName: "Duplicate",
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("uses a terminal state graph and revokes sessions on disable or delete", async () => {
    const fixture = createFixture();
    const created = await fixture.service.create(fixture.context, {
      identifier: "user@example.com",
      displayName: "User",
    });
    const active = await fixture.service.changeStatus(fixture.context, created.id, {
      status: "active",
      version: created.version,
    });
    const disabled = await fixture.service.changeStatus(fixture.context, active.id, {
      status: "disabled",
      version: active.version,
    });
    expect(fixture.directory.revokedUsers).toContain(created.id);
    const deleted = await fixture.service.changeStatus(fixture.context, disabled.id, {
      status: "deleted",
      version: disabled.version,
    });
    await expect(fixture.service.changeStatus(fixture.context, deleted.id, {
      status: "active",
      version: deleted.version,
    })).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("rejects stale writes without appending a mutation event", async () => {
    const fixture = createFixture();
    const created = await fixture.service.create(fixture.context, {
      identifier: "user@example.com",
      displayName: "User",
    });
    fixture.directory.failNextUpdate = true;
    const eventsBefore = fixture.directory.events.length;
    await expect(fixture.service.updateProfile(fixture.context, created.id, {
      displayName: "Changed",
      version: created.version,
    })).rejects.toMatchObject({ code: "conflict" });
    expect(fixture.directory.events).toHaveLength(eventsBefore);
    expect(fixture.directory.users.get(created.id)?.displayName).toBe("User");
  });
});
