import { randomUUID } from "node:crypto";
import type { AuditEvent, AuthorizationDecision, Principal } from "@aiba/spec";

export type UserStatus = "pending" | "active" | "disabled" | "deleted";

export interface UserRecord {
  id: string;
  tenantId: string;
  normalizedIdentifier: string;
  displayName: string;
  status: UserStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserView {
  id: string;
  tenantId: string;
  displayName: string;
  status: UserStatus;
  version: number;
}

export interface UserDirectory {
  findById(id: string): Promise<UserRecord | undefined>;
  findByIdentifier(tenantId: string, normalizedIdentifier: string): Promise<UserRecord | undefined>;
  create(record: UserRecord, event: AuditEvent): Promise<boolean>;
  update(
    record: UserRecord,
    expectedVersion: number,
    event: AuditEvent,
    revokeSessions: boolean,
  ): Promise<boolean>;
}

export interface UsersAuthorizer {
  decide(
    context: { principal: Principal; correlationId: string },
    input: { action: string; resource: { type: "user"; id?: string; tenantId: string } },
  ): Promise<AuthorizationDecision>;
}

export interface UsersDependencies {
  directory: UserDirectory;
  authorization: UsersAuthorizer;
  now?: () => Date;
  userId?: () => string;
  eventId?: () => string;
}

export interface UsersContext {
  principal: Principal;
  correlationId: string;
}

export class UsersError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "conflict"
      | "forbidden"
      | "invalid-request"
      | "not-found",
  ) {
    super(message);
    this.name = "UsersError";
  }
}

const transitions: Record<UserStatus, UserStatus[]> = {
  pending: ["active", "deleted"],
  active: ["disabled", "deleted"],
  disabled: ["active", "deleted"],
  deleted: [],
};

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

function assertContext(context: UsersContext): string {
  if (
    !context.correlationId
    || context.correlationId.length < 8
    || !context.principal.subject
    || !context.principal.tenantId
  ) {
    throw new UsersError("Trusted user context is invalid", "invalid-request");
  }
  return context.principal.tenantId;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function view(user: UserRecord): UserView {
  return {
    id: user.id,
    tenantId: user.tenantId,
    displayName: user.displayName,
    status: user.status,
    version: user.version,
  };
}

export function createUsersService(dependencies: UsersDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const userId = dependencies.userId ?? randomUUID;
  const eventId = dependencies.eventId ?? randomUUID;

  function event(
    context: UsersContext,
    action: string,
    target: UserRecord,
    reasonCode: string,
  ): AuditEvent {
    return {
      eventId: eventId(),
      action,
      outcome: "succeeded",
      actor: { ...context.principal },
      target: { type: "user", id: target.id, tenantId: target.tenantId },
      reasonCode,
      occurredAt: now().toISOString(),
      correlationId: context.correlationId,
    };
  }

  async function authorizationAllowed(
    context: UsersContext,
    action: string,
    id: string | undefined,
    tenantId: string,
  ): Promise<boolean> {
    const decision = await dependencies.authorization.decide(context, {
      action,
      resource: {
        type: "user",
        ...(id ? { id } : {}),
        tenantId,
      },
    });
    return decision.allowed;
  }

  async function scopedUser(context: UsersContext, id: string, action: string): Promise<UserRecord> {
    const tenantId = assertContext(context);
    const user = await dependencies.directory.findById(id);
    if (!user) throw new UsersError("User was not found", "not-found");
    const allowed = await authorizationAllowed(context, action, user.id, user.tenantId);
    if (user.tenantId !== tenantId) throw new UsersError("User was not found", "not-found");
    if (!allowed) throw new UsersError("User operation is forbidden", "forbidden");
    return user;
  }

  async function create(context: UsersContext, input: unknown): Promise<UserView> {
    const tenantId = assertContext(context);
    const body = record(input);
    if (
      !body
      || !hasExactKeys(body, ["displayName", "identifier"])
      || typeof body.identifier !== "string"
      || typeof body.displayName !== "string"
      || body.identifier.length < 3
      || body.identifier.length > 320
      || body.displayName.trim().length < 1
      || body.displayName.length > 160
    ) throw new UsersError("User create request is invalid", "invalid-request");
    if (!await authorizationAllowed(context, "users:create", undefined, tenantId)) {
      throw new UsersError("User operation is forbidden", "forbidden");
    }
    const normalizedIdentifier = normalizeIdentifier(body.identifier);
    if (await dependencies.directory.findByIdentifier(tenantId, normalizedIdentifier)) {
      throw new UsersError("User identity already exists", "conflict");
    }
    const timestamp = now().toISOString();
    const user: UserRecord = {
      id: userId(),
      tenantId,
      normalizedIdentifier,
      displayName: body.displayName.trim(),
      status: "pending",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!await dependencies.directory.create(
      user,
      event(context, "users:create", user, "user-created"),
    )) throw new UsersError("User identity already exists", "conflict");
    return view(user);
  }

  async function get(context: UsersContext, id: string): Promise<UserView> {
    const user = await scopedUser(context, id, "users:read");
    return view(user);
  }

  async function updateProfile(
    context: UsersContext,
    id: string,
    input: unknown,
  ): Promise<UserView> {
    const body = record(input);
    if (
      !body
      || !hasExactKeys(body, ["displayName", "version"])
      || typeof body.displayName !== "string"
      || body.displayName.trim().length < 1
      || body.displayName.length > 160
      || !Number.isSafeInteger(body.version)
    ) throw new UsersError("User update request is invalid", "invalid-request");
    const current = await scopedUser(context, id, "users:update");
    if (current.status === "deleted") throw new UsersError("User was not found", "not-found");
    if (body.version !== current.version) throw new UsersError("User version changed", "conflict");
    const updated: UserRecord = {
      ...current,
      displayName: body.displayName.trim(),
      version: current.version + 1,
      updatedAt: now().toISOString(),
    };
    if (!await dependencies.directory.update(
      updated,
      current.version,
      event(context, "users:update-profile", updated, "profile-updated"),
      false,
    )) throw new UsersError("User version changed", "conflict");
    return view(updated);
  }

  async function changeStatus(
    context: UsersContext,
    id: string,
    input: unknown,
  ): Promise<UserView> {
    const body = record(input);
    if (
      !body
      || !hasExactKeys(body, ["status", "version"])
      || typeof body.status !== "string"
      || !["active", "disabled", "deleted"].includes(body.status)
      || !Number.isSafeInteger(body.version)
    ) throw new UsersError("User status request is invalid", "invalid-request");
    const current = await scopedUser(context, id, "users:change-status");
    const nextStatus = body.status as UserStatus;
    if (body.version !== current.version) throw new UsersError("User version changed", "conflict");
    if (!transitions[current.status].includes(nextStatus)) {
      throw new UsersError("User status transition is invalid", "invalid-request");
    }
    const updated: UserRecord = {
      ...current,
      status: nextStatus,
      version: current.version + 1,
      updatedAt: now().toISOString(),
    };
    const revokeSessions = nextStatus === "disabled" || nextStatus === "deleted";
    if (!await dependencies.directory.update(
      updated,
      current.version,
      event(context, "users:change-status", updated, `user-${nextStatus}`),
      revokeSessions,
    )) throw new UsersError("User version changed", "conflict");
    return view(updated);
  }

  return Object.freeze({ create, get, updateProfile, changeStatus });
}
