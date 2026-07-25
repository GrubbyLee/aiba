#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { Command } from "commander";
import { initializeProject, inspectProject, verifyProject } from "@aiba/core";
import { renderInspection, renderVerification } from "./render.js";

const program = new Command();

program
  .name("aiba")
  .description("Install, verify, trace, and upgrade application capabilities")
  .version("0.1.0");

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
