import type {
  CatalogDiscovery,
  CatalogItemDetails,
  ProjectDiffReport,
  ProjectInspection,
  SolutionCheckReport,
  SolutionInstallResult,
  VerificationReport,
} from "aiba-core";

const capabilityLayers = [
  "application-foundation",
  "platform-integration",
  "business-capability",
  "engineering-governance",
] as const;

export function renderCatalog(catalog: CatalogDiscovery): string {
  const lines = ["Verified AIBA catalog"];
  for (const layer of capabilityLayers) {
    const capabilities = catalog.capabilities.filter((item) => item.layer === layer);
    if (capabilities.length === 0) continue;
    lines.push("", `${layer}:`);
    for (const capability of capabilities) {
      lines.push(
        `  ${capability.id}@${capability.version} - ${capability.title}`,
        `    ${capability.invariants} invariants`
          + `${capability.dependencies.length > 0 ? `; requires ${capability.dependencies.join(", ")}` : ""}`,
      );
    }
  }
  if (catalog.solutions.length > 0) {
    lines.push("", "application-solution:");
    for (const solution of catalog.solutions) {
      lines.push(
        `  ${solution.id}@${solution.version} - ${solution.title}`,
        `    ${solution.capabilities.length} exact capabilities`,
      );
    }
  }
  return lines.join("\n");
}

export function renderCatalogItem(item: CatalogItemDetails): string {
  const lines = [
    `${item.title} (${item.id}@${item.version})`,
    `Kind: ${item.kind}`,
    `Layer: ${item.layer}`,
    item.description,
  ];
  if (item.kind === "solution") {
    lines.push("", "Capabilities:");
    for (const capability of item.capabilityDetails) {
      lines.push(
        `  ${capability.id}@${capability.version}`,
        `    ${capability.purpose}`,
      );
    }
    return lines.join("\n");
  }
  lines.push(
    "",
    `Interfaces: ${item.interfaces.length > 0 ? item.interfaces.join(", ") : "none"}`,
    "Dependencies:",
  );
  if (item.dependencyDetails.length === 0) lines.push("  none");
  for (const dependency of item.dependencyDetails) {
    lines.push(
      `  ${dependency.id}@${dependency.version}${dependency.optional ? " (optional)" : ""}`,
    );
  }
  lines.push("", "Invariants:");
  for (const invariant of item.invariantDetails) {
    lines.push(`  [${invariant.severity}] ${invariant.id} - ${invariant.title}`);
  }
  return lines.join("\n");
}

export function renderInspection(report: ProjectInspection): string {
  const lines = [
    `Project: ${report.name}`,
    `Root: ${report.root}`,
    `Package manager: ${report.packageManager}`,
    `Languages: ${report.languages.length > 0
      ? report.languages.map((language) => `${language.name} (${language.files})`).join(", ")
      : "none detected"}`,
    `Frameworks: ${report.frameworks.length > 0 ? report.frameworks.join(", ") : "none detected"}`,
    `AIBA state: ${report.aiba.initialized ? "initialized" : "not initialized"}`,
    `Files scanned: ${report.filesScanned}${report.truncated ? " (limit reached)" : ""}`,
  ];
  return lines.join("\n");
}

export function renderVerification(report: VerificationReport): string {
  const lines = [
    report.ok
      ? "Evidence and provenance verification passed."
      : "Evidence and provenance verification failed.",
    `Scope: ${report.scope}`,
    `Project: ${report.projectRoot}`,
  ];
  if (report.verifiedCapabilities.length > 0) {
    lines.push(`Verified capabilities: ${report.verifiedCapabilities.join(", ")}`);
  }
  if (report.issues.length === 0) {
    lines.push("Issues: none");
  } else {
    lines.push("Issues:");
    for (const issue of report.issues) {
      const context = [issue.capability, issue.invariant, issue.path]
        .filter(Boolean)
        .join(" / ");
      lines.push(
        `  ${issue.level === "error" ? "ERROR" : "WARN"} ${issue.code}`
        + `${context ? ` [${context}]` : ""}: ${issue.message}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderSolutionCheck(report: SolutionCheckReport): string {
  const lines = [
    report.ok
      ? "Solution evidence and provenance verification passed."
      : "Solution evidence and provenance verification failed.",
    `Scope: ${report.scope}`,
    `Solution: ${report.solution.id}@${report.solution.version}`,
    `Project: ${report.projectRoot}`,
    `Installation order: ${report.installationOrder.join(" -> ")}`,
  ];
  if (report.missingCapabilities.length > 0) {
    lines.push(`Missing capabilities: ${report.missingCapabilities.join(", ")}`);
  }
  for (const capability of report.capabilities) {
    lines.push(
      `${capability.verified ? "PASS" : "FAIL"} ${capability.id}@${capability.version}`,
    );
    for (const issue of capability.issues) {
      lines.push(`  ${issue.level === "error" ? "ERROR" : "WARN"} ${issue.code}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function renderSolutionInstall(result: SolutionInstallResult): string {
  const lines = [
    `Solution: ${result.solution.id}@${result.solution.version}`,
    `Progress: ${result.progress.completed}/${result.progress.total}`,
  ];
  const current = result.currentCapability;
  const quote = (value: string): string => /^[A-Za-z0-9_./:@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
  const baseCommand = [
    "aiba",
    "add",
    quote(result.solution.id),
    "--solution",
    "--root",
    quote(result.projectRoot),
    "--packs-dir",
    quote(result.packsDirectory),
    "--solutions-dir",
    quote(result.solutionsDirectory),
  ].join(" ");
  if (result.status === "prepared" && current) {
    lines.push(
      `Prepared ${current.index}/${result.progress.total}: ${current.id}@${current.version}.`,
      `Plan: ${result.planPath}`,
      `Next: implement the plan, add evidence, then run ${baseCommand} --finalize`,
    );
  } else if (result.status === "awaiting-finalization" && current) {
    lines.push(
      `Awaiting finalization ${current.index}/${result.progress.total}: ${current.id}@${current.version}.`,
      `Plan: ${result.planPath}`,
      `Next: run ${baseCommand} --finalize`,
    );
  } else if (result.status === "finalized" && current) {
    lines.push(
      `Installed ${current.index}/${result.progress.total}: ${current.id}@${current.version}.`,
      `Receipt: ${result.finalization?.receiptPath}`,
      `Next: ${baseCommand}`,
    );
  } else {
    lines.push(
      "Solution installation evidence verified.",
      `Verification scope: ${result.verification?.scope ?? "not available"}`,
    );
  }
  if (result.remainingCapabilities.length > 0) {
    lines.push(`Remaining: ${result.remainingCapabilities.join(", ")}`);
  }
  return lines.join("\n");
}

export function renderDiff(report: ProjectDiffReport): string {
  const lines = [
    report.hasDrift ? "Capability drift detected." : "No capability drift detected.",
    `Project: ${report.projectRoot}`,
  ];
  for (const capability of report.capabilities) {
    lines.push(
      `${capability.id}@${capability.version} (${capability.ancestry} ancestry)`,
      `  sources: capability=${capability.sources.capability}`
        + `${capability.sources.recipe ? ` recipe=${capability.sources.recipe}` : ""}`,
    );
    for (const file of capability.files) {
      lines.push(`  ${file.status.toUpperCase()} [${file.ownership}] ${file.path}`);
    }
  }
  for (const issue of report.issues) {
    lines.push(`ERROR ${issue.code}${issue.capability ? ` [${issue.capability}]` : ""}: ${issue.message}`);
  }
  return lines.join("\n");
}
