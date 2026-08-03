import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type { CapabilitySolution } from "aiba-spec";
import { sha256File } from "./hash.js";
import { loadCapabilitySolution } from "./loaders.js";
import { checkSolution, resolveSolution } from "./solution.js";

interface Fixture {
  root: string;
  packs: string;
  solutions: string;
  solution: CapabilitySolution;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "aiba-solution-"));
  const packs = join(root, "packs");
  const solutions = join(root, "solutions");
  const evidencePath = join(root, "src", "evidence.ts");
  await mkdir(join(root, ".aiba", "receipts"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(solutions, "fleet-foundation"), { recursive: true });
  await writeFile(evidencePath, "export const evidence = true;\n");
  const evidenceHash = await sha256File(evidencePath);
  const capabilities = [
    { id: "audit", dependencies: [] },
    { id: "identity", dependencies: [] },
    {
      id: "authorization",
      dependencies: [
        { id: "identity", version: "^0.1.0", optional: false },
        { id: "audit", version: "^0.1.0", optional: false },
      ],
    },
  ];
  const solutionCapabilities: CapabilitySolution["spec"]["capabilities"] = [];
  const lockCapabilities = [];

  for (const capability of capabilities) {
    const capabilityDirectory = join(packs, capability.id);
    await mkdir(capabilityDirectory, { recursive: true });
    const manifestPath = join(capabilityDirectory, "capability.yaml");
    await writeFile(manifestPath, stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "Capability",
      metadata: {
        id: capability.id,
        version: "0.1.0",
        title: capability.id,
        description: `${capability.id} fixture capability`,
      },
      spec: {
        interfaces: ["fixture.interface"],
        dependencies: capability.dependencies,
        invariants: [{
          id: "fixture-invariant",
          title: "Fixture invariant",
          description: "Fixture evidence must remain unchanged.",
          severity: "critical",
          evidence: {
            acceptedTypes: ["source"],
            requiredTypes: ["source"],
            minimum: 1,
            requireHash: true,
          },
        }],
      },
    }));
    const manifestSha256 = await sha256File(manifestPath);
    solutionCapabilities.push({
      id: capability.id,
      version: "0.1.0",
      manifestSha256,
      purpose: `Provide ${capability.id}`,
    });
    lockCapabilities.push({ id: capability.id, version: "0.1.0", manifestSha256 });
    await writeFile(join(root, ".aiba", "receipts", `${capability.id}.yaml`), stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "CapabilityReceipt",
      capability: { id: capability.id, version: "0.1.0" },
      installation: { method: "manual", createdAt: "2026-08-03T00:00:00Z" },
      invariants: [{
        id: "fixture-invariant",
        evidence: [{ type: "source", path: "src/evidence.ts", sha256: evidenceHash }],
      }],
    }));
  }

  const solution: CapabilitySolution = {
    apiVersion: "aiba.dev/v0alpha1",
    kind: "CapabilitySolution",
    metadata: {
      id: "fleet-foundation",
      version: "0.1.0",
      title: "Fleet Foundation",
      description: "Fixture composition",
      layer: "industry-solution",
    },
    spec: { capabilities: solutionCapabilities },
  };
  await writeFile(join(solutions, "fleet-foundation", "solution.yaml"), stringify(solution));
  await writeFile(join(root, ".aiba", "manifest.yaml"), stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Project",
    project: { name: "solution-fixture" },
    capabilities: capabilities.map(({ id }) => ({
      id,
      version: "0.1.0",
      receipt: `.aiba/receipts/${id}.yaml`,
    })),
  }));
  await writeFile(join(root, ".aiba", "lock.json"), JSON.stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "Lock",
    generatedAt: "2026-08-03T00:00:00Z",
    capabilities: lockCapabilities,
  }));
  return { root, packs, solutions, solution };
}

