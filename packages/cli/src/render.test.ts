import { describe, expect, it } from "vitest";
import {
  renderCatalog,
  renderCatalogItem,
  renderDiff,
  renderSolutionCheck,
  renderSolutionInstall,
  renderVerification,
} from "./render.js";

describe("catalog rendering", () => {
  it("renders capability layers and verified Solutions", () => {
    const output = renderCatalog({
      capabilities: [{
        kind: "capability",
        id: "wechat-miniprogram-auth",
        version: "0.1.0",
        title: "WeChat Mini Program Authentication",
        description: "Server-side code exchange.",
        layer: "platform-integration",
        dependencies: ["identity@^0.1.0", "audit@^0.1.0"],
        invariants: 9,
      }],
      solutions: [{
        kind: "solution",
        id: "vehicle-management",
        version: "0.1.0",
        title: "Vehicle Management",
        description: "Vehicle administration.",
        layer: "industry-solution",
        capabilities: ["audit@0.1.0", "vehicle-records@0.1.0"],
      }],
    });
    expect(output).toContain("platform-integration:");
    expect(output).toContain("9 invariants; requires identity@^0.1.0, audit@^0.1.0");
    expect(output).toContain("vehicle-management@0.1.0");
  });

  it("renders actionable capability details", () => {
    const output = renderCatalogItem({
      kind: "capability",
      id: "vehicle-records",
      version: "0.1.0",
      title: "Vehicle Records",
      description: "Vehicle lifecycle records.",
      layer: "business-capability",
      dependencies: ["authorization@^0.1.0"],
      invariants: 1,
      interfaces: ["vehicle-records.record"],
      dependencyDetails: [{ id: "authorization", version: "^0.1.0", optional: false }],
      invariantDetails: [{
        id: "updates-use-optimistic-concurrency",
        title: "Updates use optimistic concurrency",
        description: "Reject stale writes.",
        severity: "critical",
      }],
    });
    expect(output).toContain("Interfaces: vehicle-records.record");
    expect(output).toContain("authorization@^0.1.0");
    expect(output).toContain("[critical] updates-use-optimistic-concurrency");
  });
});

describe("renderVerification", () => {
  it("renders actionable issue context", () => {
    const output = renderVerification({
      ok: false,
      scope: "evidence-and-provenance",
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
    expect(output).toContain("Evidence and provenance verification failed.");
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

describe("renderSolutionCheck", () => {
  it("renders dependency order and constituent failures", () => {
    const output = renderSolutionCheck({
      ok: false,
      scope: "evidence-and-provenance",
      solution: { id: "vehicle-management", version: "0.1.0", title: "Vehicle Management" },
      projectRoot: "/project",
      installationOrder: ["audit", "vehicle-records"],
      missingCapabilities: ["vehicle-records"],
      capabilities: [{
        id: "vehicle-records",
        version: "0.1.0",
        purpose: "Manage vehicle records",
        installed: false,
        verified: false,
        issues: [{
          level: "error",
          code: "SOLUTION_CAPABILITY_NOT_INSTALLED",
          message: "Project does not install vehicle-records@0.1.0",
          capability: "vehicle-records",
        }],
      }],
    });
    expect(output).toContain("Solution evidence and provenance verification failed.");
    expect(output).toContain("audit -> vehicle-records");
    expect(output).toContain("Missing capabilities: vehicle-records");
    expect(output).toContain("FAIL vehicle-records@0.1.0");
  });
});

describe("renderSolutionInstall", () => {
  it("renders the current step and an actionable finalization command", () => {
    const output = renderSolutionInstall({
      status: "prepared",
      solution: { id: "vehicle-management", version: "0.1.0", title: "Vehicle Management" },
      projectRoot: "/project",
      packsDirectory: "/catalog/capabilities",
      solutionsDirectory: "/catalog/solutions",
      progress: { completed: 2, total: 8 },
      installationOrder: ["audit", "identity", "authorization"],
      currentCapability: { id: "authorization", version: "0.1.0", index: 3 },
      remainingCapabilities: ["authorization", "users"],
      planPath: ".aiba/plans/authorization.yaml",
    });
    expect(output).toContain("Progress: 2/8");
    expect(output).toContain("Prepared 3/8: authorization@0.1.0");
    expect(output).toContain(
      "aiba add vehicle-management --solution --root /project"
      + " --packs-dir /catalog/capabilities --solutions-dir /catalog/solutions --finalize",
    );
  });

  it("renders the next preparation command after one constituent is finalized", () => {
    const output = renderSolutionInstall({
      status: "finalized",
      solution: { id: "vehicle-management", version: "0.1.0", title: "Vehicle Management" },
      projectRoot: "/project",
      packsDirectory: "/catalog/capabilities",
      solutionsDirectory: "/catalog/solutions",
      progress: { completed: 1, total: 8 },
      installationOrder: ["audit", "identity"],
      currentCapability: { id: "audit", version: "0.1.0", index: 1 },
      remainingCapabilities: ["identity"],
      finalization: {
        capability: "audit",
        version: "0.1.0",
        receiptPath: ".aiba/receipts/audit.yaml",
        evidenceFiles: 2,
      },
    });
    expect(output).toContain("Installed 1/8: audit@0.1.0");
    expect(output).toContain(
      "Next: aiba add vehicle-management --solution --root /project"
      + " --packs-dir /catalog/capabilities --solutions-dir /catalog/solutions",
    );
  });

  it("quotes paths in generated commands", () => {
    const output = renderSolutionInstall({
      status: "awaiting-finalization",
      solution: { id: "vehicle-management", version: "0.1.0", title: "Vehicle Management" },
      projectRoot: "/project with space/team's app",
      packsDirectory: "/catalog/capabilities",
      solutionsDirectory: "/catalog/solutions",
      progress: { completed: 0, total: 1 },
      installationOrder: ["audit"],
      currentCapability: { id: "audit", version: "0.1.0", index: 1 },
      remainingCapabilities: ["audit"],
      planPath: ".aiba/plans/audit.yaml",
    });
    expect(output).toContain("--root '/project with space/team'\\''s app'");
  });
});
