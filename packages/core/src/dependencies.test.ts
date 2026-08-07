import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProjectManifest } from "aiba-spec";
import { assertDependenciesInstalled } from "./add.js";
import { loadCapabilityCatalog, loadCapabilityManifest } from "./loaders.js";

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

  it("requires authorization and audit before file assets", async () => {
    const fileAssets = await loadCapabilityManifest(
      join(workspace, "capabilities"),
      "file-assets",
    );
    expect(() => assertDependenciesInstalled(project([
      { id: "authorization", version: "0.1.0" },
    ]), fileAssets)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
    }));
    expect(() => assertDependenciesInstalled(project([
      { id: "audit", version: "0.1.0" },
      { id: "authorization", version: "0.1.0" },
    ]), fileAssets)).not.toThrow();
  });

  it("requires the verified file boundary before import export", async () => {
    const importExport = await loadCapabilityManifest(
      join(workspace, "capabilities"),
      "import-export",
    );
    expect(() => assertDependenciesInstalled(project([
      { id: "audit", version: "0.1.0" },
      { id: "authorization", version: "0.1.0" },
    ]), importExport)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
    }));
    expect(() => assertDependenciesInstalled(project([
      { id: "audit", version: "0.1.0" },
      { id: "authorization", version: "0.1.0" },
      { id: "file-assets", version: "0.1.0" },
    ]), importExport)).not.toThrow();
  });

  it("requires authorization and audit before vehicle records", async () => {
    const vehicleRecords = await loadCapabilityManifest(
      join(workspace, "capabilities"),
      "vehicle-records",
    );
    expect(() => assertDependenciesInstalled(project([
      { id: "authorization", version: "0.1.0" },
    ]), vehicleRecords)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
    }));
    expect(() => assertDependenciesInstalled(project([
      { id: "audit", version: "0.1.0" },
      { id: "authorization", version: "0.1.0" },
    ]), vehicleRecords)).not.toThrow();
  });

  it("classifies every official capability in the five-layer catalog", async () => {
    const expected = new Map([
      ["audit", "engineering-governance"],
      ["authorization", "application-foundation"],
      ["comments-activity", "business-capability"],
      ["feature-flags", "application-foundation"],
      ["file-assets", "application-foundation"],
      ["data-dict", "application-foundation"],
      ["form-engine", "business-capability"],
      ["i18n", "application-foundation"],
      ["identity", "application-foundation"],
      ["import-export", "business-capability"],
      ["notification", "application-foundation"],
      ["organization", "application-foundation"],
      ["reporting", "business-capability"],
      ["review-access", "application-foundation"],
      ["scheduled-jobs", "application-foundation"],
      ["search", "application-foundation"],
      ["users", "application-foundation"],
      ["vehicle-records", "business-capability"],
      ["verification-challenge", "application-foundation"],
      ["webhooks", "platform-integration"],
      ["wechat-miniprogram-auth", "platform-integration"],
      ["workflow-approval", "business-capability"],
    ]);
    const catalog = await loadCapabilityCatalog(join(workspace, "capabilities"));
    expect(catalog.capabilities).toHaveLength(expected.size);
    for (const entry of catalog.capabilities) {
      expect(entry.layer, entry.id).toBe(expected.get(entry.id));
      const id = entry.id;
      const manifest = await loadCapabilityManifest(join(workspace, "capabilities"), id);
      expect(entry.version, id).toBe(manifest.metadata.version);
      if (manifest.metadata.layer) expect(manifest.metadata.layer, id).toBe(entry.layer);
    }
  });

  it("orders the official catalog after every required dependency", async () => {
    const catalog = await loadCapabilityCatalog(join(workspace, "capabilities"));
    const positions = new Map(catalog.capabilities.map((entry, index) => [entry.id, index]));
    for (const entry of catalog.capabilities) {
      const manifest = await loadCapabilityManifest(join(workspace, "capabilities"), entry.id);
      for (const dependency of manifest.spec.dependencies.filter((item) => !item.optional)) {
        expect(positions.get(dependency.id), `${entry.id} dependency ${dependency.id}`).toBeLessThan(positions.get(entry.id)!);
      }
    }
  });

  it("requires identity and audit before WeChat Mini Program authentication", async () => {
    const wechatAuth = await loadCapabilityManifest(
      join(workspace, "capabilities"),
      "wechat-miniprogram-auth",
    );
    expect(() => assertDependenciesInstalled(project([
      { id: "identity", version: "0.1.0" },
    ]), wechatAuth)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_DEPENDENCY_UNSATISFIED",
    }));
    expect(() => assertDependenciesInstalled(project([
      { id: "identity", version: "0.1.0" },
      { id: "audit", version: "0.1.0" },
    ]), wechatAuth)).not.toThrow();
  });
});
