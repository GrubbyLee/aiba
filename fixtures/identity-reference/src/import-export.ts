import { createHash, randomUUID } from "node:crypto";
import type {
  AuthorizationDecision,
  DataExportCommand,
  DataImportCommand,
  ImportExportJobRecord,
  Principal,
} from "aiba-spec";
import type { AuditContext } from "./audit.js";

type DataScalar = string | number | boolean | null;
export type ImportedRow = Record<string, Exclude<DataScalar, null>>;

export interface ImportField {
  name: string;
  type: "string" | "integer" | "boolean";
  required: boolean;
  maxLength?: number;
}

export interface ImportProfile {
  id: string;
  enabled: boolean;
  contentType: "text/csv" | "application/jsonl";
  maxSourceBytes: number;
  maxRows: number;
  fields: ImportField[];
  uniqueKey?: string;
}

export interface ExportField {
  name: string;
  heading: string;
}

export interface ExportProfile {
  id: string;
  enabled: boolean;
  format: "csv";
  maxRows: number;
  maxCellLength: number;
  fields: ExportField[];
}

export interface ImportExportProfileDirectory {
  loadImport(tenantId: string, profileId: string): Promise<ImportProfile | undefined>;
  loadExport(tenantId: string, profileId: string): Promise<ExportProfile | undefined>;
}

export interface ImportAssetData {
  assetId: string;
  tenantId: string;
  status: "available" | "quarantined" | "rejected" | "deleted";
  contentType: string;
  sizeBytes: number;
  rows: unknown[];
}

export interface ImportAssetReader {
  read(tenantId: string, assetId: string, maxBytes: number): Promise<ImportAssetData | undefined>;
}

export interface AtomicImportWriter {
  commit(
    input: { tenantId: string; profileId: string; rows: ImportedRow[] },
    recordAudit: () => Promise<void>,
  ): Promise<void>;
}

export interface ExportRow {
  tenantId: string;
  values: Record<string, DataScalar>;
}

export interface ExportDataSource {
  read(tenantId: string, profileId: string, maxRows: number): Promise<ExportRow[]>;
}

export interface PrivateExchangeResult {
  assetId: string;
  tenantId: string;
  status: "available";
}

export interface PrivateExchangeWriter {
  write(input: {
    tenantId: string;
    contentType: "text/csv";
    bytes: Uint8Array;
  }): Promise<PrivateExchangeResult>;
  remove(tenantId: string, assetId: string): Promise<void>;
}

export interface ImportExportJobGate {
  execute(
    scopedKey: string,
    fingerprint: string,
    operation: () => Promise<ImportExportJobRecord>,
  ): Promise<ImportExportJobRecord>;
}

export interface ImportExportAuthorizer {
  decide(
    context: { principal: Principal; correlationId: string },
    input:
      | {
        action: "data:import" | "data:export";
        resource: { type: "data-exchange-profile"; id: string; tenantId: string };
      }
      | {
        action: "file-assets:read";
        resource: { type: "file-asset"; id: string; tenantId: string };
      },
  ): Promise<AuthorizationDecision>;
}

export interface ImportExportAudit {
  record(
    context: AuditContext,
    input: {
      action: "data:import" | "data:export";
      outcome: "succeeded" | "failed";
      reasonCode: string;
      target: { type: "data-exchange-job"; id: string; tenantId: string };
    },
  ): Promise<unknown>;
}

export interface ImportExportDependencies {
  authorization: ImportExportAuthorizer;
  audit: ImportExportAudit;
  profiles: ImportExportProfileDirectory;
  importAssets: ImportAssetReader;
  imports: AtomicImportWriter;
  exportSource: ExportDataSource;
  exportResults: PrivateExchangeWriter;
  jobs: ImportExportJobGate;
  now?: () => Date;
  jobId?: () => string;
}

export interface ImportExportContext {
  principal: Principal;
  correlationId: string;
}

export class ImportExportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "forbidden"
      | "idempotency-conflict"
      | "invalid-request"
      | "limit-exceeded"
      | "operation-failed"
      | "profile-unavailable"
      | "source-unavailable"
      | "validation-failed",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "ImportExportError";
  }
}

const PROFILE_ID = /^[a-z][a-z0-9-]{1,95}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_FIELDS = new Set(["constructor", "prototype", "__proto__"]);

function object(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 255;
}

function parseImportCommand(value: unknown): DataImportCommand | undefined {
  const input = object(value);
  if (
    !input
    || !hasExactKeys(input, ["idempotencyKey", "profileId", "sourceAssetId"])
    || typeof input.profileId !== "string"
    || !PROFILE_ID.test(input.profileId)
    || typeof input.sourceAssetId !== "string"
    || input.sourceAssetId.length < 16
    || input.sourceAssetId.length > 255
    || !validIdempotencyKey(input.idempotencyKey)
  ) return undefined;
  return {
    profileId: input.profileId,
    sourceAssetId: input.sourceAssetId,
    idempotencyKey: input.idempotencyKey,
  };
}

