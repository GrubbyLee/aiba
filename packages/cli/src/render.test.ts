import { describe, expect, it } from "vitest";
import { renderVerification } from "./render.js";

describe("renderVerification", () => {
  it("renders actionable issue context", () => {
    const output = renderVerification({
      ok: false,
      projectRoot: "/project",
      verifiedCapabilities: [],
      issues: [{
        level: "error",
        code: "EVIDENCE_HASH_MISMATCH",
        message: "Evidence changed",
        capability: "review-access",
        invariant: "access-expires",
        path: "src/review.ts",
      }],
    });
    expect(output).toContain("Verification failed.");
    expect(output).toContain("review-access / access-expires / src/review.ts");
  });
});
