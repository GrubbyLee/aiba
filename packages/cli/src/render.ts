import type { ProjectInspection, VerificationReport } from "@aiba/core";

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
