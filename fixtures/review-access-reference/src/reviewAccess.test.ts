import { describe, expect, it } from "vitest";
import {
  createReviewAccessService,
  credentialDigest,
  ReviewAccessError,
  type ReviewAccessConfig,
  type ReviewAuditEvent,
} from "./reviewAccess.js";

const credential = "temporary-review-code";

function createFixture(overrides: Partial<ReviewAccessConfig> = {}) {
  let clock = new Date("2026-07-26T00:00:00Z");
  const events: ReviewAuditEvent[] = [];
  const config: ReviewAccessConfig = {
    enabled: true,
    releaseId: "wechat-release-42",
    credentialDigest: credentialDigest(credential),
    expiresAt: "2026-07-27T00:00:00Z",
    allowedScopes: ["catalog:read"],
    dataMode: "sanitized",
    maximumAttempts: 2,
    attemptWindowMs: 60_000,
    ...overrides,
  };
  const service = createReviewAccessService({
    config,
    audit: (event) => events.push(event),
    now: () => clock,
  });
  return {
    events,
    service,
    setClock: (value: string) => { clock = new Date(value); },
  };
}

function authenticate(fixture: ReturnType<typeof createFixture>) {
  return fixture.service.authenticate({
    clientId: "review-device",
    releaseId: "wechat-release-42",
    credential,
  });
}

describe("review access reference", () => {
  it("rejects unsafe server configuration", () => {
    expect(() => createFixture({ expiresAt: "not-a-date" }))
      .toThrowError(expect.objectContaining({ code: "invalid-config" }));
    expect(() => createFixture({ credentialDigest: "not-a-digest" }))
      .toThrowError(expect.objectContaining({ code: "invalid-config" }));
  });

  it("uses a distinct reviewer principal and server-defined sanitized scope", () => {
    const fixture = createFixture();
    const session = authenticate(fixture);
    expect(session.principal.type).toBe("reviewer");
    expect(session.principal.subject).toMatch(/^reviewer:/);
    expect(session.scopes).toEqual(["catalog:read"]);
    expect(session.dataMode).toBe("sanitized");
  });

  it("uses server enablement and release binding", () => {
    const disabled = createFixture({ enabled: false });
    expect(() => authenticate(disabled)).toThrowError(
      expect.objectContaining({ code: "disabled" }),
    );
    const fixture = createFixture();
    expect(() => fixture.service.authenticate({
      clientId: "review-device",
      releaseId: "unapproved-release",
      credential,
    })).toThrowError(expect.objectContaining({ code: "release-mismatch" }));
  });

  it("expires and revokes sessions", () => {
    const fixture = createFixture();
    const expired = authenticate(fixture);
    fixture.setClock("2026-07-27T00:00:01Z");
    expect(() => fixture.service.authorize(expired.id, "catalog:read"))
      .toThrowError(expect.objectContaining({ code: "expired" }));

    const activeFixture = createFixture();
    const revoked = authenticate(activeFixture);
    activeFixture.service.revoke(revoked.id);
    expect(() => activeFixture.service.authorize(revoked.id, "catalog:read"))
      .toThrowError(expect.objectContaining({ code: "revoked" }));
  });

  it("enforces least privilege", () => {
    const fixture = createFixture();
    const session = authenticate(fixture);
    expect(() => fixture.service.authorize(session.id, "workflow:exercise"))
      .toThrowError(expect.objectContaining({ code: "scope-denied" }));
  });

  it("rate limits failed attempts", () => {
    const fixture = createFixture();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => fixture.service.authenticate({
        clientId: "attacker",
        releaseId: "wechat-release-42",
        credential: "wrong",
      })).toThrowError(ReviewAccessError);
    }
    expect(() => fixture.service.authenticate({
      clientId: "attacker",
      releaseId: "wechat-release-42",
      credential,
    })).toThrowError(expect.objectContaining({ code: "rate-limited" }));
  });

  it("audits authentication, authorization, denial, and revocation", () => {
    const fixture = createFixture();
    const session = authenticate(fixture);
    fixture.service.authorize(session.id, "catalog:read");
    fixture.service.revoke(session.id);
    expect(fixture.events.map((event) => `${event.type}:${event.outcome}`)).toEqual([
      "authentication:allowed",
      "authorization:allowed",
      "revocation:allowed",
    ]);

    expect(() => fixture.service.authenticate({
      clientId: "invalid-client",
      releaseId: "wechat-release-42",
      credential: "wrong",
    })).toThrowError(ReviewAccessError);
    expect(fixture.events.at(-1)).toEqual(expect.objectContaining({
      type: "authentication",
      outcome: "denied",
    }));

    expect(() => fixture.service.authorize("missing-session", "catalog:read"))
      .toThrowError(expect.objectContaining({ code: "session-not-found" }));
    fixture.service.revoke("missing-session");
    expect(fixture.events.slice(-2)).toEqual([
      expect.objectContaining({ type: "authorization", outcome: "denied" }),
      expect.objectContaining({ type: "revocation", outcome: "denied" }),
    ]);
  });
});
