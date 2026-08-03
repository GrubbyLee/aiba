import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("native Mini Program vehicle surface", () => {
  it("exchanges only wx.login code and reads vehicles without tenant claims", async () => {
    const authSource = await readFile(
      join(process.cwd(), "miniprogram", "services", "wechat-auth.js"),
      "utf8",
    );
    const authModule = { exports: {} as Record<string, (...args: never[]) => unknown> };
    const requests: Array<Record<string, unknown>> = [];
    runInNewContext(authSource, {
      Error,
      Object,
      Promise,
      getApp: () => ({ globalData: { apiBaseUrl: "https://api.example.invalid" } }),
      module: authModule,
      wx: {
        login: (options: { success: (result: { code: string }) => void }) => {
          options.success({ code: "wechat_one_time_code_001" });
        },
        request: (options: Record<string, unknown> & {
          success: (response: { statusCode: number; data: unknown }) => void;
        }) => {
          requests.push(options);
          options.success({
            statusCode: 201,
            data: {
              token: "application-session-token-001",
              principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
              issuedAt: "2026-08-04T00:00:00Z",
            },
          });
        },
      },
    });
    const authenticate = authModule.exports.authenticate as () => Promise<unknown>;
    await authenticate();
    expect(requests[0]?.data).toEqual({ code: "wechat_one_time_code_001" });
    expect(JSON.stringify(requests[0]?.data)).not.toContain("tenantId");
    expect(JSON.stringify(requests[0]?.data)).not.toContain("openId");

    const vehicleSource = await readFile(
      join(process.cwd(), "miniprogram", "services", "vehicle-api.js"),
      "utf8",
    );
    const vehicleModule = { exports: {} as Record<string, (...args: never[]) => unknown> };
    let vehicleRequest: Record<string, unknown> | undefined;
    runInNewContext(vehicleSource, {
      Error,
      Promise,
      String,
      encodeURIComponent,
      getApp: () => ({ globalData: { apiBaseUrl: "https://api.example.invalid" } }),
      module: vehicleModule,
      require: () => authModule.exports,
      wx: {
        request: (options: Record<string, unknown> & {
          success: (response: { statusCode: number; data: unknown }) => void;
        }) => {
          vehicleRequest = options;
          options.success({ statusCode: 200, data: { items: [] } });
        },
      },
    });
    const listVehicles = vehicleModule.exports.listVehicles as (limit: number) => Promise<unknown>;
    await listVehicles(50);
    expect(vehicleRequest).toMatchObject({
      url: "https://api.example.invalid/api/vehicles?limit=50",
      method: "GET",
      header: {
        accept: "application/json",
        "x-aiba-session": "application-session-token-001",
      },
    });
    expect(vehicleRequest).not.toHaveProperty("data");
    expect(JSON.stringify(vehicleRequest)).not.toContain("tenantId");
    expect(JSON.stringify(vehicleRequest)).not.toContain("role");
  });

  it("keeps every declared native page complete", async () => {
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      const source = await readFile(
        join(process.cwd(), "miniprogram", "pages", "vehicles", `index.${extension}`),
        "utf8",
      );
      expect(source.length).toBeGreaterThan(20);
    }
  });
});
