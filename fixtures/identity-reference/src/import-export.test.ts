import { describe, expect, it } from "vitest";
import type {
  AuditEvent,
  AuthorizationDecision,
  DataExportCommand,
  DataImportCommand,
  ImportExportJobRecord,
  Principal,
} from "aiba-spec";
import { createAuditService, type AuditStore } from "./audit.js";
import {
  createImportExportService,
  type AtomicImportWriter,
  type ExportRow,
  type ImportAssetData,
  type ImportedRow,
  type ImportExportJobGate,
  type PrivateExchangeResult,
  type PrivateExchangeWriter,
} from "./import-export.js";

class MemoryAuditStore implements AuditStore {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> { this.events.push(event); }
}

class MemoryImportWriter implements AtomicImportWriter {
  rows: ImportedRow[] = [];
  commits = 0;
  fail = false;

  async commit(
    input: { tenantId: string; profileId: string; rows: ImportedRow[] },
    recordAudit: () => Promise<void>,
  ): Promise<void> {
    if (this.fail) throw new Error("database unavailable");
    const next = input.rows.map((row) => ({ ...row }));
    await recordAudit();
    this.rows = next;
    this.commits += 1;
  }
}

class MemoryJobGate implements ImportExportJobGate {
  readonly entries = new Map<string, { fingerprint: string; record: ImportExportJobRecord }>();

  async execute(
    key: string,
    fingerprint: string,
    operation: () => Promise<ImportExportJobRecord>,
  ): Promise<ImportExportJobRecord> {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw Object.assign(new Error("idempotency conflict"), { code: "IDEMPOTENCY_CONFLICT" });
      }
      return { ...existing.record };
    }
    const result = await operation();
    this.entries.set(key, { fingerprint, record: { ...result } });
    return result;
  }
}

class MemoryResultWriter implements PrivateExchangeWriter {
  readonly outputs = new Map<string, Uint8Array>();
  writes = 0;
  removals = 0;

  async write(input: {
    tenantId: string;
    contentType: "text/csv";
    bytes: Uint8Array;
  }): Promise<PrivateExchangeResult> {
    this.writes += 1;
    const assetId = "asset-export-00001";
    this.outputs.set(assetId, Uint8Array.from(input.bytes));
    return { assetId, tenantId: input.tenantId, status: "available" };
  }

  async remove(_tenantId: string, assetId: string): Promise<void> {
    this.removals += 1;
    this.outputs.delete(assetId);
  }
}

function createFixture(options: {
  allowed?: boolean;
  decisionTenant?: string;
  decisionType?: Principal["type"];
} = {}) {
  const auditStore = new MemoryAuditStore();
  const audit = createAuditService({
    store: auditStore,
    now: () => new Date("2026-08-03T00:00:00Z"),
    eventId: () => `event-${auditStore.events.length.toString().padStart(11, "0")}`,
  });
  const imports = new MemoryImportWriter();
  const jobs = new MemoryJobGate();
  const exportResults = new MemoryResultWriter();
  const decisions: Array<{ action: string; tenantId: string }> = [];
  const source: ImportAssetData = {
    assetId: "asset-import-00001",
    tenantId: "tenant-a",
    status: "available",
    contentType: "text/csv",
    sizeBytes: 128,
    rows: [
      { vehicleId: "vehicle-1", mileage: 1200, active: true },
      { vehicleId: "vehicle-2", mileage: 800, active: false },
    ],
  };
  const exportRows: ExportRow[] = [
    {
      tenantId: "tenant-a",
      values: {
        vehicleId: "vehicle-1",
        owner: "=HYPERLINK(\"https://attacker.example\")",
        internalSecret: "never-export",
      },
    },
  ];
  let jobSequence = 0;
  const allowed = options.allowed ?? true;
  const service = createImportExportService({
    authorization: {
      decide: async (context, input): Promise<AuthorizationDecision> => {
        decisions.push({ action: input.action, tenantId: input.resource.tenantId });
        return {
          decisionId: `decision-${decisions.length.toString().padStart(8, "0")}`,
          principal: {
            ...context.principal,
            ...(options.decisionTenant ? { tenantId: options.decisionTenant } : {}),
            ...(options.decisionType ? { type: options.decisionType } : {}),
          },
          action: input.action,
          resource: {
            ...input.resource,
            ...(options.decisionTenant ? { tenantId: options.decisionTenant } : {}),
          },
          allowed,
          reasonCode: allowed ? "explicit-allow" : "default-deny",
          policyVersion: "policy-7",
          evaluatedAt: "2026-08-03T00:00:00Z",
        };
      },
    },
    audit,
    profiles: {
      loadImport: async (_tenantId, profileId) => ({
        id: profileId,
        enabled: true,
        contentType: "text/csv",
        maxSourceBytes: 1024,
        maxRows: 2,
        fields: [
          { name: "vehicleId", type: "string", required: true, maxLength: 32 },
          { name: "mileage", type: "integer", required: true },
          { name: "active", type: "boolean", required: true },
        ],
        uniqueKey: "vehicleId",
      }),
      loadExport: async (_tenantId, profileId) => ({
        id: profileId,
        enabled: true,
        format: "csv",
        maxRows: 2,
        maxCellLength: 100,
        fields: [
          { name: "vehicleId", heading: "Vehicle ID" },
          { name: "owner", heading: "Owner" },
        ],
      }),
    },
    importAssets: {
      read: async () => ({ ...source, rows: [...source.rows] }),
    },
    imports,
    exportSource: {
      read: async () => exportRows.map((row) => ({
        tenantId: row.tenantId,
        values: { ...row.values },
      })),
    },
    exportResults,
    jobs,
    now: () => new Date("2026-08-03T00:00:00Z"),
    jobId: () => `job-${(++jobSequence).toString().padStart(12, "0")}`,
  });
  const principal: Principal = { type: "user", subject: "user-42", tenantId: "tenant-a" };
  const context = { principal, correlationId: "request-exchange-0001" };
  const importCommand: DataImportCommand = {
    profileId: "vehicle-import",
    sourceAssetId: source.assetId,
    idempotencyKey: "import-request-0001",
  };
  const exportCommand: DataExportCommand = {
    profileId: "vehicle-export",
    idempotencyKey: "export-request-0001",
  };
  return {
    auditStore,
    context,
    decisions,
    exportCommand,
    exportResults,
    exportRows,
    importCommand,
    imports,
    jobs,
    service,
    source,
  };
}

