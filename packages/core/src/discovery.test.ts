import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { describeCatalogItem, discoverCatalog } from "./discovery.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("verified catalog discovery", () => {
  it("lists validated official capabilities and Solutions", async () => {
    const result = await discoverCatalog({
      packsDirectory: join(workspace, "capabilities"),
      solutionsDirectory: join(workspace, "solutions"),
    });
    expect(result.capabilities).toContainEqual(expect.objectContaining({
      id: "wechat-miniprogram-auth",
      layer: "platform-integration",
      dependencies: ["identity@^0.1.0", "audit@^0.1.0"],
    }));
    expect(result.solutions).toContainEqual(expect.objectContaining({
      id: "vehicle-management",
      layer: "industry-solution",
      capabilities: expect.arrayContaining(["vehicle-records@0.1.0"]),
    }));
  });

  it("describes capability contracts and exact Solution constituents", async () => {
    const options = {
      packsDirectory: join(workspace, "capabilities"),
      solutionsDirectory: join(workspace, "solutions"),
    };
    const capability = await describeCatalogItem({ ...options, id: "vehicle-records" });
    expect(capability.kind).toBe("capability");
    if (capability.kind !== "capability") throw new Error("Expected capability details");
    expect(capability.interfaces).toContain("vehicle-records.record");
    expect(capability.invariantDetails).toContainEqual(expect.objectContaining({
      id: "updates-use-optimistic-concurrency",
      severity: "critical",
    }));

    const solution = await describeCatalogItem({ ...options, id: "vehicle-management" });
    expect(solution.kind).toBe("solution");
    if (solution.kind !== "solution") throw new Error("Expected Solution details");
    expect(solution.capabilityDetails).toContainEqual(expect.objectContaining({
      id: "vehicle-records",
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("rejects catalog classification that conflicts with a manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiba-discovery-"));
    const packs = join(root, "capabilities");
    const solutions = join(root, "solutions");
    await mkdir(join(packs, "sample-capability"), { recursive: true });
    await mkdir(solutions);
    await writeFile(join(packs, "catalog.yaml"), stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "CapabilityCatalog",
      capabilities: [{
        id: "sample-capability",
        version: "0.1.0",
        layer: "business-capability",
      }],
    }));
    await writeFile(join(packs, "sample-capability", "capability.yaml"), stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "Capability",
      metadata: {
        id: "sample-capability",
        version: "0.1.0",
        title: "Sample",
        description: "Sample capability",
        layer: "application-foundation",
      },
      spec: {
        interfaces: ["sample.interface"],
        dependencies: [],
        invariants: [{
          id: "sample-invariant",
          title: "Sample invariant",
          description: "Sample behavior remains verifiable.",
          severity: "error",
          evidence: {
            acceptedTypes: ["source"],
            requiredTypes: ["source"],
            minimum: 1,
            requireHash: true,
          },
        }],
      },
    }));
    await expect(discoverCatalog({ packsDirectory: packs, solutionsDirectory: solutions }))
      .rejects.toMatchObject({ code: "CATALOG_CAPABILITY_LAYER_MISMATCH" });
  });

  it("rejects unknown detail identifiers", async () => {
    await expect(describeCatalogItem({
      id: "not-published",
      packsDirectory: join(workspace, "capabilities"),
      solutionsDirectory: join(workspace, "solutions"),
    })).rejects.toMatchObject({ code: "CATALOG_ITEM_NOT_FOUND" });
  });
});