function parseExportCommand(value: unknown): DataExportCommand | undefined {
  const input = object(value);
  if (
    !input
    || !hasExactKeys(input, ["idempotencyKey", "profileId"])
    || typeof input.profileId !== "string"
    || !PROFILE_ID.test(input.profileId)
    || !validIdempotencyKey(input.idempotencyKey)
  ) return undefined;
  return { profileId: input.profileId, idempotencyKey: input.idempotencyKey };
}

function validContext(context: ImportExportContext): context is ImportExportContext & {
  principal: Principal & { tenantId: string };
} {
  return typeof context.principal.tenantId === "string"
    && context.principal.tenantId.length > 0
    && context.principal.tenantId.length <= 255
    && typeof context.principal.subject === "string"
    && context.principal.subject.length > 0
    && typeof context.correlationId === "string"
    && context.correlationId.length >= 8
    && context.correlationId.length <= 255;
}

function validFieldName(value: string): boolean {
  return FIELD_NAME.test(value) && !FORBIDDEN_FIELDS.has(value);
}

function validImportProfile(profile: ImportProfile, expectedId: string): boolean {
  if (
    profile.id !== expectedId
    || !profile.enabled
    || !["text/csv", "application/jsonl"].includes(profile.contentType)
    || !Number.isSafeInteger(profile.maxSourceBytes)
    || profile.maxSourceBytes < 1
    || profile.maxSourceBytes > 5_368_709_120
    || !Number.isSafeInteger(profile.maxRows)
    || profile.maxRows < 1
    || profile.maxRows > 10_000_000
    || !Array.isArray(profile.fields)
    || profile.fields.length < 1
    || profile.fields.length > 100
  ) return false;
  const names = new Set<string>();
  for (const field of profile.fields) {
    if (
      !validFieldName(field.name)
      || names.has(field.name)
      || !["string", "integer", "boolean"].includes(field.type)
      || typeof field.required !== "boolean"
      || (field.type === "string" && (
        !Number.isSafeInteger(field.maxLength)
        || (field.maxLength as number) < 1
        || (field.maxLength as number) > 100_000
      ))
      || (field.type !== "string" && field.maxLength !== undefined)
    ) return false;
    names.add(field.name);
  }
  return profile.uniqueKey === undefined
    || (validFieldName(profile.uniqueKey) && names.has(profile.uniqueKey));
}

function validExportProfile(profile: ExportProfile, expectedId: string): boolean {
  if (
    profile.id !== expectedId
    || !profile.enabled
    || profile.format !== "csv"
    || !Number.isSafeInteger(profile.maxRows)
    || profile.maxRows < 1
    || profile.maxRows > 10_000_000
    || !Number.isSafeInteger(profile.maxCellLength)
    || profile.maxCellLength < 1
    || profile.maxCellLength > 100_000
    || !Array.isArray(profile.fields)
    || profile.fields.length < 1
    || profile.fields.length > 100
  ) return false;
  const names = new Set<string>();
  return profile.fields.every((field) => {
    if (
      !validFieldName(field.name)
      || names.has(field.name)
      || typeof field.heading !== "string"
      || field.heading.length < 1
      || field.heading.length > 255
    ) return false;
    names.add(field.name);
    return true;
  });
}

function validateRows(profile: ImportProfile, rows: unknown[]): ImportedRow[] {
  if (rows.length > profile.maxRows) {
    throw new ImportExportError("Import row limit exceeded", "limit-exceeded");
  }
  const allowed = new Set(profile.fields.map(({ name }) => name));
  const unique = new Set<string>();
  return rows.map((value) => {
    const row = object(value);
    if (!row || Object.keys(row).some((key) => !allowed.has(key))) {
      throw new ImportExportError("Import row validation failed", "validation-failed");
    }
    const entries: Array<[string, Exclude<DataScalar, null>]> = [];
    for (const field of profile.fields) {
      const cell = row[field.name];
      if (cell === undefined || cell === null || cell === "") {
        if (field.required) {
          throw new ImportExportError("Import row validation failed", "validation-failed");
        }
        continue;
      }
      if (
        (field.type === "string"
          && (typeof cell !== "string" || cell.length > (field.maxLength as number)))
        || (field.type === "integer" && (!Number.isSafeInteger(cell)))
        || (field.type === "boolean" && typeof cell !== "boolean")
      ) throw new ImportExportError("Import row validation failed", "validation-failed");
      entries.push([field.name, cell as Exclude<DataScalar, null>]);
    }
    const validated = Object.fromEntries(entries) as ImportedRow;
    if (profile.uniqueKey) {
      const key = validated[profile.uniqueKey];
      if (key === undefined) {
        throw new ImportExportError("Import row validation failed", "validation-failed");
      }
      const fingerprint = `${typeof key}:${String(key)}`;
      if (unique.has(fingerprint)) {
        throw new ImportExportError("Import unique key is duplicated", "validation-failed");
      }
      unique.add(fingerprint);
    }
    return validated;
  });
}

