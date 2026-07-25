import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type ReviewScope = "catalog:read";

export interface ReviewAccessPolicy {
  enabled: boolean;
  releaseId: string;
  credentialDigest: string;
  expiresAt: string;
  sessionTtlMs: number;
  maximumAttempts: number;
  attemptWindowMs: number;
  allowedScopes: readonly ReviewScope[];
  dataMode: "isolated" | "sanitized";
}

export interface ReviewAuditEvent {
  action: "authenticate" | "authorize" | "revoke";
  outcome: "allowed" | "denied";
  occurredAt: string;
  principal?: string;
  reason?: string;
  actorKey?: string;
}

export interface ReviewCatalogItem {
  id: string;
  name: string;
  state: string;
}

export interface ReviewAccessDependencies {
  loadPolicy: () => Readonly<ReviewAccessPolicy>;
  loadReviewCatalog: () => readonly ReviewCatalogItem[];
  audit: (event: ReviewAuditEvent) => void;
  now?: () => Date;
}

export class ReviewAccessApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "disabled"
      | "expired"
      | "invalid-credential"
      | "invalid-policy"
      | "invalid-request"
      | "rate-limited"
      | "release-mismatch"
      | "revoked"
      | "session-not-found",
  ) {
    super(message);
    this.name = "ReviewAccessApiError";
  }
}

interface Session {
  token: string;
  principal: { type: "reviewer"; subject: string };
  releaseId: string;
  scopes: readonly ReviewScope[];
  dataMode: "isolated" | "sanitized";
  expiresAt: string;
}

