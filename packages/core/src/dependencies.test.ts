import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProjectManifest } from "@aiba/spec";
import { assertDependenciesInstalled } from "./add.js";
import { loadCapabilityManifest } from "./loaders.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function project(capabilities: Array<{ id: string; version: string }>): ProjectManifest {
  return {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Project",
    project: { name: "dependency-fixture" },
    capabilities: capabilities.map((capability) => ({
      ...capability,
      receipt: `.aiba/receipts/${capability.id}.yaml`,
    })),
  };
}

describe("core capability dependencies", () => {
  it("allows identity without its optional audit dependency", async () => {
    const identity = await loadCapabilityManifest(join(workspace, "capabilities"), "identity");
    expect(() => assertDependenciesInstalled(project([]), identity)).not.toThrow();
  });

  it("requires identity and audit before authorization", async () => {
    const authorization = await loadCapabilityManifest(
      join(workspace, "capabilities"),
      "authorization",
    );
    expect(() => assertDependenciesInstalled(project([]), authorization))
      .toThrowError(expect.objectContaining({ code: "CAPABILITY_DEPENDENCY_UNSATISFIED" }));
    expect(() => assertDependenciesInstalled(project([
      { id: "identity", version: "0.1.0" },
    ]), authorization)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
    }));
    expect(() => assertDependenciesInstalled(project([
      { id: "identity", version: "0.1.0" },
      { id: "audit", version: "0.1.0" },
    ]), authorization)).not.toThrow();
  });

  it("requires the full security base before users and notification", async () => {
    const [users, notification] = await Promise.all([
      loadCapabilityManifest(join(workspace, "capabilities"), "users"),
      loadCapabilityManifest(join(workspace, "capabilities"), "notification"),
    ]);
    const securityBase = project([
      { id: "identity", version: "0.1.0" },
      { id: "audit", version: "0.1.0" },
      { id: "authorization", version: "0.1.0" },
    ]);
    expect(() => assertDependenciesInstalled(securityBase, users)).not.toThrow();
    expect(() => assertDependenciesInstalled(project([
      { id: "audit", version: "0.1.0" },
    ]), notification)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
    }));
  });
});
