import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { AuditEvent, Principal } from "aiba-spec";

const KEY_BYTES = 32;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

export interface PasswordCredential {
  algorithm: "scrypt-v1";
  salt: string;
  digest: string;
}

export interface IdentityUser {
  id: string;
  identifier: string;
  status: "active" | "disabled";
  credential: PasswordCredential;
  tenantId?: string;
}

export interface IdentitySession {
  tokenDigest: string;
  principal: Principal;
  expiresAt: string;
  revokedAt?: string;
}

export interface IdentityPolicy {
  enabled: boolean;
  sessionTtlMs: number;
  maximumAttempts: number;
  attemptWindowMs: number;
  dummyCredential: PasswordCredential;
}

export interface IdentityUserStore {
  findByIdentifier(identifier: string): Promise<IdentityUser | undefined>;
}

export interface IdentitySessionStore {
  save(session: IdentitySession): Promise<void>;
  findByTokenDigest(tokenDigest: string): Promise<IdentitySession | undefined>;
  revoke(tokenDigest: string, revokedAt: string): Promise<boolean>;
}

export interface IdentityAttemptLimiter {
  consume(
    actorKey: string,
    maximumAttempts: number,
    windowMs: number,
    now: Date,
  ): Promise<boolean>;
  reset(actorKey: string): Promise<void>;
}

export interface IdentityDependencies {
  loadPolicy: () => Readonly<IdentityPolicy>;
  users: IdentityUserStore;
  sessions: IdentitySessionStore;
  attempts: IdentityAttemptLimiter;
  audit: (event: AuditEvent) => void;
  now?: () => Date;
}

export interface AuthenticationContext {
  actorKey: string;
  correlationId: string;
}

export interface TrustedActionContext {
  actor: Principal;
  correlationId: string;
}

export class IdentityError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authentication-failed"
      | "invalid-policy"
      | "invalid-request"
      | "rate-limited"
      | "session-invalid",
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

function deriveCredential(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function decodeCredential(value: string, expectedBytes: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === expectedBytes ? decoded : undefined;
}

function validCredential(credential: PasswordCredential): boolean {
  return credential.algorithm === "scrypt-v1"
    && Boolean(decodeCredential(credential.salt, 16))
    && Boolean(decodeCredential(credential.digest, KEY_BYTES));
}

function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLocaleLowerCase("en-US");
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function assertPolicy(policy: Readonly<IdentityPolicy>): void {
  if (
    !Number.isSafeInteger(policy.sessionTtlMs)
    || policy.sessionTtlMs < 1
    || policy.sessionTtlMs > 30 * 24 * 60 * 60 * 1000
    || !Number.isSafeInteger(policy.maximumAttempts)
    || policy.maximumAttempts < 1
    || !Number.isSafeInteger(policy.attemptWindowMs)
    || policy.attemptWindowMs < 1
    || !validCredential(policy.dummyCredential)
  ) {
    throw new IdentityError("Identity policy is invalid", "invalid-policy");
  }
}

function transportPrincipal(actorKey: string): Principal {
  const subject = createHash("sha256").update(actorKey, "utf8").digest("hex").slice(0, 32);
  return { type: "anonymous", subject: `transport:${subject}` };
}

function principalFor(user: IdentityUser): Principal {
  return {
    type: "user",
    subject: user.id,
    ...(user.tenantId ? { tenantId: user.tenantId } : {}),
  };
}

export async function createPasswordCredential(password: string): Promise<PasswordCredential> {
  if (password.length < 12 || password.length > 1024) {
    throw new IdentityError("Password must contain 12 to 1024 characters", "invalid-request");
  }
  const salt = randomBytes(16);
  const digest = await deriveCredential(password, salt);
  return {
    algorithm: "scrypt-v1",
    salt: salt.toString("base64url"),
    digest: digest.toString("base64url"),
  };
}

async function verifyPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  const salt = decodeCredential(credential.salt, 16);
  const expected = decodeCredential(credential.digest, KEY_BYTES);
  if (credential.algorithm !== "scrypt-v1" || !salt || !expected) {
    throw new IdentityError("Stored credential is invalid", "invalid-policy");
  }
  const actual = await deriveCredential(password, salt);
  return timingSafeEqual(actual, expected);
}