interface AttemptWindow {
  startedAt: number;
  attempts: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function credentialDigest(value: string): string {
  return digest(value).toString("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validatePolicy(policy: Readonly<ReviewAccessPolicy>): void {
  if (
    !policy.releaseId
    || !/^[a-f0-9]{64}$/.test(policy.credentialDigest)
    || Number.isNaN(Date.parse(policy.expiresAt))
    || !Number.isSafeInteger(policy.sessionTtlMs)
    || policy.sessionTtlMs < 1
    || !Number.isSafeInteger(policy.maximumAttempts)
    || policy.maximumAttempts < 1
    || !Number.isSafeInteger(policy.attemptWindowMs)
    || policy.attemptWindowMs < 1
    || policy.allowedScopes.length !== 1
    || policy.allowedScopes[0] !== "catalog:read"
  ) {
    throw new ReviewAccessApiError("Review access policy is invalid", "invalid-policy");
  }
}

export function createReviewAccessApi(dependencies: ReviewAccessDependencies) {
  const now = dependencies.now || (() => new Date());
  const sessions = new Map<string, Session>();
  const revoked = new Set<string>();
  const attempts = new Map<string, AttemptWindow>();

  function emit(event: Omit<ReviewAuditEvent, "occurredAt">): void {
    dependencies.audit({ ...event, occurredAt: now().toISOString() });
  }

  function deny(
    action: ReviewAuditEvent["action"],
    code: ReviewAccessApiError["code"],
    message: string,
    details: Pick<ReviewAuditEvent, "actorKey" | "principal"> = {},
  ): never {
    emit({ action, outcome: "denied", reason: code, ...details });
    throw new ReviewAccessApiError(message, code);
  }

  function policy(): Readonly<ReviewAccessPolicy> {
    const current = dependencies.loadPolicy();
    validatePolicy(current);
    return current;
  }

  function registerAttempt(actorKey: string, current: ReviewAccessPolicy): void {
    const timestamp = now().getTime();
    const window = attempts.get(actorKey);
    if (!window || timestamp - window.startedAt >= current.attemptWindowMs) {
      attempts.set(actorKey, { startedAt: timestamp, attempts: 1 });
      return;
    }
    if (window.attempts >= current.maximumAttempts) {
      deny("authenticate", "rate-limited", "Review authentication is rate limited", {
        actorKey,
      });
    }
    window.attempts += 1;
  }

  function authenticate(context: { actorKey: string }, input: unknown) {
    if (!context.actorKey) {
      throw new ReviewAccessApiError("Trusted actor key is required", "invalid-request");
    }
    const current = policy();
    registerAttempt(context.actorKey, current);
    const body = record(input);
    if (
      !body
      || !hasExactKeys(body, ["credential", "releaseId"])
      || typeof body.credential !== "string"
      || typeof body.releaseId !== "string"
    ) {
      deny("authenticate", "invalid-request", "Review request is invalid", {
        actorKey: context.actorKey,
      });
    }

    const timestamp = now();
    if (!current.enabled) {
      deny("authenticate", "disabled", "Review access is disabled", {
        actorKey: context.actorKey,
      });
    }
    if (timestamp >= new Date(current.expiresAt)) {
      deny("authenticate", "expired", "Review access has expired", {
        actorKey: context.actorKey,
      });
    }
    if (body.releaseId !== current.releaseId) {
      deny("authenticate", "release-mismatch", "Release is not approved", {
        actorKey: context.actorKey,
      });
    }
    const supplied = digest(body.credential);
    const expected = Buffer.from(current.credentialDigest, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      deny("authenticate", "invalid-credential", "Review credential is invalid", {
        actorKey: context.actorKey,
      });
    }

    const token = randomBytes(32).toString("base64url");
    const principal = { type: "reviewer" as const, subject: `reviewer:${randomUUID()}` };
    const policyExpiry = new Date(current.expiresAt).getTime();
    const sessionExpiry = Math.min(policyExpiry, timestamp.getTime() + current.sessionTtlMs);
    const session: Session = Object.freeze({
      token,
      principal: Object.freeze(principal),
      releaseId: current.releaseId,
      scopes: Object.freeze([...current.allowedScopes]),
      dataMode: current.dataMode,
      expiresAt: new Date(sessionExpiry).toISOString(),
    });
    sessions.set(token, session);
    attempts.delete(context.actorKey);
    emit({
      action: "authenticate",
      outcome: "allowed",
      actorKey: context.actorKey,
      principal: principal.subject,
    });
    return {
      token,
      principal,
      expiresAt: session.expiresAt,
    };
  }

  function authorizeCatalog(input: unknown): Session {
    const body = record(input);
    if (!body || !hasExactKeys(body, ["sessionToken"]) || typeof body.sessionToken !== "string") {
      deny("authorize", "invalid-request", "Catalog request is invalid");
    }
    const session = sessions.get(body.sessionToken);
    if (!session) deny("authorize", "session-not-found", "Review session does not exist");
    if (revoked.has(session.token)) {
      deny("authorize", "revoked", "Review session is revoked", {
        principal: session.principal.subject,
      });
    }

    const current = policy();
    if (
      !current.enabled
      || current.releaseId !== session.releaseId
      || now() >= new Date(session.expiresAt)
      || now() >= new Date(current.expiresAt)
    ) {
      deny("authorize", "expired", "Review session is no longer active", {
        principal: session.principal.subject,
      });
    }
    if (!session.scopes.includes("catalog:read")) {
      deny("authorize", "invalid-policy", "Catalog scope is denied", {
        principal: session.principal.subject,
      });
    }
    emit({
      action: "authorize",
      outcome: "allowed",
      principal: session.principal.subject,
    });
    return session;
  }

  function getReviewCatalog(input: unknown) {
    const session = authorizeCatalog(input);
    return {
      dataMode: session.dataMode,
      items: dependencies.loadReviewCatalog().map((item) => ({ ...item })),
    };
  }

  function revokeSession(sessionToken: string, operatorId: string): void {
    const session = sessions.get(sessionToken);
    if (!session || !operatorId) {
      deny("revoke", "session-not-found", "Review session does not exist");
    }
    revoked.add(session.token);
    emit({
      action: "revoke",
      outcome: "allowed",
      principal: session.principal.subject,
      actorKey: operatorId,
    });
  }

  return Object.freeze({ authenticate, getReviewCatalog, revokeSession });
}
