import { describe, expect, it } from "vitest";
import { createVerificationChallengeService } from "./verification-challenge.js";

function fixture(options: { known?: boolean; allowed?: boolean; now?: Date; maximumAttempts?: number } = {}) {
  const deliveries: unknown[] = [];
  const audits: unknown[] = [];
  let now = options.now ?? new Date("2026-08-05T00:00:00Z");
  const service = createVerificationChallengeService({
    resolveDestination: async () => options.known === false ? undefined : "member@example.com",
    deliver: async (input) => { deliveries.push(input); },
    consumeRateLimit: async () => options.allowed !== false,
    audit: (event) => audits.push(event),
    now: () => now,
    challengeId: () => "challenge_0001",
    generateResponse: () => "123456",
    pepper: "0123456789abcdef0123456789abcdef",
    ...(options.maximumAttempts === undefined ? {} : { maximumAttempts: options.maximumAttempts }),
  });
  const context = { tenantId: "tenant-a", actorKey: "network:trusted-digest", correlationId: "request-1" };
  const command = { recipientId: "user-1", channel: "email" as const, purpose: "identity:login", idempotencyKey: "issue-0001" };
  return { service, context, command, deliveries, audits, advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
}

describe("verification challenge reference boundary", () => {
  it("issues and consumes a challenge exactly once without exposing secrets", async () => {
    const f = fixture();
    const issued = await f.service.issue(f.context, f.command);
    expect(issued).toMatchObject({ status: "pending", attemptsRemaining: 5 });
    expect(issued).not.toHaveProperty("response");
    expect(issued).not.toHaveProperty("recipientId");
    expect(f.deliveries).toHaveLength(1);
    const verified = await f.service.verify(f.context, { challengeId: issued.challengeId, response: "123456" });
    expect(verified.status).toBe("verified");
    await expect(f.service.verify(f.context, { challengeId: issued.challengeId, response: "123456" }))
      .rejects.toThrow("verification-failed");
  });

  it("locks after bounded failures and uses one public error", async () => {
    const f = fixture({ maximumAttempts: 2 });
    const issued = await f.service.issue(f.context, f.command);
    await expect(f.service.verify(f.context, { challengeId: issued.challengeId, response: "000000" }))
      .rejects.toThrow("verification-failed");
    await expect(f.service.verify(f.context, { challengeId: issued.challengeId, response: "111111" }))
      .rejects.toThrow("verification-failed");
    await expect(f.service.verify(f.context, { challengeId: "unknown_0001", response: "123456" }))
      .rejects.toThrow("verification-failed");
  });

  it("expires challenges and rejects rate-limited issuance", async () => {
    const f = fixture();
    const issued = await f.service.issue(f.context, f.command);
    f.advance(5 * 60_000);
    await expect(f.service.verify(f.context, { challengeId: issued.challengeId, response: "123456" }))
      .rejects.toThrow("verification-failed");
    const limited = fixture({ allowed: false });
    await expect(limited.service.issue(limited.context, limited.command)).rejects.toThrow("challenge-unavailable");
  });

  it("does not reveal unknown recipients and keeps issuance idempotent", async () => {
    const f = fixture({ known: false });
    const first = await f.service.issue(f.context, f.command);
    const second = await f.service.issue(f.context, f.command);
    expect(first).toEqual(second);
    expect(f.deliveries).toHaveLength(0);
    await expect(f.service.issue(f.context, { ...f.command, recipientId: "other-user" }))
      .rejects.toThrow("idempotency-conflict");
  });

  it("keeps responses, destinations, and recipient identifiers out of audit", async () => {
    const f = fixture();
    const issued = await f.service.issue(f.context, f.command);
    await expect(f.service.verify(f.context, { challengeId: issued.challengeId, response: "000000" }))
      .rejects.toThrow("verification-failed");
    const serialized = JSON.stringify(f.audits);
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("000000");
    expect(serialized).not.toContain("member@example.com");
    expect(serialized).not.toContain("user-1");
  });
});
