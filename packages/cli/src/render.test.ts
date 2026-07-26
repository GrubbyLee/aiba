import { describe, expect, it } from "vitest";
import { renderDiff, renderVerification } from "./render.js";

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

describe("renderDiff", () => {
  it("renders ownership and drift classes", () => {
    const output = renderDiff({
      ok: true,
      hasDrift: true,
      projectRoot: "/project",
      issues: [],
      capabilities: [{
        id: "review-access",
        version: "0.1.0",
        ancestry: "recorded",
        sources: { capability: "locked", recipe: "changed" },
        files: [{
          path: "src/review.ts",
          status: "customized",
          ownership: "shared",
          installedSha256: "a".repeat(64),
          actualSha256: "b".repeat(64),
          evidenceTypes: ["source"],
          invariants: ["reviewer-is-distinct-principal"],
          operations: ["implement-review-access"],
        }],
      }],
    });
    expect(output).toContain("Capability drift detected.");
    expect(output).toContain("CUSTOMIZED [shared] src/review.ts");
    expect(output).toContain("recipe=changed");
  });
});
