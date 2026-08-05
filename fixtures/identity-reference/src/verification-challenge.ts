import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  VerificationChallengeIssueCommand,
  VerificationChallengeRecord,
  VerificationChallengeVerifyCommand,
} from "aiba-spec";

export interface VerificationContext {
  tenantId: string;
  actorKey: string;
  correlationId: string;
}

interface StoredChallenge extends VerificationChallengeRecord {
  recipientId: string;
  responseDigest: string;
  failedAttempts: number;
}

export interface VerificationChallengeDependencies {
  resolveDestination: (
    tenantId: string,
    recipientId: string,
    channel: VerificationChallengeIssueCommand["channel"],
  ) => Promise<string | undefined>;
  deliver: (input: { destination: string; channel: string; response: string; purpose: string }) => Promise<void>;
  consumeRateLimit: (scope: string) => Promise<boolean>;
  audit: (event: { action: string; outcome: string; reasonCode?: string; correlationId: string }) => void;
  now: () => Date;
  challengeId: () => string;
  generateResponse: () => string;
  pepper: string;
  ttlMs?: number;
  maximumAttempts?: number;
}

function fingerprint(command: VerificationChallengeIssueCommand): string {
  return JSON.stringify(command);
}

function publicRecord(record: StoredChallenge): VerificationChallengeRecord {
  const { recipientId: _recipientId, responseDigest: _responseDigest, failedAttempts: _failed, ...safe } = record;
  return safe;
}

export function createVerificationChallengeService(dependencies: VerificationChallengeDependencies) {
  if (Buffer.byteLength(dependencies.pepper) < 32) throw new Error("verification pepper is too short");
  const ttlMs = dependencies.ttlMs ?? 5 * 60_000;
  const maximumAttempts = dependencies.maximumAttempts ?? 5;
  const challenges = new Map<string, StoredChallenge>();
  const idempotency = new Map<string, { fingerprint: string; challengeId: string }>();

  const digest = (challengeId: string, response: string) => createHmac("sha256", dependencies.pepper)
    .update(`${challengeId}\0${response}`)
    .digest();

  async function issue(
    context: VerificationContext,
    command: VerificationChallengeIssueCommand,
  ): Promise<VerificationChallengeRecord> {
    const key = `${context.tenantId}:${command.purpose}:${command.idempotencyKey}`;
    const prior = idempotency.get(key);
    const commandFingerprint = fingerprint(command);
    if (prior) {
      if (prior.fingerprint !== commandFingerprint) throw new Error("idempotency-conflict");
      return publicRecord(challenges.get(prior.challengeId)!);
    }
    if (!await dependencies.consumeRateLimit(`${context.tenantId}:${context.actorKey}`)) {
      dependencies.audit({ action: "verification-challenge:issue", outcome: "denied", reasonCode: "rate-limited", correlationId: context.correlationId });
      throw new Error("challenge-unavailable");
    }
    const challengeId = dependencies.challengeId();
    const response = dependencies.generateResponse();
    const now = dependencies.now();
    const destination = await dependencies.resolveDestination(context.tenantId, command.recipientId, command.channel);
    const record: StoredChallenge = {
      challengeId,
      channel: command.channel,
      purpose: command.purpose,
      status: "pending",
      attemptsRemaining: maximumAttempts,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      recipientId: command.recipientId,
      responseDigest: digest(challengeId, response).toString("hex"),
      failedAttempts: 0,
    };
    challenges.set(challengeId, record);
    idempotency.set(key, { fingerprint: commandFingerprint, challengeId });
    if (destination) await dependencies.deliver({ destination, channel: command.channel, response, purpose: command.purpose });
    dependencies.audit({ action: "verification-challenge:issue", outcome: "succeeded", correlationId: context.correlationId });
    return publicRecord(record);
  }

  async function verify(
    context: VerificationContext,
    command: VerificationChallengeVerifyCommand,
  ): Promise<VerificationChallengeRecord> {
    const record = challenges.get(command.challengeId);
    const now = dependencies.now();
    if (!record || record.status !== "pending") throw new Error("verification-failed");
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      record.status = "expired";
      record.attemptsRemaining = 0;
      throw new Error("verification-failed");
    }
    const actual = digest(record.challengeId, command.response);
    const expected = Buffer.from(record.responseDigest, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      record.failedAttempts += 1;
      record.attemptsRemaining = Math.max(0, maximumAttempts - record.failedAttempts);
      if (record.attemptsRemaining === 0) record.status = "locked";
      dependencies.audit({ action: "verification-challenge:verify", outcome: "denied", reasonCode: "invalid-response", correlationId: context.correlationId });
      throw new Error("verification-failed");
    }
    record.status = "verified";
    record.attemptsRemaining = 0;
    record.verifiedAt = now.toISOString();
    dependencies.audit({ action: "verification-challenge:verify", outcome: "succeeded", correlationId: context.correlationId });
    return publicRecord(record);
  }

  return { issue, verify };
}
