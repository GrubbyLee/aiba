import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCapabilityScaffold,
  createApplicationScaffold,
  createSolutionScaffold,
  lintAuthoringDirectory,
} from "./authoring.js";

const workspace = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aiba-authoring-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("capability authoring SDK", () => {
  it("creates a framework-neutral capability that passes the full static quality gate", async () => {
    const root = await temporaryRoot();
    const created = await createCapabilityScaffold({ id: "appointment-booking", outputDirectory: root });
    const report = await lintAuthoringDirectory({ path: created.directory, requireSecurityTests: true });
    expect(report).toMatchObject({
      ok: true,
      kind: "capability",
      id: "appointment-booking",
      quality: { schemaValid: true, semanticsValid: true, securityTestsDeclared: true, score: 100 },
    });
    expect(await readFile(join(created.directory, "capability.yaml"), "utf8")).toContain("layer: business-capability");
  });

  it("creates exact dependency-ordered Solutions from existing packs", async () => {
    const root = await temporaryRoot();
    const created = await createSolutionScaffold({
      id: "secure-accounts",
      outputDirectory: root,
      packsDirectory: join(workspace, "capabilities"),
      capabilities: ["audit", "identity", "authorization"],
    });
    expect(created.capabilities).toEqual(["audit", "identity", "authorization"]);
    const report = await lintAuthoringDirectory({
      path: created.directory,
      packsDirectory: join(workspace, "capabilities"),
    });
    expect(report.ok).toBe(true);
    await expect(createSolutionScaffold({
      id: "wrong-order",
      outputDirectory: root,
      packsDirectory: join(workspace, "capabilities"),
      capabilities: ["authorization", "identity", "audit"],
    })).rejects.toMatchObject({ code: "SOLUTION_DEPENDENCY_ORDER_INVALID" });
  });

  it("creates a domain-neutral Application Blueprint without executable content", async () => {
    const root = await temporaryRoot();
    const created = await createApplicationScaffold({ id: "operations-hub", outputDirectory: root });
    const source = await readFile(created.blueprintPath, "utf8");
    expect(source).toContain("kind: ApplicationBlueprint");
    expect(source).toContain("id: record");
    expect(source).not.toContain("command:");
    await expect(createApplicationScaffold({ id: "operations-hub", outputDirectory: root }))
      .rejects.toMatchObject({ code: "AUTHORING_OUTPUT_EXISTS" });
  });

  it("refuses overwrite and traversal identifiers", async () => {
    const root = await temporaryRoot();
    await createCapabilityScaffold({ id: "safe-capability", outputDirectory: root });
    await expect(createCapabilityScaffold({ id: "safe-capability", outputDirectory: root }))
      .rejects.toMatchObject({ code: "AUTHORING_OUTPUT_EXISTS" });
    await expect(createCapabilityScaffold({ id: "../escape", outputDirectory: root }))
      .rejects.toMatchObject({ code: "INVALID_AUTHORING_ID" });
  });

  it("rejects scripts, symlinks, and missing security plans", async () => {
    const root = await temporaryRoot();
    const created = await createCapabilityScaffold({ id: "unsafe-capability", outputDirectory: root });
    await writeFile(join(created.directory, "install.sh"), "echo unsafe\n");
    let report = await lintAuthoringDirectory({ path: created.directory, requireSecurityTests: true });
    expect(report.issues.map((item) => item.code)).toContain("AUTHORING_FORBIDDEN_FILE");
    await rm(join(created.directory, "install.sh"));
    await rm(join(created.directory, "SECURITY_TESTS.md"));
    report = await lintAuthoringDirectory({ path: created.directory, requireSecurityTests: true });
    expect(report.issues.map((item) => item.code)).toContain("AUTHORING_SECURITY_TEST_PLAN_REQUIRED");
    await mkdir(join(root, "external"));
    await symlink(join(root, "external"), join(created.directory, "linked"));
    await expect(lintAuthoringDirectory({ path: created.directory }))
      .rejects.toMatchObject({ code: "AUTHORING_SYMLINK_FORBIDDEN" });
  });
});
