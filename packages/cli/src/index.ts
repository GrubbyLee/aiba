#!/usr/bin/env node

import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  finalizeCapability,
  finalizeUpgrade,
  createCapabilityBundle,
  createCapabilityApproval,
  createRegistryIndex,
  checkSolution,
  advanceSolutionInstallation,
  createBehaviorProof,
  describeCatalogItem,
  discoverCatalog,
  diffProject,
  generatePublisherKeyPair,
  initializeProject,
  initializeGovernancePolicy,
  importRegistryBundle,
  inspectProject,
  prepareCapability,
  prepareBehaviorChallenge,
  prepareUpgrade,
  evaluateGovernance,
  fetchRegistryCapability,
  resolveRegistryCapability,
  verifyCapabilityBundle,
  verifyBehaviorProof,
  verifyProject,
} from "aiba-core";
import { createRegistryServer } from "aiba-registry-server";
import {
  renderDiff,
  renderCatalog,
  renderCatalogItem,
  renderInspection,
  renderSolutionCheck,
  renderSolutionInstall,
  renderVerification,
} from "./render.js";

const program = new Command();
const installedPacksDirectory = fileURLToPath(new URL("../capabilities", import.meta.url));
const installedSolutionsDirectory = fileURLToPath(new URL("../solutions", import.meta.url));

function packageVersion(): string {
  const value = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as unknown;
  if (
    typeof value !== "object"
    || value === null
    || !("version" in value)
    || typeof value.version !== "string"
  ) {
    throw new Error("AIBA package metadata has no valid version");
  }
  return value.version;
}

function defaultPacksDirectory(): string {
  return existsSync(installedPacksDirectory)
    ? installedPacksDirectory
    : resolve("capabilities");
}

function defaultSolutionsDirectory(): string {
  return existsSync(installedSolutionsDirectory)
    ? installedSolutionsDirectory
    : resolve("solutions");
}

program
  .name("aiba")
  .description("Install, verify, trace, and upgrade application capabilities")
  .version(packageVersion());

