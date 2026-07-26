#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  finalizeCapability,
  finalizeUpgrade,
  createCapabilityBundle,
  diffProject,
  generatePublisherKeyPair,
  initializeProject,
  inspectProject,
  prepareCapability,
  prepareUpgrade,
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
