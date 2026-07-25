import { describe, expect, it } from "vitest";
import {
  createReviewAccessApi,
  credentialDigest,
  ReviewAccessApiError,
  type ReviewAccessPolicy,
  type ReviewAuditEvent,
} from "./server/reviewAccessApi.js";

const credential = "temporary-review-code";

function createFixture(overrides: Partial<ReviewAccessPolicy> = {}) {
  let clock = new Date("2026-07-26T00:00:00Z");
  const events: ReviewAuditEvent[] = [];
  const policy: ReviewAccessPolicy = {
    enabled: true,
    releaseId: "wechat-review-build-42",
    credentialDigest: credentialDigest(credential),
    expiresAt: "2026-07-26T02:00:00Z",
    sessionTtlMs: 30 * 60 * 1000,
    maximumAttempts: 2,
    attemptWindowMs: 60_000,
    allowedScopes: ["catalog:read"],
    dataMode: "isolated",
    ...overrides,
  };
  const api = createReviewAccessApi({
    loadPolicy: () => policy,
    loadReviewCatalog: () => [
      { id: "review-1", name: "Review product", state: "ready" },
    ],
    audit: (event) => events.push(event),
    now: () => clock,
  });
  const authenticate = (input: unknown = {
    credential,
    releaseId: "wechat-review-build-42",
  }) => api.authenticate({ actorKey: "network:203.0.113.8" }, input);
  return {
    api,
    authenticate,
    events,
    policy,
    setClock: (value: string) => { clock = new Date(value); },
  };
}

describe("native WeChat review access boundary", () => {
  it("creates a distinct reviewer principal with a short-lived opaque session", () => {
    const fixture = createFixture();
    const session = fixture.authenticate();
    expect(session.principal).toEqual({
      type: "reviewer",
      subject: expect.stringMatching(/^reviewer:/),
    });
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.expiresAt).toBe("2026-07-26T00:30:00.000Z");
  });

  it("rejects client attempts to assert identity, scope, or data mode", () => {
    const fixture = createFixture();
    expect(() => fixture.authenticate({
      credential,
      releaseId: "wechat-review-build-42",
      principal: { type: "admin" },
      scopes: ["admin:write"],
      dataMode: "production",
      actorKey: "attacker-controlled",
    })).toThrowError(expect.objectContaining({ code: "invalid-request" }));
  });

  it("uses a server switch and approved release", () => {
    expect(() => createFixture({ enabled: false }).authenticate())
      .toThrowError(expect.objectContaining({ code: "disabled" }));
    const fixture = createFixture();
    expect(() => fixture.authenticate({
      credential,
      releaseId: "unapproved-build",
    })).toThrowError(expect.objectContaining({ code: "release-mismatch" }));
  });

  it("rate limits a trusted transport key even if request fields change", () => {
    const fixture = createFixture();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => fixture.authenticate({
        credential: `wrong-${attempt}`,
        releaseId: "wechat-review-build-42",
      })).toThrowError(ReviewAccessApiError);
    }
    expect(() => fixture.authenticate())
      .toThrowError(expect.objectContaining({ code: "rate-limited" }));
  });

  it("serves only the injected isolated review dataset", () => {
    const fixture = createFixture();
    const session = fixture.authenticate();
    expect(fixture.api.getReviewCatalog({ sessionToken: session.token })).toEqual({
      dataMode: "isolated",
      items: [{ id: "review-1", name: "Review product", state: "ready" }],
    });
    expect(() => fixture.api.getReviewCatalog({
      sessionToken: session.token,
      scope: "admin:write",
    })).toThrowError(expect.objectContaining({ code: "invalid-request" }));
  });

  it("re-evaluates expiry and server enablement during authorization", () => {
    const fixture = createFixture();
    const session = fixture.authenticate();
    fixture.setClock("2026-07-26T00:30:01Z");
    expect(() => fixture.api.getReviewCatalog({ sessionToken: session.token }))
      .toThrowError(expect.objectContaining({ code: "expired" }));

    const switched = createFixture();
    const switchedSession = switched.authenticate();
    switched.policy.enabled = false;
    expect(() => switched.api.getReviewCatalog({ sessionToken: switchedSession.token }))
      .toThrowError(expect.objectContaining({ code: "expired" }));
  });

  it("revokes sessions immediately", () => {
    const fixture = createFixture();
    const session = fixture.authenticate();
    fixture.api.revokeSession(session.token, "operator:release-manager");
    expect(() => fixture.api.getReviewCatalog({ sessionToken: session.token }))
      .toThrowError(expect.objectContaining({ code: "revoked" }));
  });

  it("audits allowed and denied boundary actions without raw credentials", () => {
    const fixture = createFixture();
    expect(() => fixture.authenticate({
      credential: "wrong",
      releaseId: "wechat-review-build-42",
    })).toThrowError(ReviewAccessApiError);
    const session = fixture.authenticate();
    fixture.api.getReviewCatalog({ sessionToken: session.token });
    fixture.api.revokeSession(session.token, "operator:release-manager");

    expect(fixture.events.map((event) => `${event.action}:${event.outcome}`)).toEqual([
      "authenticate:denied",
      "authenticate:allowed",
      "authorize:allowed",
      "revoke:allowed",
    ]);
    expect(JSON.stringify(fixture.events)).not.toContain(credential);
    expect(JSON.stringify(fixture.events)).not.toContain(session.token);
  });
});
