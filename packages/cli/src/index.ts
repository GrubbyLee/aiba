#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  finalizeCapability,
  finalizeUpgrade,
  createCapabilityBundle,
  createCapabilityApproval,
  createRegistryIndex,
  diffProject,
  generatePublisherKeyPair,
  initializeProject,
  initializeGovernancePolicy,
  inspectProject,
  prepareCapability,
  prepareUpgrade,
  evaluateGovernance,
  fetchRegistryCapability,
  resolveRegistryCapability,
  verifyCapabilityBundle,
  verifyProject,
} from "@aiba/core";
import { renderDiff, renderInspection, renderVerification } from "./render.js";

const program = new Command();

program
  .name("aiba")
  .description("Install, verify, trace, and upgrade application capabilities")
  .version("0.1.0");

program
  .command("policy-init")
  .description("Initialize project-owned capability governance")
  .option("--root <path>", "project root", ".")
  .requiredOption("--id <id>", "policy identifier")
  .requiredOption("--approver <id>", "initial approver identifier")
  .requiredOption("--key-id <id>", "approver public key identifier")
  .requiredOption("--public-key <path>", "Ed25519 SPKI public key")
  .requiredOption("--capability <ids...>", "allowed capability identifiers")
  .option("--install-approvals <number>", "required install approvals", "1")
  .option("--upgrade-approvals <number>", "required upgrade approvals", "1")
  .option("--conflict-approvals <number>", "required conflict upgrade approvals", "1")
  .option("--ttl-hours <number>", "maximum approval lifetime in hours", "72")
  .option("--allow-self-approval", "allow the implementing Agent to approve")
  .option("--json", "print machine-readable JSON")
  .action(async (options: {
    root: string;
    id: string;
    approver: string;
    keyId: string;
    publicKey: string;
    capability: string[];
    installApprovals: string;
    upgradeApprovals: string;
    conflictApprovals: string;
    ttlHours: string;
    allowSelfApproval?: boolean;
    json?: boolean;
  }) => {
    const installApprovals = Number(options.installApprovals);
    const upgradeApprovals = Number(options.upgradeApprovals);
    const conflictApprovals = Number(options.conflictApprovals);
    const ttlHours = Number(options.ttlHours);
    if (
      !Number.isSafeInteger(installApprovals)
      || !Number.isSafeInteger(upgradeApprovals)
      || !Number.isSafeInteger(conflictApprovals)
      || installApprovals < 1
      || upgradeApprovals < 1
      || conflictApprovals < 1
    ) {
      throw new Error("approval thresholds must be positive integers");
    }
    if (!Number.isFinite(ttlHours) || ttlHours < 1 / 60 || ttlHours > 720) {
      throw new Error("--ttl-hours must be between 1/60 and 720");
    }
    const result = await initializeGovernancePolicy({
      projectRoot: resolve(options.root),
      policyId: options.id,
      approverId: options.approver,
      keyId: options.keyId,
      publicKeyPath: resolve(options.publicKey),
      capabilities: options.capability,
      installApprovals,
      upgradeApprovals,
      conflictUpgradeApprovals: conflictApprovals,
      approvalTtlSeconds: Math.round(ttlHours * 60 * 60),
      prohibitSelfApproval: !options.allowSelfApproval,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Initialized governance policy ${result.policy.metadata.id}@${result.policy.metadata.version}.`,
      `Policy: ${result.policyPath}`,
      `Initial approver: ${options.approver}/${options.keyId}`,
    ].join("\n") + "\n");
  });

program
  .command("approve")
  .description("Sign the current capability plan as a trusted approver")
  .argument("<capability>", "capability plan to approve")
  .option("--root <path>", "project root", ".")
  .requiredOption("--approver <id>", "approver identifier")
  .requiredOption("--key-id <id>", "approver key identifier")
  .requiredOption("--private-key <path>", "Ed25519 PKCS#8 private key")
  .option("--upgrade", "approve the current upgrade plan")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: {
      root: string;
      approver: string;
      keyId: string;
      privateKey: string;
      upgrade?: boolean;
      json?: boolean;
    },
  ) => {
    const result = await createCapabilityApproval({
      projectRoot: resolve(options.root),
      capabilityId: capability,
      operation: options.upgrade ? "upgrade" : "install",
      approverId: options.approver,
      keyId: options.keyId,
      privateKeyPath: resolve(options.privateKey),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Approved ${result.approval.statement.operation.type} of ${capability}.`,
      `Approver: ${result.approval.statement.approver.id}/${result.approval.statement.approver.keyId}`,
      `Expires: ${result.approval.statement.expiresAt}`,
      `Approval: ${result.approvalPath}`,
    ].join("\n") + "\n");
  });