export function createIdentityService(dependencies: IdentityDependencies) {
  const now = dependencies.now ?? (() => new Date());

  function emit(
    action: AuditEvent["action"],
    outcome: AuditEvent["outcome"],
    actor: Principal,
    correlationId: string,
    reasonCode?: string,
    target?: AuditEvent["target"],
  ): void {
    dependencies.audit({
      eventId: randomUUID(),
      action,
      outcome,
      actor,
      ...(target ? { target } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      occurredAt: now().toISOString(),
      correlationId,
    });
  }

  function failAuthentication(
    context: AuthenticationContext,
    reasonCode: string,
    code: "authentication-failed" | "invalid-request" | "rate-limited",
  ): never {
    emit(
      "identity:authenticate",
      "denied",
      transportPrincipal(context.actorKey),
      context.correlationId,
      reasonCode,
    );
    const message = code === "rate-limited"
      ? "Authentication temporarily unavailable"
      : code === "invalid-request"
        ? "Authentication request is invalid"
        : "Authentication failed";
    throw new IdentityError(message, code);
  }

  async function authenticate(context: AuthenticationContext, input: unknown) {
    if (!context.actorKey || !context.correlationId) {
      throw new IdentityError("Trusted authentication context is required", "invalid-request");
    }
    const policy = dependencies.loadPolicy();
    assertPolicy(policy);
    if (!await dependencies.attempts.consume(
      context.actorKey,
      policy.maximumAttempts,
      policy.attemptWindowMs,
      now(),
    )) {
      failAuthentication(context, "rate-limited", "rate-limited");
    }
    const body = record(input);
    if (
      !body
      || !hasExactKeys(body, ["identifier", "password"])
      || typeof body.identifier !== "string"
      || typeof body.password !== "string"
      || body.identifier.length < 1
      || body.identifier.length > 320
      || body.password.length < 1
      || body.password.length > 1024
    ) {
      failAuthentication(context, "invalid-request", "invalid-request");
    }

    const identifier = normalizeIdentifier(body.identifier);
    const user = await dependencies.users.findByIdentifier(identifier);
    const credential = user?.credential ?? policy.dummyCredential;
    const credentialMatches = await verifyPassword(body.password, credential);
    if (!policy.enabled || !user || user.status !== "active" || !credentialMatches) {
      const reason = !policy.enabled
        ? "identity-disabled"
        : user?.status === "disabled"
          ? "account-disabled"
          : "invalid-credentials";
      failAuthentication(context, reason, "authentication-failed");
    }

    const principal = principalFor(user);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now().getTime() + policy.sessionTtlMs).toISOString();
    await dependencies.sessions.save({
      tokenDigest: digestToken(token),
      principal,
      expiresAt,
    });
    await dependencies.attempts.reset(context.actorKey);
    emit(
      "identity:authenticate",
      "allowed",
      principal,
      context.correlationId,
      "authenticated",
      {
        type: "session",
        ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
      },
    );
    return { principal, sessionToken: token, expiresAt };
  }

  async function validateSession(correlationId: string, sessionToken: string): Promise<Principal> {
    if (!correlationId || !sessionToken) {
      throw new IdentityError("Session request is invalid", "invalid-request");
    }
    const policy = dependencies.loadPolicy();
    assertPolicy(policy);
    const session = await dependencies.sessions.findByTokenDigest(digestToken(sessionToken));
    const invalid = !policy.enabled
      || !session
      || Boolean(session.revokedAt)
      || now() >= new Date(session.expiresAt);
    if (invalid) {
      emit(
        "identity:validate-session",
        "denied",
        session?.principal ?? { type: "anonymous", subject: "anonymous" },
        correlationId,
        session?.revokedAt ? "session-revoked" : "session-invalid",
      );
      throw new IdentityError("Session is invalid", "session-invalid");
    }
    emit(
      "identity:validate-session",
      "allowed",
      session.principal,
      correlationId,
      "session-valid",
    );
    return session.principal;
  }

  async function revokeSession(
    context: TrustedActionContext,
    sessionToken: string,
  ): Promise<void> {
    if (!context.correlationId || !sessionToken) {
      throw new IdentityError("Revocation request is invalid", "invalid-request");
    }
    const revoked = await dependencies.sessions.revoke(
      digestToken(sessionToken),
      now().toISOString(),
    );
    emit(
      "identity:revoke-session",
      revoked ? "succeeded" : "failed",
      context.actor,
      context.correlationId,
      revoked ? "session-revoked" : "session-not-found",
    );
    if (!revoked) throw new IdentityError("Session is invalid", "session-invalid");
  }

  return Object.freeze({ authenticate, validateSession, revokeSession });
}
