import { describe, expect, it } from "vitest";
import {
  renderApplicationPlan,
  renderApplicationBlueprintDiff,
  renderCatalog,
  renderCatalogItem,
  renderDiff,
  renderSolutionCheck,
  renderSolutionInstall,
  renderVerification,
} from "./render.js";

describe("Application Blueprint diff rendering", () => {
  it("renders stable change classifications and resolution counts", () => {
    const output = renderApplicationBlueprintDiff({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "ApplicationBlueprintUpgradePlan",
      metadata: {
        id: "work-hub-upgrade",
        blueprintId: "work-hub",
        from: { version: "0.1.0", sha256: "a".repeat(64), planSha256: "b".repeat(64) },
        to: { version: "0.2.0", sha256: "c".repeat(64), planSha256: "d".repeat(64) },
      },
      changes: [{
        id: "change-001",
        category: "security-sensitive",
        targetType: "operation",
        target: "publish",
        summary: "Change authorization action",
        requiresResolution: true,
      }],
      preservedCustomizations: [],
      requiredResolutions: ["change-001"],
    });
    expect(output).toContain("[security-sensitive] operation publish (resolution required)");
    expect(output).toContain("Required resolutions: 1");
  });
});

describe("Application Plan rendering", () => {
  it("renders capability and non-executable task order", () => {
    const output = renderApplicationPlan({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "ApplicationPlan",
      metadata: {
        id: "work-hub-plan",
        blueprint: { id: "work-hub", version: "0.1.0", sha256: "a".repeat(64) },
      },
      capabilities: [{
        id: "authorization",
        version: "0.1.0",
        manifestSha256: "b".repeat(64),
        dependencies: [],
        reasons: ["Operations declare authorization intent"],
        inferred: true,
      }],
      tasks: [{
        id: "adapt-authorization",
        kind: "capability-adaptation",
        title: "Adapt Authorization",
        target: "authorization",
        dependsOn: [],
        writeScopes: ["src/**"],
        requiredCapabilities: ["authorization@0.1.0"],
        intents: ["Operations declare authorization intent"],
        invariants: [],
        evidence: [],
      }],
    });
    expect(output).toContain("Application: work-hub@0.1.0");
    expect(output).toContain("Capabilities: authorization@0.1.0");
    expect(output).toContain("adapt-authorization [capability-adaptation]");
    expect(output).toContain("write scope: src/**");
  });
});

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
        id: "secure-workspace",
        version: "0.1.0",
        title: "Secure Workspace",
        description: "Secure application workspace.",
        layer: "application-solution",
        capabilities: ["audit@0.1.0", "authorization@0.1.0"],
      }],
    });
    expect(output).toContain("platform-integration:");
    expect(output).toContain("9 invariants; requires identity@^0.1.0, audit@^0.1.0");
    expect(output).toContain("secure-workspace@0.1.0");
  });

  it("renders actionable capability details", () => {
    const output = renderCatalogItem({
      kind: "capability",
      id: "import-export",
      version: "0.1.0",
      title: "Import And Export",
      description: "Bounded data exchange.",
      layer: "business-capability",
      dependencies: ["authorization@^0.1.0"],
      invariants: 1,
      interfaces: ["import-export.job-record"],
      dependencyDetails: [{ id: "authorization", version: "^0.1.0", optional: false }],
      invariantDetails: [{
        id: "profiles-are-server-owned",
        title: "Profiles are server owned",
        description: "Reject caller-selected execution profiles.",
        severity: "critical",
      }],
    });
    expect(output).toContain("Interfaces: import-export.job-record");
    expect(output).toContain("authorization@^0.1.0");
    expect(output).toContain("[critical] profiles-are-server-owned");
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
      solution: { id: "secure-workspace", version: "0.1.0", title: "Secure Workspace" },
      projectRoot: "/project",
      installationOrder: ["audit", "authorization"],
      missingCapabilities: ["authorization"],
      capabilities: [{
        id: "authorization",
        version: "0.1.0",
        purpose: "Enforce access decisions",
        installed: false,
        verified: false,
        issues: [{
          level: "error",
          code: "SOLUTION_CAPABILITY_NOT_INSTALLED",
          message: "Project does not install authorization@0.1.0",
          capability: "authorization",
        }],
      }],
    });
    expect(output).toContain("Solution evidence and provenance verification failed.");
    expect(output).toContain("audit -> authorization");
    expect(output).toContain("Missing capabilities: authorization");
    expect(output).toContain("FAIL authorization@0.1.0");
  });
});

describe("renderSolutionInstall", () => {
  it("renders the current step and an actionable finalization command", () => {
    const output = renderSolutionInstall({
      status: "prepared",
      solution: { id: "secure-workspace", version: "0.1.0", title: "Secure Workspace" },
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
      "aiba add secure-workspace --solution --root /project"
      + " --packs-dir /catalog/capabilities --solutions-dir /catalog/solutions --finalize",
    );
  });

  it("renders the next preparation command after one constituent is finalized", () => {
    const output = renderSolutionInstall({
      status: "finalized",
      solution: { id: "secure-workspace", version: "0.1.0", title: "Secure Workspace" },
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
      "Next: aiba add secure-workspace --solution --root /project"
      + " --packs-dir /catalog/capabilities --solutions-dir /catalog/solutions",
    );
  });

  it("quotes paths in generated commands", () => {
    const output = renderSolutionInstall({
      status: "awaiting-finalization",
      solution: { id: "secure-workspace", version: "0.1.0", title: "Secure Workspace" },
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