function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: DataScalar, maxLength: number): string {
  const text = value === null ? "" : String(value);
  if (text.length > maxLength) {
    throw new ImportExportError("Export cell limit exceeded", "limit-exceeded");
  }
  return `"${neutralizeFormula(text).replaceAll('"', '""')}"`;
}

function encodeCsv(profile: ExportProfile, rows: ExportRow[], tenantId: string): Uint8Array {
  if (rows.length > profile.maxRows) {
    throw new ImportExportError("Export row limit exceeded", "limit-exceeded");
  }
  const lines = [profile.fields.map((field) => csvCell(field.heading, 255)).join(",")];
  for (const row of rows) {
    if (row.tenantId !== tenantId || !object(row.values)) {
      throw new ImportExportError("Export source crossed tenant policy", "operation-failed");
    }
    lines.push(profile.fields.map((field) =>
      csvCell(row.values[field.name] ?? null, profile.maxCellLength)).join(","));
  }
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

function fingerprint(operation: "import" | "export", command: DataImportCommand | DataExportCommand) {
  return createHash("sha256").update(JSON.stringify({ operation, ...command }), "utf8").digest("hex");
}

export function createImportExportService(dependencies: ImportExportDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const nextJobId = dependencies.jobId ?? randomUUID;

  function createJobId(): string {
    const id = nextJobId();
    if (typeof id !== "string" || id.length < 16 || id.length > 255) {
      throw new ImportExportError("Data exchange job identifier is invalid", "operation-failed");
    }
    return id;
  }

  async function authorize(
    context: ImportExportContext & { principal: Principal & { tenantId: string } },
    action: "data:import" | "data:export",
    profileId: string,
  ): Promise<void> {
    const resource = {
      type: "data-exchange-profile" as const,
      id: profileId,
      tenantId: context.principal.tenantId,
    };
    const decision = await dependencies.authorization.decide(context, { action, resource });
    if (
      !decision.allowed
      || decision.action !== action
      || decision.resource.type !== resource.type
      || decision.resource.id !== resource.id
      || decision.resource.tenantId !== resource.tenantId
      || decision.principal.type !== context.principal.type
      || decision.principal.subject !== context.principal.subject
      || decision.principal.tenantId !== context.principal.tenantId
    ) throw new ImportExportError("Data exchange is forbidden", "forbidden");
  }

  async function authorizeImportSource(
    context: ImportExportContext & { principal: Principal & { tenantId: string } },
    assetId: string,
  ): Promise<void> {
    const resource = {
      type: "file-asset" as const,
      id: assetId,
      tenantId: context.principal.tenantId,
    };
    const decision = await dependencies.authorization.decide(context, {
      action: "file-assets:read",
      resource,
    });
    if (
      !decision.allowed
      || decision.action !== "file-assets:read"
      || decision.resource.type !== resource.type
      || decision.resource.id !== resource.id
      || decision.resource.tenantId !== resource.tenantId
      || decision.principal.type !== context.principal.type
      || decision.principal.subject !== context.principal.subject
      || decision.principal.tenantId !== context.principal.tenantId
    ) throw new ImportExportError("Import source access is forbidden", "forbidden");
  }

  async function audit(
    context: ImportExportContext & { principal: Principal & { tenantId: string } },
    action: "data:import" | "data:export",
    id: string,
    outcome: "succeeded" | "failed",
    reasonCode: string,
  ): Promise<void> {
    await dependencies.audit.record({
      actor: context.principal,
      correlationId: context.correlationId,
    }, {
      action,
      outcome,
      reasonCode,
      target: { type: "data-exchange-job", id, tenantId: context.principal.tenantId },
    });
  }

  function scopedKey(tenantId: string, operation: "import" | "export", key: string): string {
    return createHash("sha256").update(`${tenantId}\0${operation}\0${key}`, "utf8").digest("hex");
  }

  function mapFailure(error: unknown, operation: "import" | "export"): never {
    if (error instanceof ImportExportError) throw error;
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "IDEMPOTENCY_CONFLICT") {
      throw new ImportExportError(
        `Idempotency key is bound to another ${operation}`,
        "idempotency-conflict",
      );
    }
    throw new ImportExportError(`Data ${operation} failed`, "operation-failed", { cause: error });
  }

  async function runImport(
    context: ImportExportContext,
    input: unknown,
  ): Promise<ImportExportJobRecord> {
    const command = parseImportCommand(input);
    if (!validContext(context) || !command) {
      throw new ImportExportError("Data import request is invalid", "invalid-request");
    }
    await authorize(context, "data:import", command.profileId);
    const tenantId = context.principal.tenantId;
    const profile = await dependencies.profiles.loadImport(tenantId, command.profileId);
    if (!profile || !validImportProfile(profile, command.profileId)) {
      throw new ImportExportError("Import profile is unavailable", "profile-unavailable");
    }
    await authorizeImportSource(context, command.sourceAssetId);
    try {
      return await dependencies.jobs.execute(
        scopedKey(tenantId, "import", command.idempotencyKey),
        fingerprint("import", command),
        async () => {
          const id = createJobId();
          const createdAt = now().toISOString();
          try {
            const source = await dependencies.importAssets.read(
              tenantId,
              command.sourceAssetId,
              profile.maxSourceBytes,
            );
            if (
              !source
              || source.assetId !== command.sourceAssetId
              || source.tenantId !== tenantId
              || source.status !== "available"
              || source.contentType !== profile.contentType
              || !Number.isSafeInteger(source.sizeBytes)
              || source.sizeBytes < 1
              || !Array.isArray(source.rows)
            ) throw new ImportExportError("Import source is unavailable", "source-unavailable");
            if (source.sizeBytes > profile.maxSourceBytes) {
              throw new ImportExportError("Import source limit exceeded", "limit-exceeded");
            }
            const rows = validateRows(profile, source.rows);
            await dependencies.imports.commit({
              tenantId,
              profileId: profile.id,
              rows,
            }, () => audit(context, "data:import", id, "succeeded", "import-committed"));
            return {
              jobId: id,
              operation: "import",
              status: "succeeded",
              processedRows: rows.length,
              rejectedRows: 0,
              createdAt,
              completedAt: now().toISOString(),
            };
          } catch (error) {
            try {
              await audit(context, "data:import", id, "failed", "import-failed");
            } catch {
              // The required transactional success audit still controls commit.
            }
            throw error;
          }
        },
      );
    } catch (error) {
      return mapFailure(error, "import");
    }
  }

  async function runExport(
    context: ImportExportContext,
    input: unknown,
  ): Promise<ImportExportJobRecord> {
    const command = parseExportCommand(input);
    if (!validContext(context) || !command) {
      throw new ImportExportError("Data export request is invalid", "invalid-request");
    }
    await authorize(context, "data:export", command.profileId);
    const tenantId = context.principal.tenantId;
    const profile = await dependencies.profiles.loadExport(tenantId, command.profileId);
    if (!profile || !validExportProfile(profile, command.profileId)) {
      throw new ImportExportError("Export profile is unavailable", "profile-unavailable");
    }
    try {
      return await dependencies.jobs.execute(
        scopedKey(tenantId, "export", command.idempotencyKey),
        fingerprint("export", command),
        async () => {
          const id = createJobId();
          const createdAt = now().toISOString();
          let output: PrivateExchangeResult | undefined;
          try {
            const rows = await dependencies.exportSource.read(tenantId, profile.id, profile.maxRows);
            if (!Array.isArray(rows)) {
              throw new ImportExportError("Export source is invalid", "operation-failed");
            }
            const bytes = encodeCsv(profile, rows, tenantId);
            output = await dependencies.exportResults.write({
              tenantId,
              contentType: "text/csv",
              bytes,
            });
            if (
              output.tenantId !== tenantId
              || output.status !== "available"
              || output.assetId.length < 16
              || output.assetId.length > 255
            ) throw new ImportExportError("Export result is invalid", "operation-failed");
            await audit(context, "data:export", id, "succeeded", "export-published");
            return {
              jobId: id,
              operation: "export",
              status: "succeeded",
              processedRows: rows.length,
              rejectedRows: 0,
              outputAssetId: output.assetId,
              createdAt,
              completedAt: now().toISOString(),
            };
          } catch (error) {
            if (output) {
              await dependencies.exportResults.remove(tenantId, output.assetId)
                .catch(() => undefined);
            }
            try {
              await audit(context, "data:export", id, "failed", "export-failed");
            } catch {
              // The caller still receives a visible failure.
            }
            throw error;
          }
        },
      );
    } catch (error) {
      return mapFailure(error, "export");
    }
  }

  return Object.freeze({ runExport, runImport });
}