program
  .command("policy-check")
  .description("Evaluate signed approvals for the current capability plan")
  .argument("<capability>", "capability plan to evaluate")
  .option("--root <path>", "project root", ".")
  .option("--upgrade", "evaluate the current upgrade plan")
  .option("--agent <name>", "implementing Agent identity")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: { root: string; upgrade?: boolean; agent?: string; json?: boolean },
  ) => {
    const result = await evaluateGovernance({
      projectRoot: resolve(options.root),
      capabilityId: capability,
      operation: options.upgrade ? "upgrade" : "install",
      ...(options.agent ? { agent: options.agent } : {}),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (!result.enabled) {
      process.stdout.write("Governance is not enabled for this project.\n");
    } else {
      process.stdout.write([
        `Governance: ${result.ok ? "approved" : "denied"}`,
        `Approvals: ${result.validApprovals}/${result.requiredApprovals}`,
        ...result.issues.map((issue) => `${issue.code}: ${issue.message}`),
      ].join("\n") + "\n");
    }
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("registry-index")
  .description("Create an immutable signed registry index snapshot")
  .argument("<registry-directory>", "local registry directory")
  .requiredOption("--id <id>", "registry identifier")
  .requiredOption("--publisher <id>", "registry operator publisher identifier")
  .requiredOption("--key-id <id>", "registry signing key identifier")
  .requiredOption("--private-key <path>", "Ed25519 PKCS#8 private key")
  .requiredOption("--publisher-trust <path>", "capability publisher trust policy JSON")
  .requiredOption("--sequence <number>", "new monotonically increasing sequence")
  .requiredOption("--expires-at <date-time>", "index expiry in ISO 8601 format")
  .option("--json", "print machine-readable JSON")
  .action(async (
    registryDirectory: string,
    options: {
      id: string;
      publisher: string;
      keyId: string;
      privateKey: string;
      publisherTrust: string;
      sequence: string;
      expiresAt: string;
      json?: boolean;
    },
  ) => {
    const sequence = Number(options.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("--sequence must be a positive safe integer");
    }
    const expiresAt = new Date(options.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("--expires-at must be a valid ISO 8601 date-time");
    }
    const result = await createRegistryIndex({
      registryDirectory: resolve(registryDirectory),
      registryId: options.id,
      publisherId: options.publisher,
      keyId: options.keyId,
      privateKeyPath: resolve(options.privateKey),
      publisherTrustPolicyPath: resolve(options.publisherTrust),
      sequence,
      expiresAt,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Indexed ${result.entries} bundles for ${result.registry}.`,
      `Sequence: ${result.sequence}`,
      `Snapshot: ${result.snapshotDirectory}`,
      `Index SHA-256: ${result.indexSha256}`,
    ].join("\n") + "\n");
  });

program
  .command("fetch")
  .description("Fetch a verified capability from an authenticated private registry")
  .argument("<capability>", "capability to fetch")
  .requiredOption("--registry-url <url>", "private registry base URL")
  .requiredOption("--registry-trust <path>", "registry signer trust policy JSON")
  .requiredOption("--publisher-trust <path>", "capability publisher trust policy JSON")
  .option("--cache <path>", "verified registry cache", ".aiba/registry-cache")
  .option("--state <path>", "trusted anti-rollback state", ".aiba/registry-state.json")
  .option("--token-env <name>", "environment variable containing the bearer token", "AIBA_REGISTRY_TOKEN")
  .option("--timeout-ms <number>", "request timeout in milliseconds", "15000")
  .option("--version <version>", "fetch an exact semantic version")
  .option("--allow-insecure-localhost", "allow HTTP only for a localhost registry")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: {
      registryUrl: string;
      registryTrust: string;
      publisherTrust: string;
      cache: string;
      state: string;
      tokenEnv: string;
      timeoutMs: string;
      version?: string;
      allowInsecureLocalhost?: boolean;
      json?: boolean;
    },
  ) => {
    const timeoutMs = Number(options.timeoutMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new Error("--timeout-ms must be an integer between 1 and 120000");
    }
    const result = await fetchRegistryCapability({
      registryUrl: options.registryUrl,
      cacheDirectory: resolve(options.cache),
      registryTrustPolicyPath: resolve(options.registryTrust),
      publisherTrustPolicyPath: resolve(options.publisherTrust),
      statePath: resolve(options.state),
      capabilityId: capability,
      tokenEnvironmentVariable: options.tokenEnv,
      timeoutMs,
      allowInsecureLocalhost: options.allowInsecureLocalhost ?? false,
      ...(options.version ? { version: options.version } : {}),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Fetched ${result.capability}@${result.version}.`,
      `Registry: ${result.registry} sequence ${result.sequence}`,
      `Publisher: ${result.publisher}/${result.keyId}`,
      `Cache: ${result.cacheDirectory}`,
      `Pack: ${result.packDirectory}`,
      `Anti-rollback state: ${result.statePath}`,
    ].join("\n") + "\n");
  });

program
  .command("resolve")
  .description("Resolve a verified capability from a signed local registry")
  .argument("<capability>", "capability to resolve")
  .requiredOption("--registry <path>", "local registry directory")
  .requiredOption("--registry-trust <path>", "registry signer trust policy JSON")
  .requiredOption("--publisher-trust <path>", "capability publisher trust policy JSON")
  .option("--state <path>", "trusted anti-rollback state", ".aiba/registry-state.json")
  .option("--version <version>", "resolve an exact semantic version")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: {
      registry: string;
      registryTrust: string;
      publisherTrust: string;
      state: string;
      version?: string;
      json?: boolean;
    },
  ) => {
    const result = await resolveRegistryCapability({
      registryDirectory: resolve(options.registry),
      registryTrustPolicyPath: resolve(options.registryTrust),
      publisherTrustPolicyPath: resolve(options.publisherTrust),
      statePath: resolve(options.state),
      capabilityId: capability,
      ...(options.version ? { version: options.version } : {}),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Resolved ${result.capability}@${result.version}.`,
      `Registry: ${result.registry} sequence ${result.sequence}`,
      `Publisher: ${result.publisher}/${result.keyId}`,
      `Bundle: ${result.bundleDirectory}`,
      `Pack: ${result.packDirectory}`,
      `Anti-rollback state: ${result.statePath}`,
    ].join("\n") + "\n");
  });

program
  .command("keygen")
  .description("Generate an Ed25519 capability publisher key pair")
  .argument("<publisher>", "publisher identifier")
  .requiredOption("--out <path>", "new key output directory")
  .option("--key-id <id>", "publisher key identifier", "root-1")
  .option("--json", "print machine-readable JSON")
  .action(async (
    publisher: string,
    options: { out: string; keyId: string; json?: boolean },
  ) => {
    const result = await generatePublisherKeyPair({
      publisherId: publisher,
      keyId: options.keyId,
      outputDirectory: resolve(options.out),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Generated Ed25519 key ${result.publisherId}/${result.keyId}.`,
      `Private key: ${result.privateKeyPath}`,
      `Public key: ${result.publicKeyPath}`,
    ].join("\n") + "\n");
  });

program
  .command("pack")
  .description("Create and sign a capability bundle")
  .argument("<capability>", "capability to package")
  .requiredOption("--publisher <id>", "publisher identifier")
  .requiredOption("--key-id <id>", "publisher key identifier")
  .requiredOption("--private-key <path>", "Ed25519 PKCS#8 private key")
  .requiredOption("--out <path>", "new bundle output directory")
  .option("--packs-dir <path>", "capability pack directory", "capabilities")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: {
      publisher: string;
      keyId: string;
      privateKey: string;
      out: string;
      packsDir: string;
      json?: boolean;
    },
  ) => {
    const result = await createCapabilityBundle({
      packsDirectory: resolve(options.packsDir),
      capabilityId: capability,
      outputDirectory: resolve(options.out),
      publisherId: options.publisher,
      keyId: options.keyId,
      privateKeyPath: resolve(options.privateKey),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Packed ${result.capability}@${result.version}.`,
      `Publisher: ${result.publisher}/${result.keyId}`,
      `Files: ${result.files}`,
      `Bundle: ${result.bundleDirectory}`,
      `Manifest SHA-256: ${result.manifestSha256}`,
    ].join("\n") + "\n");
  });

program
  .command("verify-bundle")
  .description("Verify a signed capability bundle against a local trust policy")
  .argument("<bundle>", "bundle directory")
  .requiredOption("--trust <path>", "publisher trust policy JSON")
  .option("--json", "print machine-readable JSON")
  .action(async (
    bundle: string,
    options: { trust: string; json?: boolean },
  ) => {
    const result = await verifyCapabilityBundle({
      bundleDirectory: resolve(bundle),
      trustPolicyPath: resolve(options.trust),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Verified ${result.capability}@${result.version}.`,
      `Publisher: ${result.publisher}/${result.keyId}`,
      `Files: ${result.files}`,
      `Manifest SHA-256: ${result.manifestSha256}`,
    ].join("\n") + "\n");
  });

