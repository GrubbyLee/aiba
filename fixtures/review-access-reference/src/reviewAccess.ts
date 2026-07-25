import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export type ReviewerScope = "catalog:read" | "workflow:exercise";
export type ReviewDataMode = "isolated" | "sanitized";

export interface ReviewAccessConfig {
  enabled: boolean;
  releaseId: string;
  credentialDigest: string;
  expiresAt: string;
  allowedScopes: readonly ReviewerScope[];
  dataMode: ReviewDataMode;
  maximumAttempts: number;
  attemptWindowMs: number;
}

export interface ReviewAuditEvent {
  type: "authentication" | "authorization" | "revocation";
  outcome: "allowed" | "denied";
  clientId?: string;
  sessionId?: string;
  scope?: ReviewerScope;
  reason?: string;
  occurredAt: string;
}

export interface ReviewerSession {
  id: string;
  principal: {
    type: "reviewer";
    subject: string;
  };
  releaseId: string;
  scopes: readonly ReviewerScope[];
  dataMode: ReviewDataMode;
  expiresAt: string;
}

interface AttemptWindow {
  startedAt: number;
  attempts: number;
}

export interface ReviewAccessDependencies {
  config: Readonly<ReviewAccessConfig>;
  audit: (event: ReviewAuditEvent) => void;
  now?: () => Date;
}

export interface AuthenticateReviewerInput {
  clientId: string;
  releaseId: string;
  credential: string;
}

export class ReviewAccessError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "disabled"
      | "expired"
      | "invalid-credential"
      | "invalid-config"
      | "release-mismatch"
      | "rate-limited"
      | "revoked"
      | "scope-denied"
      | "session-not-found",
  ) {
    super(message);
    this.name = "ReviewAccessError";
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function credentialDigest(value: string): string {
  return digest(value).toString("hex");
}

export function createReviewAccessService(dependencies: ReviewAccessDependencies) {
  const config = Object.freeze({
    ...dependencies.config,
    allowedScopes: Object.freeze([...dependencies.config.allowedScopes]),
  });
  if (
    !config.releaseId
    || !/^[a-f0-9]{64}$/.test(config.credentialDigest)
    || Number.isNaN(Date.parse(config.expiresAt))
    || config.allowedScopes.length === 0
    || !Number.isSafeInteger(config.maximumAttempts)
    || config.maximumAttempts < 1
    || !Number.isSafeInteger(config.attemptWindowMs)
    || config.attemptWindowMs < 1
  ) {
    throw new ReviewAccessError("Review access configuration is invalid", "invalid-config");
  }
  const now = dependencies.now ?? (() => new Date());
  const sessions = new Map<string, ReviewerSession>();
  const revokedSessions = new Set<string>();
  const attempts = new Map<string, AttemptWindow>();

  function emit(event: Omit<ReviewAuditEvent, "occurredAt">): void {
    dependencies.audit({ ...event, occurredAt: now().toISOString() });
  }

  function deny(
    code: ReviewAccessError["code"],
    clientId: string,
    reason: string,
  ): never {
    emit({ type: "authentication", outcome: "denied", clientId, reason });
    throw new ReviewAccessError(reason, code);
  }

  function registerAttempt(clientId: string): void {
    const timestamp = now().getTime();
    const current = attempts.get(clientId);
    if (!current || timestamp - current.startedAt >= config.attemptWindowMs) {
      attempts.set(clientId, { startedAt: timestamp, attempts: 1 });
      return;
    }
    if (current.attempts >= config.maximumAttempts) {
      deny("rate-limited", clientId, "Review authentication is rate limited");
    }
    current.attempts += 1;
  }

  function authenticate(input: AuthenticateReviewerInput): ReviewerSession {
    registerAttempt(input.clientId);
    const timestamp = now();
    if (!config.enabled) deny("disabled", input.clientId, "Review access is disabled");
    if (timestamp >= new Date(config.expiresAt)) {
      deny("expired", input.clientId, "Review access has expired");
    }
    if (input.releaseId !== config.releaseId) {
      deny("release-mismatch", input.clientId, "Release is not approved for review");
    }

    const actual = digest(input.credential);
    const expected = Buffer.from(config.credentialDigest, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      deny("invalid-credential", input.clientId, "Review credential is invalid");
    }

    const id = randomUUID();
    const session: ReviewerSession = Object.freeze({
      id,
      principal: Object.freeze({ type: "reviewer", subject: `reviewer:${id}` }),
      releaseId: config.releaseId,
      scopes: Object.freeze([...config.allowedScopes]),
      dataMode: config.dataMode,
      expiresAt: config.expiresAt,
    });
    sessions.set(id, session);
    attempts.delete(input.clientId);
    emit({ type: "authentication", outcome: "allowed", clientId: input.clientId, sessionId: id });
    return session;
  }

  function authorize(sessionId: string, scope: ReviewerScope): ReviewerSession {
    const session = sessions.get(sessionId);
    if (!session) {
      emit({
        type: "authorization",
        outcome: "denied",
        sessionId,
        scope,
        reason: "session-not-found",
      });
      throw new ReviewAccessError("Reviewer session does not exist", "session-not-found");
    }
    if (revokedSessions.has(sessionId)) {
      emit({ type: "authorization", outcome: "denied", sessionId, scope, reason: "revoked" });
      throw new ReviewAccessError("Reviewer session is revoked", "revoked");
    }
    if (now() >= new Date(session.expiresAt)) {
      emit({ type: "authorization", outcome: "denied", sessionId, scope, reason: "expired" });
      throw new ReviewAccessError("Reviewer session has expired", "expired");
    }
    if (!session.scopes.includes(scope)) {
      emit({ type: "authorization", outcome: "denied", sessionId, scope, reason: "scope" });
      throw new ReviewAccessError("Reviewer scope is denied", "scope-denied");
    }
    emit({ type: "authorization", outcome: "allowed", sessionId, scope });
    return session;
  }

  function revoke(sessionId: string): void {
    const exists = sessions.has(sessionId);
    if (exists) revokedSessions.add(sessionId);
    emit({
      type: "revocation",
      outcome: exists ? "allowed" : "denied",
      sessionId,
      ...(!exists ? { reason: "session-not-found" } : {}),
    });
  }

  return Object.freeze({ authenticate, authorize, revoke });
}
