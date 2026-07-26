import type { ProjectDiffReport, ProjectInspection, VerificationReport } from "@aiba/core";

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
    report.ok ? "Verification passed." : "Verification failed.",
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