program
  .command("init")
  .description("Initialize project-owned AIBA state")
  .argument("[root]", "project root", ".")
  .option("--json", "print machine-readable JSON")
  .action(async (root: string, options: { json?: boolean }) => {
    const result = await initializeProject(root);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      "AIBA project initialized.",
      `Manifest: ${result.manifestPath}`,
      `Lock: ${result.lockPath}`,
      `Receipts: ${result.receiptsPath}`,
    ].join("\n") + "\n");
  });

program
  .command("inspect")
  .description("Inspect an existing project without changing it")
  .argument("[root]", "project root", ".")
  .option("--json", "print machine-readable JSON")
  .option("--max-files <number>", "maximum files to inspect", "5000")
  .action(async (root: string, options: { json?: boolean; maxFiles: string }) => {
    const maximumFiles = Number.parseInt(options.maxFiles, 10);
    if (!Number.isSafeInteger(maximumFiles) || maximumFiles < 1) {
      throw new Error("--max-files must be a positive integer");
    }
    const report = await inspectProject(root, maximumFiles);
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : renderInspection(report)}\n`);
  });

program
  .command("add")
  .description("Prepare or finalize a capability installation")
  .argument("<capability>", "capability to install")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", "capabilities")
  .option("--recipe <id>", "select a capability recipe")
  .option("--agent <name>", "record the installing Agent")
  .option("--prepare", "prepare an operation plan (default)")
  .option("--finalize", "verify evidence and record the installation")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: {
      root: string;
      packsDir: string;
      recipe?: string;
      agent?: string;
      prepare?: boolean;
      finalize?: boolean;
      json?: boolean;
    },
  ) => {
    if (options.prepare && options.finalize) {
      throw new Error("--prepare and --finalize cannot be used together");
    }
    if (options.finalize && options.recipe) {
      throw new Error("--recipe is only valid while preparing an installation");
    }

    const projectRoot = resolve(options.root);
    const packsDirectory = resolve(options.packsDir);
    if (options.finalize) {
      const result = await finalizeCapability({
        projectRoot,
        packsDirectory,
        capabilityId: capability,
        ...(options.agent ? { agent: options.agent } : {}),
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write([
        `Installed ${result.capability}@${result.version}.`,
        `Receipt: ${result.receiptPath}`,
        `Hashed evidence entries: ${result.evidenceFiles}`,
      ].join("\n") + "\n");
      return;
    }

    const result = await prepareCapability({
      projectRoot,
      packsDirectory,
      capabilityId: capability,
      ...(options.recipe ? { recipeId: options.recipe } : {}),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Prepared ${result.plan.capability.id}@${result.plan.capability.version}.`,
      `Recipe: ${result.plan.recipe.id}@${result.plan.recipe.version}`,
      `Plan: ${result.planPath}`,
    ].join("\n") + "\n");
  });

