import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type { CapabilitySolution, OperationPlan, ProjectManifest } from "aiba-spec";
import { finalizeCapability, prepareCapability } from "./add.js";
import { generatePublisherKeyPair } from "./bundle.js";
import { initializeGovernancePolicy } from "./governance.js";
import { sha256File } from "./hash.js";
import { initializeProject } from "./init.js";
import { advanceSolutionInstallation } from "./solution-install.js";
import { doctorProject, solutionStatus } from "./workflow.js";

interface Fixture {
  root: string;
  packs: string;
  solutions: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "aiba-solution-install-"));
  const packs = join(root, "packs");
  const solutions = join(root, "solutions");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(solutions, "fleet"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fleet-project" }));
  await writeFile(join(root, "src", "project.ts"), "export const project = true;\n");
  await initializeProject(root, () => new Date("2026-08-04T00:00:00Z"));

  const definitions = [
    { id: "audit", dependencies: [] },
    { id: "identity", dependencies: [] },
    {
      id: "vehicles",
      dependencies: [{ id: "identity", version: "^0.1.0", optional: false }],
    },
  ];
  const capabilities: CapabilitySolution["spec"]["capabilities"] = [];
  for (const definition of definitions) {
    const directory = join(packs, definition.id);
    await mkdir(join(directory, "recipes"), { recursive: true });
    const manifestPath = join(directory, "capability.yaml");
    await writeFile(manifestPath, stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "Capability",
      metadata: {
        id: definition.id,
        version: "0.1.0",
        title: definition.id,
        description: `${definition.id} fixture capability`,
      },
      spec: {
        interfaces: [`${definition.id}.interface`],
        dependencies: definition.dependencies,
        invariants: [{
          id: `${definition.id}-works`,
          title: `${definition.id} works`,
          description: `${definition.id} must have source evidence.`,
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
    await writeFile(join(directory, "recipes", "typescript-reference.yaml"), stringify({
      apiVersion: "aiba.dev/v0alpha1",
      kind: "CapabilityRecipe",
      metadata: {
        id: "typescript-reference",
        version: "0.1.0",
        title: `${definition.id} TypeScript recipe`,
        description: `Implement ${definition.id} in TypeScript.`,
      },
      spec: {
        capability: { id: definition.id, version: "0.1.0" },
        compatibility: { languages: ["TypeScript"], frameworks: [] },
        writeScope: { allowedPatterns: ["src/**"] },
        operations: [{
          id: `implement-${definition.id}`,
          intent: `Implement ${definition.id}.`,
          requiredInterfaces: [`${definition.id}.interface`],
          invariants: [`${definition.id}-works`],
          guidance: [`Keep ${definition.id} bounded.`],
        }],
        evidence: [{
          invariant: `${definition.id}-works`,
          suggestions: [{
            type: "source",
            pathPattern: "src/**/*.ts",
            description: `${definition.id} source.`,
          }],
        }],
      },
    }));
    capabilities.push({
      id: definition.id,
      version: "0.1.0",
      manifestSha256: await sha256File(manifestPath),
      purpose: `Provide ${definition.id}`,
    });
  }
  await writeFile(join(solutions, "fleet", "solution.yaml"), stringify({
    apiVersion: "aiba.dev/v0alpha1",
    kind: "CapabilitySolution",
    metadata: {
      id: "fleet",
      version: "0.1.0",
      title: "Fleet",
      description: "A guided installation fixture.",
      layer: "industry-solution",
    },
    spec: { capabilities },
  }));
  return { root, packs, solutions };
}

function options(fixture: Fixture, mode: "prepare" | "finalize" = "prepare") {
  return {
    solutionId: "fleet",
    projectRoot: fixture.root,
    packsDirectory: fixture.packs,
    solutionsDirectory: fixture.solutions,
    mode,
  } as const;
}

async function addEvidence(root: string, capabilityId: string): Promise<void> {
  const planPath = join(root, ".aiba", "plans", `${capabilityId}.yaml`);
  const plan = parse(await readFile(planPath, "utf8")) as OperationPlan;
  const evidence = plan.evidence[0];
  if (!evidence) throw new Error("Fixture plan has no evidence requirement");
  evidence.items = [{ type: "source", path: "src/project.ts" }];
  await writeFile(planPath, stringify(plan));
}

async function installCurrent(fixture: Fixture, capabilityId: string) {
  const prepared = await advanceSolutionInstallation(options(fixture));
  expect(prepared.currentCapability?.id).toBe(capabilityId);
  await addEvidence(fixture.root, capabilityId);
  return advanceSolutionInstallation(options(fixture, "finalize"));
}

async function installStandalone(fixture: Fixture, capabilityId: string): Promise<void> {
  await prepareCapability({
    projectRoot: fixture.root,
    packsDirectory: fixture.packs,
    capabilityId,
  });
  await addEvidence(fixture.root, capabilityId);
  await finalizeCapability({
    projectRoot: fixture.root,
    packsDirectory: fixture.packs,
    capabilityId,
  });
}

describe("guided Solution installation", () => {
  it("derives resumable status without writing or skipping a step", async () => {
    const fixture = await createFixture();
    let status = await solutionStatus(options(fixture));
    expect(status).toMatchObject({
      phase: "ready-to-prepare",
      progress: { completed: 0, total: 3 },
      currentCapability: { id: "audit", index: 1 },
      nextAction: { command: "continue" },
    });
    await advanceSolutionInstallation(options(fixture));
    status = await solutionStatus(options(fixture));
    expect(status).toMatchObject({
      phase: "awaiting-agent",
      currentCapability: { id: "audit" },
      planPath: ".aiba/plans/audit.yaml",
      nextAction: { command: "continue-finalize" },
    });
    await installCurrent(fixture, "audit");
    status = await solutionStatus(options(fixture));
    expect(status).toMatchObject({
      phase: "ready-to-prepare",
      progress: { completed: 1, total: 3 },
      currentCapability: { id: "identity", index: 2 },
    });
  });

  it("fails status closed for a tampered pending plan", async () => {
    const fixture = await createFixture();
    await advanceSolutionInstallation(options(fixture));
    const path = join(fixture.root, ".aiba", "plans", "audit.yaml");
    const plan = parse(await readFile(path, "utf8")) as OperationPlan;
    plan.capability.manifestSha256 = "0".repeat(64);
    await writeFile(path, stringify(plan));
    await expect(solutionStatus(options(fixture))).rejects.toMatchObject({
      code: "STALE_CAPABILITY_PLAN",
    });
  });

  it("diagnoses initialization, clean state, and evidence drift", async () => {
    const empty = await mkdtemp(join(tmpdir(), "aiba-doctor-empty-"));
    await writeFile(join(empty, "package.json"), JSON.stringify({ name: "empty" }));
    let doctor = await doctorProject({ projectRoot: empty, packsDirectory: join(empty, "packs") });
    expect(doctor.ok).toBe(false);
    expect(doctor.checks).toContainEqual(expect.objectContaining({ id: "aiba-state", status: "fail" }));

    const fixture = await createFixture();
    doctor = await doctorProject({ projectRoot: fixture.root, packsDirectory: fixture.packs });
    expect(doctor.ok).toBe(true);
    await installCurrent(fixture, "audit");
    doctor = await doctorProject({ projectRoot: fixture.root, packsDirectory: fixture.packs });
    expect(doctor.ok).toBe(true);
    await writeFile(join(fixture.root, "src", "project.ts"), "export const project = false;\n");
    doctor = await doctorProject({ projectRoot: fixture.root, packsDirectory: fixture.packs });
    expect(doctor.ok).toBe(false);
    expect(doctor.checks).toContainEqual(expect.objectContaining({ id: "evidence-provenance", status: "fail" }));
  });

  it("prepares only the first missing capability and recognizes its valid plan", async () => {
    const fixture = await createFixture();
    const prepared = await advanceSolutionInstallation(options(fixture));
    expect(prepared).toMatchObject({
      status: "prepared",
      progress: { completed: 0, total: 3 },
      currentCapability: { id: "audit", version: "0.1.0", index: 1 },
      remainingCapabilities: ["audit", "identity", "vehicles"],
      planPath: ".aiba/plans/audit.yaml",
    });
    await expect(readFile(join(fixture.root, ".aiba", "plans", "identity.yaml"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    const pending = await advanceSolutionInstallation(options(fixture));
    expect(pending.status).toBe("awaiting-finalization");
    expect(pending.planPath).toBe(".aiba/plans/audit.yaml");
  });

  it("rejects tampered pending plans instead of treating them as resumable", async () => {
    const fixture = await createFixture();
    await advanceSolutionInstallation(options(fixture));
    const path = join(fixture.root, ".aiba", "plans", "audit.yaml");
    const plan = parse(await readFile(path, "utf8")) as OperationPlan;
    const operation = plan.operations[0];
    if (!operation) throw new Error("Fixture plan has no operation");
    operation.intent = "Tampered contract intent.";
    await writeFile(path, stringify(plan));
    await expect(advanceSolutionInstallation(options(fixture)))
      .rejects.toMatchObject({ code: "PLAN_CONTRACT_MODIFIED" });
  });

  it("requires a plan before finalization and preserves one-step progress", async () => {
    const fixture = await createFixture();
    await expect(advanceSolutionInstallation(options(fixture, "finalize")))
      .rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const finalized = await installCurrent(fixture, "audit");
    expect(finalized).toMatchObject({
      status: "finalized",
      progress: { completed: 1, total: 3 },
      currentCapability: { id: "audit", index: 1 },
      remainingCapabilities: ["identity", "vehicles"],
      finalization: { capability: "audit", version: "0.1.0" },
    });
    await expect(readFile(join(fixture.root, ".aiba", "plans", "identity.yaml"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves per-capability governance during Solution finalization", async () => {
    const fixture = await createFixture();
    await advanceSolutionInstallation(options(fixture));
    await addEvidence(fixture.root, "audit");
    const keys = await generatePublisherKeyPair({
      publisherId: "release-manager",
      outputDirectory: join(fixture.root, "approval-keys"),
    });
    await initializeGovernancePolicy({
      projectRoot: fixture.root,
      policyId: "fleet-policy",
      approverId: "release-manager",
      keyId: "root-1",
      publicKeyPath: keys.publicKeyPath,
      capabilities: ["audit"],
    });

    await expect(advanceSolutionInstallation({
      ...options(fixture, "finalize"),
      agent: "codex",
    })).rejects.toMatchObject({ code: "GOVERNANCE_DENIED" });
  });

  it("verifies Solution evidence after finalizing its last constituent", async () => {
    const fixture = await createFixture();
    await installCurrent(fixture, "audit");
    await installCurrent(fixture, "identity");
    const complete = await installCurrent(fixture, "vehicles");
    expect(complete).toMatchObject({
      status: "evidence-verified",
      progress: { completed: 3, total: 3 },
      remainingCapabilities: [],
      finalization: { capability: "vehicles" },
      verification: { ok: true },
    });

    const repeated = await advanceSolutionInstallation(options(fixture));
    expect(repeated.status).toBe("evidence-verified");
    expect(repeated.finalization).toBeUndefined();
  });

  it("reports only genuinely missing capabilities after out-of-order preinstallation", async () => {
    const fixture = await createFixture();
    await installStandalone(fixture, "identity");

    const prepared = await advanceSolutionInstallation(options(fixture));
    expect(prepared).toMatchObject({
      status: "prepared",
      progress: { completed: 1, total: 3 },
      currentCapability: { id: "audit", index: 1 },
      remainingCapabilities: ["audit", "vehicles"],
    });
    await addEvidence(fixture.root, "audit");
    const finalized = await advanceSolutionInstallation(options(fixture, "finalize"));
    expect(finalized).toMatchObject({
      status: "finalized",
      progress: { completed: 2, total: 3 },
      remainingCapabilities: ["vehicles"],
    });
  });

  it("verifies immediately when finalizing the only missing constituent", async () => {
    const fixture = await createFixture();
    await installStandalone(fixture, "identity");
    await installStandalone(fixture, "vehicles");
    await advanceSolutionInstallation(options(fixture));
    await addEvidence(fixture.root, "audit");

    const result = await advanceSolutionInstallation(options(fixture, "finalize"));
    expect(result).toMatchObject({
      status: "evidence-verified",
      progress: { completed: 3, total: 3 },
      remainingCapabilities: [],
      verification: { ok: true, scope: "evidence-and-provenance" },
    });
  });

  it("blocks progress when an installed constituent has drift or a wrong version", async () => {
    const drifted = await createFixture();
    await installCurrent(drifted, "audit");
    await writeFile(join(drifted.root, "src", "project.ts"), "export const project = false;\n");
    await expect(advanceSolutionInstallation(options(drifted)))
      .rejects.toMatchObject({ code: "SOLUTION_INSTALLED_CAPABILITY_INVALID" });

    const mismatched = await createFixture();
    await installCurrent(mismatched, "audit");
    const manifestPath = join(mismatched.root, ".aiba", "manifest.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8")) as ProjectManifest;
    const audit = manifest.capabilities.find(({ id }) => id === "audit");
    if (!audit) throw new Error("Fixture did not install audit");
    audit.version = "0.2.0";
    await writeFile(manifestPath, stringify(manifest));
    await expect(advanceSolutionInstallation(options(mismatched)))
      .rejects.toMatchObject({ code: "SOLUTION_PROJECT_VERSION_MISMATCH" });
  });

  it("ignores project-owned capabilities outside the Solution and rejects traversal IDs", async () => {
    const fixture = await createFixture();
    const manifestPath = join(fixture.root, ".aiba", "manifest.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8")) as ProjectManifest;
    manifest.capabilities.push({
      id: "project-extension",
      version: "9.0.0",
      receipt: ".aiba/receipts/project-extension.yaml",
    });
    await writeFile(manifestPath, stringify(manifest));
    const result = await advanceSolutionInstallation(options(fixture));
    expect(result.currentCapability?.id).toBe("audit");

    await expect(advanceSolutionInstallation({
      ...options(fixture),
      solutionId: "../fleet",
    })).rejects.toMatchObject({ code: "INVALID_SOLUTION_ID" });
  });
});