describe("capability solution composition", () => {
  it("verifies every exact constituent in dependency order", async () => {
    const fixture = await createFixture();
    const report = await checkSolution({
      solutionId: "fleet-foundation",
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      solutionsDirectory: fixture.solutions,
    });
    expect(report.ok).toBe(true);
    expect(report.installationOrder).toEqual(["audit", "identity", "authorization"]);
    expect(report.capabilities.every(({ verified }) => verified)).toBe(true);
  });

  it("rejects traversal solution identifiers", async () => {
    const fixture = await createFixture();
    await expect(loadCapabilitySolution(fixture.solutions, "../fleet-foundation"))
      .rejects.toMatchObject({ code: "INVALID_SOLUTION_ID" });
  });

  it("rejects duplicate constituents", async () => {
    const fixture = await createFixture();
    fixture.solution.spec.capabilities.push(fixture.solution.spec.capabilities[0]!);
    await expect(resolveSolution(fixture.solution, fixture.packs))
      .rejects.toMatchObject({ code: "DUPLICATE_SOLUTION_CAPABILITY" });
  });

  it("rejects omitted required dependencies", async () => {
    const fixture = await createFixture();
    fixture.solution.spec.capabilities = fixture.solution.spec.capabilities
      .filter(({ id }) => id !== "identity");
    await expect(resolveSolution(fixture.solution, fixture.packs))
      .rejects.toMatchObject({ code: "SOLUTION_DEPENDENCY_MISSING" });
  });

  it("rejects a dependency placed after its consumer", async () => {
    const fixture = await createFixture();
    fixture.solution.spec.capabilities = [
      fixture.solution.spec.capabilities[2]!,
      fixture.solution.spec.capabilities[0]!,
      fixture.solution.spec.capabilities[1]!,
    ];
    await expect(resolveSolution(fixture.solution, fixture.packs))
      .rejects.toMatchObject({ code: "SOLUTION_DEPENDENCY_ORDER_INVALID" });
  });

  it("rejects exact version and manifest hash mismatches", async () => {
    const versionFixture = await createFixture();
    versionFixture.solution.spec.capabilities[0]!.version = "0.2.0";
    await expect(resolveSolution(versionFixture.solution, versionFixture.packs))
      .rejects.toMatchObject({ code: "SOLUTION_CAPABILITY_VERSION_MISMATCH" });

    const hashFixture = await createFixture();
    hashFixture.solution.spec.capabilities[0]!.manifestSha256 = "0".repeat(64);
    await expect(resolveSolution(hashFixture.solution, hashFixture.packs))
      .rejects.toMatchObject({ code: "SOLUTION_CAPABILITY_HASH_MISMATCH" });
  });

  it("rejects invariant overrides and ignored invariant lists at schema boundary", async () => {
    const fixture = await createFixture();
    const path = join(fixture.solutions, "fleet-foundation", "solution.yaml");
    const value = parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const spec = value.spec as Record<string, unknown>;
    spec.ignoredInvariants = ["fixture-invariant"];
    await writeFile(path, stringify(value));
    await expect(loadCapabilitySolution(fixture.solutions, "fleet-foundation"))
      .rejects.toMatchObject({ code: "PROTOCOL_VALIDATION_FAILED" });
  });

  it("reports missing and drifted project capabilities without writing state", async () => {
    const fixture = await createFixture();
    const manifestPath = join(fixture.root, ".aiba", "manifest.yaml");
    const value = parse(await readFile(manifestPath, "utf8")) as {
      capabilities: Array<{ id: string; version: string }>;
    };
    value.capabilities = value.capabilities.filter(({ id }) => id !== "audit");
    value.capabilities.find(({ id }) => id === "identity")!.version = "0.2.0";
    await writeFile(manifestPath, stringify(value));

    const report = await checkSolution({
      solutionId: "fleet-foundation",
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      solutionsDirectory: fixture.solutions,
    });
    expect(report.ok).toBe(false);
    expect(report.missingCapabilities).toEqual(["audit"]);
    expect(report.capabilities).toContainEqual(expect.objectContaining({
      id: "identity",
      installed: true,
      verified: false,
    }));
  });

  it("detects constituent evidence drift through full project verification", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "src", "evidence.ts"), "export const evidence = false;\n");
    const report = await checkSolution({
      solutionId: "fleet-foundation",
      projectRoot: fixture.root,
      packsDirectory: fixture.packs,
      solutionsDirectory: fixture.solutions,
    });
    expect(report.ok).toBe(false);
    expect(report.capabilities[0]?.issues).toContainEqual(expect.objectContaining({
      code: "EVIDENCE_HASH_MISMATCH",
    }));
  });
});
