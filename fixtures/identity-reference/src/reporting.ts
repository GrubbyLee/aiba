import type { ReportRunCommand, ReportRunRecord } from "aiba-spec";

export interface ReportingContext { tenantId: string; principalId: string; correlationId: string }
export interface ReportDefinition { id: string; enabled: boolean; formats: ReportRunCommand["format"][]; parameterKeys: string[]; outputFields: string[]; maximumRows: number; timeoutMs: number }
interface StoredReport extends ReportRunRecord { tenantId: string; parameters: ReportRunCommand["parameters"]; fingerprint: string }
export interface ReportingDependencies {
  loadDefinition: (id: string) => Promise<ReportDefinition | undefined>;
  authorize: (context: ReportingContext, definitionId: string) => Promise<boolean>;
  execute: (input: { tenantId: string; definitionId: string; parameters: ReportRunCommand["parameters"]; signal: AbortSignal }) => Promise<Record<string, unknown>[]>;
  storePrivateOutput: (input: { tenantId: string; reportId: string; format: ReportRunCommand["format"]; rows: Record<string, unknown>[] }) => Promise<string>;
  audit: (event: { action: string; outcome: string; reasonCode?: string; correlationId: string }) => void;
  now: () => Date;
  reportId: () => string;
}
function publicRecord(report: StoredReport): ReportRunRecord { const { tenantId: _tenant, parameters: _parameters, fingerprint: _fingerprint, ...record } = report; return record; }

export function createReportingService(dependencies: ReportingDependencies) {
  const reports = new Map<string, StoredReport>();
  const idempotency = new Map<string, string>();
  async function request(context: ReportingContext, command: ReportRunCommand): Promise<ReportRunRecord> {
    const definition = await dependencies.loadDefinition(command.definitionId);
    if (!definition?.enabled || !definition.formats.includes(command.format) || definition.maximumRows < 1 || definition.maximumRows > 1_000_000
      || definition.timeoutMs < 1 || definition.timeoutMs > 300_000 || Object.keys(command.parameters).some((key) => !definition.parameterKeys.includes(key))
      || !await dependencies.authorize(context, command.definitionId)) throw new Error("report-unavailable");
    const key = `${context.tenantId}:${command.idempotencyKey}`;
    const fingerprint = JSON.stringify(command);
    const priorId = idempotency.get(key);
    if (priorId) { const prior = reports.get(priorId)!; if (prior.fingerprint !== fingerprint) throw new Error("idempotency-conflict"); return publicRecord(prior); }
    const report: StoredReport = { reportId: dependencies.reportId(), definitionId: definition.id, format: command.format, status: "queued", createdAt: dependencies.now().toISOString(), tenantId: context.tenantId, parameters: { ...command.parameters }, fingerprint };
    reports.set(report.reportId, report); idempotency.set(key, report.reportId);
    dependencies.audit({ action: "reporting:request", outcome: "succeeded", correlationId: context.correlationId });
    return publicRecord(report);
  }
  async function run(reportId: string): Promise<ReportRunRecord> {
    const report = reports.get(reportId);
    if (!report || report.status !== "queued") throw new Error("report-not-runnable");
    const definition = await dependencies.loadDefinition(report.definitionId);
    if (!definition?.enabled) throw new Error("report-not-runnable");
    report.status = "running";
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, definition.timeoutMs); });
      const rows = await Promise.race([dependencies.execute({ tenantId: report.tenantId, definitionId: report.definitionId, parameters: { ...report.parameters }, signal: controller.signal }), timeout]);
      if (rows.length > definition.maximumRows) throw new Error("row-limit");
      const projected = rows.map((row) => Object.fromEntries(definition.outputFields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])));
      report.assetId = await dependencies.storePrivateOutput({ tenantId: report.tenantId, reportId: report.reportId, format: report.format, rows: projected });
      report.rowCount = projected.length; report.status = "succeeded";
    } catch (error) {
      report.status = "failed";
      report.errorCode = error instanceof Error && error.message === "timeout" ? "execution-timeout" : error instanceof Error && error.message === "row-limit" ? "row-limit-exceeded" : "execution-failed";
    } finally { if (timer) clearTimeout(timer); report.completedAt = dependencies.now().toISOString(); }
    return publicRecord(report);
  }
  return { request, run };
}
