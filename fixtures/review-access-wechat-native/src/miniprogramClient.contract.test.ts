import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("native Mini Program client contract", () => {
  it("submits no client-selected reviewer identity or authorization fields", async () => {
    const source = await readFile(
      join(process.cwd(), "miniprogram", "services", "review-api.js"),
      "utf8",
    );
    let requestData: unknown;
    const module = { exports: {} as Record<string, (value: string) => Promise<unknown>> };
    runInNewContext(source, {
      Error,
      Promise,
      getApp: () => ({
        globalData: {
          apiBaseUrl: "https://review-api.example.invalid",
          releaseId: "wechat-review-build-42",
        },
      }),
      module,
      wx: {
        request: (options: {
          data: unknown;
          success: (response: { statusCode: number; data: unknown }) => void;
        }) => {
          requestData = options.data;
          options.success({
            statusCode: 200,
            data: {
              token: "opaque-session-token",
              principal: { type: "reviewer", subject: "reviewer:test" },
            },
          });
        },
      },
    });

    await module.exports.authenticateReview?.("temporary-code");
    expect(requestData).toEqual({
      credential: "temporary-code",
      releaseId: "wechat-review-build-42",
    });
  });
});
