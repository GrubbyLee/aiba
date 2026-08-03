import { describe, expect, it } from "vitest";
import type { Principal } from "aiba-spec";
import {
  createWechatMiniProgramAuthService,
  type WechatProviderIdentity,
} from "./wechat-miniprogram-auth.js";

function createFixture(options: {
  providerIdentity?: WechatProviderIdentity;
  providerFailure?: boolean;
  boundPrincipal?: Principal;
  auditFailure?: boolean;
} = {}) {
  const consumed = new Set<string>();
  const providerCodes: string[] = [];
  const binderInputs: unknown[] = [];
  const auditEvents: unknown[] = [];
  let committed = false;
  const service = createWechatMiniProgramAuthService({
    replay: {
      consume: async (digest) => {
        if (consumed.has(digest)) return false;
        consumed.add(digest);
        return true;
      },
    },
    provider: {
      exchange: async (code) => {
        providerCodes.push(code);
        if (options.providerFailure) throw new Error("provider timeout with app secret");
        return options.providerIdentity ?? {
          openId: "openid-user-42",
          unionId: "unionid-user-42",
          sessionKey: "provider-session-key-0001",
        };
      },
    },
    binder: {
      bind: async (input, recordAudit) => {
        binderInputs.push(structuredClone(input));
        const principal = options.boundPrincipal ?? {
          type: "user" as const,
          subject: "user-42",
          tenantId: "tenant-a",
        };
        await recordAudit(principal);
        committed = true;
        return principal;
      },
    },
    audit: {
      record: async (event) => {
        if (options.auditFailure) throw new Error("audit unavailable");
        auditEvents.push(structuredClone(event));
      },
    },
    now: () => new Date("2026-08-04T00:00:00Z"),
  });
  return {
    auditEvents,
    binderInputs,
    committed: () => committed,
    context: { tenantId: "tenant-a", correlationId: "wechat-login-request-001" },
    providerCodes,
    service,
  };
}

describe("WeChat Mini Program authentication reference boundary", () => {
  it("binds provider identity and returns only a portable principal", async () => {
    const fixture = createFixture();
    const result = await fixture.service.authenticate(fixture.context, {
      code: "one_time_code_0001",
    });
    expect(result).toEqual({
      principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      issuedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(fixture.providerCodes).toEqual(["one_time_code_0001"]);
    expect(fixture.committed()).toBe(true);
    expect(JSON.stringify(result)).not.toContain("session");
    expect(JSON.stringify(fixture.auditEvents)).not.toContain("openid");
    expect(JSON.stringify(fixture.auditEvents)).not.toContain("session-key");
  });

  it("rejects client-selected provider, tenant, and principal fields before exchange", async () => {
    const fixture = createFixture();
    await expect(fixture.service.authenticate(fixture.context, {
      code: "one_time_code_0001",
      appId: "attacker-app",
      endpoint: "https://attacker.example",
      tenantId: "tenant-b",
      openId: "attacker",
      role: "admin",
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(fixture.providerCodes).toEqual([]);
  });

  it("rejects code replay without a second provider exchange", async () => {
    const fixture = createFixture();
    await fixture.service.authenticate(fixture.context, { code: "one_time_code_0001" });
    await expect(fixture.service.authenticate(fixture.context, { code: "one_time_code_0001" }))
      .rejects.toMatchObject({ code: "replayed-code" });
    expect(fixture.providerCodes).toEqual(["one_time_code_0001"]);
  });

  it("fails closed on provider error and malformed provider identity", async () => {
    const failed = createFixture({ providerFailure: true });
    await expect(failed.service.authenticate(failed.context, { code: "one_time_code_0001" }))
      .rejects.toMatchObject({ code: "authentication-failed" });
    expect(failed.binderInputs).toEqual([]);
    expect(JSON.stringify(failed.auditEvents)).not.toContain("app secret");

    const malformed = createFixture({
      providerIdentity: { openId: "", sessionKey: "short" },
    });
    await expect(malformed.service.authenticate(
      malformed.context,
      { code: "one_time_code_0001" },
    )).rejects.toMatchObject({ code: "authentication-failed" });
    expect(malformed.binderInputs).toEqual([]);
  });

  it("rejects a binder that changes tenant or principal type", async () => {
    const fixture = createFixture({
      boundPrincipal: { type: "reviewer", subject: "reviewer-1", tenantId: "tenant-b" },
    });
    await expect(fixture.service.authenticate(fixture.context, { code: "one_time_code_0001" }))
      .rejects.toMatchObject({ code: "authentication-failed" });
    expect(fixture.committed()).toBe(false);
  });

  it("does not commit identity state when success audit fails", async () => {
    const fixture = createFixture({ auditFailure: true });
    await expect(fixture.service.authenticate(fixture.context, { code: "one_time_code_0001" }))
      .rejects.toMatchObject({ code: "authentication-failed" });
    expect(fixture.committed()).toBe(false);
  });
});