program
  .command("upgrade")
  .description("Prepare or finalize a customization-aware capability upgrade")
  .argument("<capability>", "capability to upgrade")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "target capability pack directory", "capabilities")
  .option("--recipe <id>", "select a target capability recipe")
  .option("--agent <name>", "record the upgrading Agent")
  .option("--prepare", "prepare an upgrade plan (default)")
  .option("--finalize", "verify resolutions and record the upgrade")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string,
    options: {
      root: string;
      packsDir: string;
      recipe?: string;
      agent?: string;
      prepare?: boolean;
      finalize?: boolean;
      json?: boolean;
    },
  ) => {
    if (options.prepare && options.finalize) {
      throw new Error("--prepare and --finalize cannot be used together");
    }
    if (options.finalize && options.recipe) {
      throw new Error("--recipe is only valid while preparing an upgrade");
    }

    const projectRoot = resolve(options.root);
    const targetPacksDirectory = resolve(options.packsDir);
    if (options.finalize) {
      const result = await finalizeUpgrade({
        projectRoot,
        targetPacksDirectory,
        capabilityId: capability,
        ...(options.agent ? { agent: options.agent } : {}),
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write([
        `Upgraded ${result.capability} from ${result.fromVersion} to ${result.toVersion}.`,
        `Receipt: ${result.receiptPath}`,
        `Resolved conflicts: ${result.resolvedConflicts}`,
        `Hashed evidence entries: ${result.evidenceFiles}`,
      ].join("\n") + "\n");
      return;
    }

    const result = await prepareUpgrade({
      projectRoot,
      targetPacksDirectory,
      capabilityId: capability,
      ...(options.recipe ? { recipeId: options.recipe } : {}),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const conflicts = result.plan.drift.filter((file) => file.conflict !== "none").length;
    process.stdout.write([
      `Prepared ${result.plan.capability.id} upgrade from ${result.plan.capability.fromVersion} to ${result.plan.capability.toVersion}.`,
      `Migration: ${result.plan.migration.id}@${result.plan.migration.version}`,
      `Conflicts requiring resolution: ${conflicts}`,
      `Plan: ${result.planPath}`,
    ].join("\n") + "\n");
  });

program
  .command("diff")
  .description("Classify capability customization and source drift")
  .argument("[capability]", "inspect only one capability")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", "capabilities")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string | undefined,
    options: { root: string; packsDir: string; json?: boolean },
  ) => {
    const report = await diffProject({
      projectRoot: resolve(options.root),
      packsDirectory: resolve(options.packsDir),
      ...(capability ? { capabilityId: capability } : {}),
    });
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : renderDiff(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("verify")
  .description("Verify declared capabilities and provenance evidence")
  .argument("[capability]", "verify only one capability")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", "capabilities")
  .option("--json", "print machine-readable JSON")
  .action(async (
    capability: string | undefined,
    options: { root: string; packsDir: string; json?: boolean },
  ) => {
    const report = await verifyProject({
      projectRoot: resolve(options.root),
      packsDirectory: resolve(options.packsDir),
      ...(capability ? { capabilityId: capability } : {}),
    });
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : renderVerification(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`aiba: ${message}\n`);
  process.exitCode = 1;
});
