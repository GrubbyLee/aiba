import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReviewAccessApi,
  credentialDigest,
  type ReviewAccessPolicy,
} from "./server/reviewAccessApi.js";
import { createReviewAccessHttpHandler } from "./server/httpAdapter.js";

const credential = "temporary-review-code";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

async function createFixture(overrides: Partial<ReviewAccessPolicy> = {}) {
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
    audit: () => undefined,
    now: () => new Date("2026-07-26T00:00:00Z"),
  });
  const server = createServer(createReviewAccessHttpHandler(api, {
    resolveActorKey: () => "network:test-runner",
  }));
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { policy, post };
}

async function authenticate(post: Awaited<ReturnType<typeof createFixture>>["post"]) {
  return post("/review/session", {
    credential,
    releaseId: "wechat-review-build-42",
  });
}

describe("review access HTTP boundary", () => {
  it("authenticates a reviewer and serves only isolated review data", async () => {
    const { post } = await createFixture();
    const authentication = await authenticate(post);
    expect(authentication.status).toBe(201);
    expect(authentication.headers.get("cache-control")).toBe("no-store");
    const session = await authentication.json() as {
      token: string;
      principal: { type: string; subject: string };
    };
    expect(session.principal).toEqual({
      type: "reviewer",
      subject: expect.stringMatching(/^reviewer:/),
    });

    const catalog = await post("/review/catalog", { sessionToken: session.token });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toEqual({
      dataMode: "isolated",
      items: [{ id: "review-1", name: "Review product", state: "ready" }],
    });
  });

  it("rejects authorization fields injected through the HTTP body", async () => {
    const { post } = await createFixture();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await post("/review/session", {
        credential,
        releaseId: "wechat-review-build-42",
        role: "admin",
        scope: "admin:write",
        dataMode: "production",
        actorKey: `network:rotated-by-attacker-${attempt}`,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "review-access-denied" });
    }
    const limited = await authenticate(post);
    expect(limited.status).toBe(429);
  });

  it("rate limits by trusted transport context and hides denial details", async () => {
    const { post } = await createFixture();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await post("/review/session", {
        credential: `wrong-${attempt}`,
        releaseId: "wechat-review-build-42",
      });
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain(`wrong-${attempt}`);
    }
    const limited = await authenticate(post);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "review-access-denied" });
  });

  it("invalidates an existing session when the server switch closes", async () => {
    const { policy, post } = await createFixture();
    const authentication = await authenticate(post);
    const session = await authentication.json() as { token: string };
    policy.enabled = false;

    const response = await post("/review/catalog", { sessionToken: session.token });
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).not.toContain(session.token);
    expect(JSON.parse(text)).toEqual({ error: "review-access-denied" });
  });

  it("rejects oversized and malformed request bodies", async () => {
    const { post } = await createFixture();
    const oversized = await post("/review/session", {
      credential: "x".repeat(5000),
      releaseId: "wechat-review-build-42",
    });
    expect(oversized.status).toBe(400);
  });
});