describe("import export reference boundary", () => {
  it("imports validated rows through one audited atomic commit", async () => {
    const fixture = createFixture();
    const result = await fixture.service.runImport(fixture.context, fixture.importCommand);
    expect(result).toEqual({
      jobId: "job-000000000001",
      operation: "import",
      status: "succeeded",
      processedRows: 2,
      rejectedRows: 0,
      createdAt: "2026-08-03T00:00:00.000Z",
      completedAt: "2026-08-03T00:00:00.000Z",
    });
    expect(fixture.imports.rows).toEqual(fixture.source.rows);
    expect(fixture.imports.commits).toBe(1);
    expect(fixture.decisions[0]).toEqual({ action: "data:import", tenantId: "tenant-a" });
    expect(fixture.decisions[1]).toEqual({
      action: "file-assets:read",
      tenantId: "tenant-a",
    });
    const provenance = JSON.stringify({ result, events: fixture.auditStore.events });
    expect(provenance).not.toContain("vehicle-1");
    expect(provenance).not.toContain("mileage");
  });

  it("rejects caller-owned tenant, table, mapping, query, destination, and callback fields", async () => {
    const fixture = createFixture();
    await expect(fixture.service.runImport(fixture.context, {
      ...fixture.importCommand,
      tenantId: "tenant-b",
      table: "internal_users",
      mapping: { admin: "role" },
      sourceUrl: "https://attacker.example/input.csv",
    })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(fixture.service.runExport(fixture.context, {
      ...fixture.exportCommand,
      query: "select * from secrets",
      destination: "s3://attacker-bucket",
      callbackUrl: "https://attacker.example/collect",
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("requires an allowed decision bound to the trusted tenant", async () => {
    const denied = createFixture({ allowed: false });
    await expect(denied.service.runImport(denied.context, denied.importCommand))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(denied.imports.commits).toBe(0);
    const unbound = createFixture({ decisionTenant: "tenant-b" });
    await expect(unbound.service.runExport(unbound.context, unbound.exportCommand))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(unbound.exportResults.writes).toBe(0);

    const wrongPrincipalType = createFixture({ decisionType: "service" });
    await expect(wrongPrincipalType.service.runImport(
      wrongPrincipalType.context,
      wrongPrincipalType.importCommand,
    )).rejects.toMatchObject({ code: "forbidden" });
    expect(wrongPrincipalType.imports.commits).toBe(0);
  });

  it("requires an available private source in the trusted tenant", async () => {
    const fixture = createFixture();
    fixture.source.tenantId = "tenant-b";
    await expect(fixture.service.runImport(fixture.context, fixture.importCommand))
      .rejects.toMatchObject({ code: "source-unavailable" });
    fixture.source.tenantId = "tenant-a";
    fixture.source.status = "quarantined";
    await expect(fixture.service.runImport(fixture.context, fixture.importCommand))
      .rejects.toMatchObject({ code: "source-unavailable" });
    expect(fixture.imports.commits).toBe(0);
  });

  it("rejects source, row, field, type, and unique-key violations before commit", async () => {
    const tooLarge = createFixture();
    tooLarge.source.sizeBytes = 1025;
    await expect(tooLarge.service.runImport(tooLarge.context, tooLarge.importCommand))
      .rejects.toMatchObject({ code: "limit-exceeded" });

    const tooMany = createFixture();
    tooMany.source.rows.push({ vehicleId: "vehicle-3", mileage: 1, active: true });
    await expect(tooMany.service.runImport(tooMany.context, tooMany.importCommand))
      .rejects.toMatchObject({ code: "limit-exceeded" });

    const unknown = createFixture();
    unknown.source.rows[0] = { ...unknown.source.rows[0] as object, isAdmin: true };
    await expect(unknown.service.runImport(unknown.context, unknown.importCommand))
      .rejects.toMatchObject({ code: "validation-failed" });

    const wrongType = createFixture();
    wrongType.source.rows[0] = { vehicleId: "vehicle-1", mileage: "1200", active: true };
    await expect(wrongType.service.runImport(wrongType.context, wrongType.importCommand))
      .rejects.toMatchObject({ code: "validation-failed" });

    const duplicate = createFixture();
    duplicate.source.rows[1] = { vehicleId: "vehicle-1", mileage: 800, active: false };
    await expect(duplicate.service.runImport(duplicate.context, duplicate.importCommand))
      .rejects.toMatchObject({ code: "validation-failed" });
    expect([
      tooLarge.imports.commits,
      tooMany.imports.commits,
      unknown.imports.commits,
      wrongType.imports.commits,
      duplicate.imports.commits,
    ]).toEqual([0, 0, 0, 0, 0]);
  });

  it("does not commit rows when transactional audit delivery fails", async () => {
    const fixture = createFixture();
    fixture.auditStore.append = async () => { throw new Error("audit unavailable"); };
    await expect(fixture.service.runImport(fixture.context, fixture.importCommand))
      .rejects.toMatchObject({ code: "operation-failed" });
    expect(fixture.imports.rows).toEqual([]);
    expect(fixture.imports.commits).toBe(0);
  });

  it("deduplicates import retries and rejects conflicting key reuse", async () => {
    const fixture = createFixture();
    const first = await fixture.service.runImport(fixture.context, fixture.importCommand);
    const second = await fixture.service.runImport(fixture.context, fixture.importCommand);
    expect(second).toEqual(first);
    expect(fixture.imports.commits).toBe(1);
    await expect(fixture.service.runImport(fixture.context, {
      ...fixture.importCommand,
      sourceAssetId: "asset-import-00002",
    })).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(fixture.imports.commits).toBe(1);
  });

  it("exports only allowlisted fields and neutralizes spreadsheet formulas", async () => {
    const fixture = createFixture();
    const result = await fixture.service.runExport(fixture.context, fixture.exportCommand);
    expect(result).toMatchObject({
      operation: "export",
      status: "succeeded",
      processedRows: 1,
      outputAssetId: "asset-export-00001",
    });
    const output = new TextDecoder().decode(
      fixture.exportResults.outputs.get("asset-export-00001"),
    );
    expect(output).toContain('"Vehicle ID","Owner"');
    expect(output).toContain('"vehicle-1","\'=HYPERLINK(""https://attacker.example"")"');
    expect(output).not.toContain("never-export");
    const provenance = JSON.stringify({ result, events: fixture.auditStore.events });
    expect(provenance).not.toContain("HYPERLINK");
    expect(provenance).not.toContain("attacker.example");
  });

  it("rejects cross-tenant or oversized export data without publishing", async () => {
    const crossTenant = createFixture();
    crossTenant.exportRows[0] = {
      tenantId: "tenant-b",
      values: { vehicleId: "vehicle-1", owner: "Other" },
    };
    await expect(crossTenant.service.runExport(crossTenant.context, crossTenant.exportCommand))
      .rejects.toMatchObject({ code: "operation-failed" });
    expect(crossTenant.exportResults.writes).toBe(0);

    const oversized = createFixture();
    oversized.exportRows.push(
      { tenantId: "tenant-a", values: { vehicleId: "vehicle-2", owner: "Owner 2" } },
      { tenantId: "tenant-a", values: { vehicleId: "vehicle-3", owner: "Owner 3" } },
    );
    await expect(oversized.service.runExport(oversized.context, oversized.exportCommand))
      .rejects.toMatchObject({ code: "limit-exceeded" });
    expect(oversized.exportResults.writes).toBe(0);
  });

  it("deduplicates exports and removes unpublished output after audit failure", async () => {
    const fixture = createFixture();
    const first = await fixture.service.runExport(fixture.context, fixture.exportCommand);
    const second = await fixture.service.runExport(fixture.context, fixture.exportCommand);
    expect(second).toEqual(first);
    expect(fixture.exportResults.writes).toBe(1);
    await expect(fixture.service.runExport(fixture.context, {
      ...fixture.exportCommand,
      profileId: "private-export",
    })).rejects.toMatchObject({ code: "idempotency-conflict" });

    const auditFailure = createFixture();
    auditFailure.auditStore.append = async () => { throw new Error("audit unavailable"); };
    await expect(auditFailure.service.runExport(
      auditFailure.context,
      auditFailure.exportCommand,
    )).rejects.toMatchObject({ code: "operation-failed" });
    expect(auditFailure.exportResults.outputs.size).toBe(0);
    expect(auditFailure.exportResults.removals).toBe(1);
  });
});