program
  .command("test")
  .description("Prepare a source-bound challenge for an external behavioral test")
  .argument("<subject>", "installed capability or Solution identifier")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
  .option("--solutions-dir <path>", "Solution definition directory", defaultSolutionsDirectory())
  .option("--solution", "treat the subject as a Solution")
  .requiredOption("--runner <id>", "trusted external runner identifier")
  .requiredOption("--key-id <id>", "runner signing key identifier")
  .requiredOption("--test-id <id>", "stable behavioral test identifier")
  .requiredOption("--command <command>", "exact external command to bind without executing")
  .option("--ttl <seconds>", "challenge lifetime", "900")
  .option("--json", "print machine-readable JSON")
  .action(async (
    subject: string,
    options: {
      root: string;
      packsDir: string;
      solutionsDir: string;
      solution?: boolean;
      runner: string;
      keyId: string;
      testId: string;
      command: string;
      ttl: string;
      json?: boolean;
    },
  ) => {
    const ttlSeconds = Number(options.ttl);
    const result = await prepareBehaviorChallenge({
      projectRoot: resolve(options.root),
      packsDirectory: resolve(options.packsDir),
      solutionsDirectory: resolve(options.solutionsDir),
      subjectKind: options.solution ? "solution" : "capability",
      subjectId: subject,
      runnerId: options.runner,
      keyId: options.keyId,
      testId: options.testId,
      command: options.command,
      ttlSeconds,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Prepared behavior challenge for ${result.challenge.subject.kind} ${subject}@${result.challenge.subject.version}.`,
      `Runner: ${result.challenge.runner.id}/${result.challenge.runner.keyId}`,
      `Expires: ${result.challenge.metadata.expiresAt}`,
      `Challenge: ${result.challengePath}`,
      "Run the bound command externally, save its summary, then use aiba attest.",
    ].join("\n") + "\n");
  });

program
  .command("attest")
  .description("Sign a successful external behavioral test result")
  .argument("<challenge>", "project-relative challenge JSON path")
  .option("--root <path>", "project root", ".")
  .requiredOption("--private-key <path>", "trusted runner Ed25519 PKCS#8 private key")
  .requiredOption("--started-at <date-time>", "test start time")
  .requiredOption("--completed-at <date-time>", "test completion time")
  .requiredOption("--exit-code <number>", "test process exit code")
  .requiredOption("--summary <path>", "project-relative test summary file")
  .option("--json", "print machine-readable JSON")
  .action(async (
    challenge: string,
    options: {
      root: string;
      privateKey: string;
      startedAt: string;
      completedAt: string;
      exitCode: string;
      summary: string;
      json?: boolean;
    },
  ) => {
    const result = await createBehaviorProof({
      projectRoot: resolve(options.root),
      challengePath: challenge,
      privateKeyPath: resolve(options.privateKey),
      startedAt: options.startedAt,
      completedAt: options.completedAt,
      exitCode: Number(options.exitCode),
      summaryPath: options.summary,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `Attested successful test ${result.proof.statement.test.id}.`,
      `Snapshot: ${result.proof.statement.project.snapshotSha256}`,
      `Proof: ${result.proofPath}`,
    ].join("\n") + "\n");
  });

program
  .command("verify-behavior")
  .description("Verify a signed behavioral proof against current project state")
  .argument("<proof>", "project-relative behavior proof JSON path")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
  .option("--solutions-dir <path>", "Solution definition directory", defaultSolutionsDirectory())
  .requiredOption("--trust <path>", "runner trust policy JSON")
  .requiredOption("--command <command>", "exact command used by the external runner")
  .requiredOption("--summary <path>", "project-relative test summary file")
  .option("--json", "print machine-readable JSON")
  .action(async (
    proof: string,
    options: {
      root: string;
      packsDir: string;
      solutionsDir: string;
      trust: string;
      command: string;
      summary: string;
      json?: boolean;
    },
  ) => {
    const report = await verifyBehaviorProof({
      projectRoot: resolve(options.root),
      packsDirectory: resolve(options.packsDir),
      solutionsDirectory: resolve(options.solutionsDir),
      proofPath: proof,
      trustPolicyPath: resolve(options.trust),
      command: options.command,
      summaryPath: options.summary,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write([
        `Trusted behavior: ${report.ok ? "ok" : "failed"}`,
        `Subject: ${report.subject.id}@${report.subject.version}`,
        `Runner: ${report.runner.id}/${report.runner.keyId}`,
        `Test: ${report.test}`,
        ...report.issues.map((issue) => `${issue.code}: ${issue.message}`),
      ].join("\n") + "\n");
    }
    if (!report.ok) process.exitCode = 1;
  });

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
  .command("registry-add")
  .description("Import a verified signed bundle into a local registry")
  .argument("<bundle-directory>", "signed capability bundle directory")
  .requiredOption("--registry <path>", "local registry directory")
  .requiredOption("--publisher-trust <path>", "capability publisher trust policy JSON")
  .option("--json", "print machine-readable JSON")
  .action(async (
    bundleDirectory: string,
    options: { registry: string; publisherTrust: string; json?: boolean },
  ) => {
    const result = await importRegistryBundle({
      registryDirectory: resolve(options.registry),
      bundleDirectory: resolve(bundleDirectory),
      publisherTrustPolicyPath: resolve(options.publisherTrust),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      `${result.imported ? "Imported" : "Already present"}: ${result.capability}@${result.version}.`,
      `Publisher: ${result.publisher}/${result.keyId}`,
      `Bundle: ${result.bundleDirectory}`,
      `Manifest SHA-256: ${result.manifestSha256}`,
    ].join("\n") + "\n");
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
  .command("registry-serve")
  .description("Serve a verified registry through the authenticated v0 read API")
  .argument("<registry-directory>", "local registry directory")
  .requiredOption("--registry-trust <path>", "registry signer trust policy JSON")
  .requiredOption("--publisher-trust <path>", "capability publisher trust policy JSON")
  .option("--token-env <name>", "environment variable containing the read token", "AIBA_REGISTRY_TOKEN")
  .option("--host <host>", "listen host", "127.0.0.1")
  .option("--port <number>", "listen port", "7331")
  .option("--tls-cert <path>", "TLS certificate PEM")
  .option("--tls-key <path>", "TLS private key PEM")
  .option("--allow-insecure-localhost", "allow HTTP on a loopback host")
  .option("--json", "print machine-readable startup state")
  .action(async (
    registryDirectory: string,
    options: {
      registryTrust: string;
      publisherTrust: string;
      tokenEnv: string;
      host: string;
      port: string;
      tlsCert?: string;
      tlsKey?: string;
      allowInsecureLocalhost?: boolean;
      json?: boolean;
    },
  ) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(options.tokenEnv)) {
      throw new Error("--token-env must be an uppercase environment variable name");
    }
    const token = process.env[options.tokenEnv];
    if (!token) throw new Error(`registry token is missing in ${options.tokenEnv}`);
    const port = Number(options.port);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
      throw new Error("--port must be an integer between 0 and 65535");
    }
    const hasTls = options.tlsCert !== undefined || options.tlsKey !== undefined;
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(options.host);
    if (!hasTls && !(options.allowInsecureLocalhost && loopback)) {
      throw new Error("HTTP requires --allow-insecure-localhost and a loopback --host");
    }
    const created = await createRegistryServer({
      registryDirectory: resolve(registryDirectory),
      registryTrustPolicyPath: resolve(options.registryTrust),
      publisherTrustPolicyPath: resolve(options.publisherTrust),
      token,
      ...(options.tlsCert ? { tlsCertificatePath: resolve(options.tlsCert) } : {}),
      ...(options.tlsKey ? { tlsPrivateKeyPath: resolve(options.tlsKey) } : {}),
    });
    await new Promise<void>((resolvePromise, reject) => {
      created.server.once("error", reject);
      created.server.listen(port, options.host, resolvePromise);
    });
    const address = created.server.address();
    const actualPort = address && typeof address !== "string" ? address.port : port;
    const started = {
      ...created.snapshot,
      secure: created.secure,
      host: options.host,
      port: actualPort,
    };
    process.stdout.write(`${options.json
      ? JSON.stringify(started)
      : `Serving ${started.registry} sequence ${started.sequence} on ${created.secure ? "https" : "http"}://${options.host}:${actualPort}`
    }\n`);
    await new Promise<void>((resolvePromise) => {
      let closing = false;
      const close = (): void => {
        if (closing) return;
        closing = true;
        created.server.close(() => resolvePromise());
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
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
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
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
  .command("list")
  .description("List verified capabilities and industry Solutions")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
  .option("--solutions-dir <path>", "solution definition directory", defaultSolutionsDirectory())
  .option("--json", "print machine-readable JSON")
  .action(async (options: {
    packsDir: string;
    solutionsDir: string;
    json?: boolean;
  }) => {
    const catalog = await discoverCatalog({
      packsDirectory: resolve(options.packsDir),
      solutionsDirectory: resolve(options.solutionsDir),
    });
    process.stdout.write(
      `${options.json ? JSON.stringify(catalog, null, 2) : renderCatalog(catalog)}\n`,
    );
  });

program
  .command("show")
  .description("Show a verified capability or industry Solution")
  .argument("<id>", "capability or Solution identifier")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
  .option("--solutions-dir <path>", "solution definition directory", defaultSolutionsDirectory())
  .option("--json", "print machine-readable JSON")
  .action(async (
    id: string,
    options: { packsDir: string; solutionsDir: string; json?: boolean },
  ) => {
    const item = await describeCatalogItem({
      id,
      packsDirectory: resolve(options.packsDir),
      solutionsDirectory: resolve(options.solutionsDir),
    });
    process.stdout.write(
      `${options.json ? JSON.stringify(item, null, 2) : renderCatalogItem(item)}\n`,
    );
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
  .description("Prepare or finalize a capability or guided Solution installation")
  .argument("<target>", "capability or Solution to install")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
  .option("--solutions-dir <path>", "solution definition directory", defaultSolutionsDirectory())
  .option("--solution", "install an exact Solution one capability at a time")
  .option("--recipe <id>", "select a capability recipe")
  .option("--agent <name>", "record the installing Agent")
  .option("--prepare", "prepare an operation plan (default)")
  .option("--finalize", "verify evidence and record the installation")
  .option("--json", "print machine-readable JSON")
  .action(async (
    target: string,
    options: {
      root: string;
      packsDir: string;
      solutionsDir: string;
      solution?: boolean;
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
    if (options.solution) {
      const result = await advanceSolutionInstallation({
        solutionId: target,
        projectRoot,
        packsDirectory,
        solutionsDirectory: resolve(options.solutionsDir),
        mode: options.finalize ? "finalize" : "prepare",
        ...(options.recipe ? { recipeId: options.recipe } : {}),
        ...(options.agent ? { agent: options.agent } : {}),
      });
      process.stdout.write(
        `${options.json ? JSON.stringify(result, null, 2) : renderSolutionInstall(result)}\n`,
      );
      return;
    }
    if (options.finalize) {
      const result = await finalizeCapability({
        projectRoot,
        packsDirectory,
        capabilityId: target,
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
      capabilityId: target,
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
  .option("--packs-dir <path>", "target capability pack directory", defaultPacksDirectory())
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
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
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
  .command("compose")
  .description("Check whether a project satisfies an exact capability solution")
  .argument("<solution>", "solution to check")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
  .option("--solutions-dir <path>", "solution definition directory", defaultSolutionsDirectory())
  .option("--json", "print machine-readable JSON")
  .action(async (
    solution: string,
    options: {
      root: string;
      packsDir: string;
      solutionsDir: string;
      json?: boolean;
    },
  ) => {
    const report = await checkSolution({
      solutionId: solution,
      projectRoot: resolve(options.root),
      packsDirectory: resolve(options.packsDir),
      solutionsDirectory: resolve(options.solutionsDir),
    });
    process.stdout.write(
      `${options.json ? JSON.stringify(report, null, 2) : renderSolutionCheck(report)}\n`,
    );
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("verify")
  .description("Verify declared capabilities and provenance evidence")
  .argument("[capability]", "verify only one capability")
  .option("--root <path>", "project root", ".")
  .option("--packs-dir <path>", "capability pack directory", defaultPacksDirectory())
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
