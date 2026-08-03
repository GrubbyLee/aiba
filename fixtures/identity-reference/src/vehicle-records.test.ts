import { describe, expect, it } from "vitest";
import type { AuthorizationDecision, Principal, VehicleRecord } from "aiba-spec";
import {
  createVehicleRecordsService,
  type StoredVehicleRecord,
  type VehicleCreationGate,
  type VehicleRepository,
} from "./vehicle-records.js";

class MemoryVehicleRepository implements VehicleRepository {
  readonly records = new Map<string, StoredVehicleRecord>();

  async find(tenantId: string, vehicleId: string): Promise<StoredVehicleRecord | undefined> {
    const value = this.records.get(`${tenantId}:${vehicleId}`);
    return value ? structuredClone(value) : undefined;
  }

  async list(tenantId: string, limit: number): Promise<StoredVehicleRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async create(
    record: StoredVehicleRecord,
    audit: () => Promise<void>,
  ): Promise<"created" | "duplicate"> {
    const duplicate = [...this.records.values()].some((candidate) =>
      candidate.tenantId === record.tenantId
      && (
        candidate.fleetNumber === record.fleetNumber
        || candidate.plateNumber === record.plateNumber
        || (record.vin !== undefined && candidate.vin === record.vin)
      ));
    if (duplicate) return "duplicate";
    await audit();
    this.records.set(`${record.tenantId}:${record.vehicleId}`, structuredClone(record));
    return "created";
  }

  async update(
    record: StoredVehicleRecord,
    expectedRevision: number,
    audit: () => Promise<void>,
  ): Promise<boolean> {
    const key = `${record.tenantId}:${record.vehicleId}`;
    if (this.records.get(key)?.revision !== expectedRevision) return false;
    await audit();
    this.records.set(key, structuredClone(record));
    return true;
  }
}

class MemoryCreationGate implements VehicleCreationGate {
  readonly values = new Map<string, { fingerprint: string; record: VehicleRecord }>();

  async execute(
    key: string,
    fingerprint: string,
    operation: () => Promise<VehicleRecord>,
  ): Promise<VehicleRecord> {
    const existing = this.values.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw Object.assign(new Error("conflict"), { code: "IDEMPOTENCY_CONFLICT" });
      }
      return structuredClone(existing.record);
    }
    const record = await operation();
    this.values.set(key, { fingerprint, record: structuredClone(record) });
    return record;
  }
}

function createFixture(options: { allowed?: boolean; decisionTenant?: string; failAudit?: boolean } = {}) {
  const repository = new MemoryVehicleRepository();
  const creationGate = new MemoryCreationGate();
  const auditEvents: unknown[] = [];
  let sequence = 0;
  const allowed = options.allowed ?? true;
  const service = createVehicleRecordsService({
    repository,
    creationGate,
    authorization: {
      decide: async (context, input): Promise<AuthorizationDecision> => ({
        decisionId: "decision-vehicle-0001",
        principal: {
          ...context.principal,
          ...(options.decisionTenant ? { tenantId: options.decisionTenant } : {}),
        },
        action: input.action,
        resource: {
          ...input.resource,
          ...(options.decisionTenant ? { tenantId: options.decisionTenant } : {}),
        },
        allowed,
        reasonCode: allowed ? "explicit-allow" : "default-deny",
        policyVersion: "policy-1",
        evaluatedAt: "2026-08-03T00:00:00Z",
      }),
    },
    audit: {
      record: async (_context, event) => {
        if (options.failAudit) throw new Error("audit unavailable");
        auditEvents.push(structuredClone(event));
      },
    },
    now: () => new Date("2026-08-03T00:00:00Z"),
    vehicleId: () => `vehicle-${(++sequence).toString().padStart(12, "0")}`,
  });
  const principal: Principal = { type: "user", subject: "operator-1", tenantId: "tenant-a" };
  const context = { principal, correlationId: "request-vehicle-0001" };
  const command = {
    fleetNumber: " fleet 001 ",
    plateNumber: "ab-1234",
    vin: "1hgcm82633a004352",
    make: " Example Motors ",
    model: " Cargo One ",
    year: 2025,
    idempotencyKey: "vehicle-create-0001",
  };
  return { auditEvents, command, context, creationGate, repository, service };
}

describe("vehicle records reference boundary", () => {
  it("normalizes identifiers and creates a server-owned tenant-scoped record", async () => {
    const fixture = createFixture();
    const record = await fixture.service.create(fixture.context, fixture.command);
    expect(record).toMatchObject({
      vehicleId: "vehicle-000000000001",
      fleetNumber: "FLEET 001",
      plateNumber: "AB1234",
      vin: "1HGCM82633A004352",
      status: "active",
      mileageKm: 0,
      revision: 1,
    });
    expect(record).not.toHaveProperty("tenantId");
    expect(JSON.stringify(fixture.auditEvents)).not.toContain("AB1234");
    expect(JSON.stringify(fixture.auditEvents)).not.toContain("1HGCM82633A004352");
  });

  it("rejects caller-owned tenant, vehicle ID, and unknown execution fields", async () => {
    const fixture = createFixture();
    await expect(fixture.service.create(fixture.context, {
      ...fixture.command,
      tenantId: "tenant-b",
      vehicleId: "vehicle-attacker-0001",
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(fixture.repository.records.size).toBe(0);
  });

  it("fails closed for denied or tenant-mismatched authorization", async () => {
    const denied = createFixture({ allowed: false });
    await expect(denied.service.create(denied.context, denied.command))
      .rejects.toMatchObject({ code: "forbidden" });
    const mismatched = createFixture({ decisionTenant: "tenant-b" });
    await expect(mismatched.service.create(mismatched.context, mismatched.command))
      .rejects.toMatchObject({ code: "forbidden" });
  });

  it("isolates reads and lists by the trusted tenant", async () => {
    const fixture = createFixture();
    const record = await fixture.service.create(fixture.context, fixture.command);
    const other = {
      principal: { ...fixture.context.principal, tenantId: "tenant-b" },
      correlationId: fixture.context.correlationId,
    };
    await expect(fixture.service.get(other, record.vehicleId))
      .rejects.toMatchObject({ code: "not-found" });
    expect(await fixture.service.list(other, 20)).toEqual([]);
  });

  it("enforces normalized identifier uniqueness inside one tenant", async () => {
    const fixture = createFixture();
    await fixture.service.create(fixture.context, fixture.command);
    await expect(fixture.service.create(fixture.context, {
      ...fixture.command,
      fleetNumber: "fleet-002",
      plateNumber: "AB 1234",
      idempotencyKey: "vehicle-create-0002",
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("returns idempotent creates and rejects a conflicting key reuse", async () => {
    const fixture = createFixture();
    const first = await fixture.service.create(fixture.context, fixture.command);
    const retry = await fixture.service.create(fixture.context, fixture.command);
    expect(retry).toEqual(first);
    expect(fixture.repository.records.size).toBe(1);
    await expect(fixture.service.create(fixture.context, {
      ...fixture.command,
      model: "Different",
    })).rejects.toMatchObject({ code: "idempotency-conflict" });
  });

  it("rejects stale writes and mileage rollback", async () => {
    const fixture = createFixture();
    const record = await fixture.service.create(fixture.context, fixture.command);
    const updated = await fixture.service.update(fixture.context, {
      vehicleId: record.vehicleId,
      expectedRevision: 1,
      mileageKm: 1200,
    });
    expect(updated).toMatchObject({ mileageKm: 1200, revision: 2 });
    await expect(fixture.service.update(fixture.context, {
      vehicleId: record.vehicleId,
      expectedRevision: 1,
      mileageKm: 1300,
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(fixture.service.update(fixture.context, {
      vehicleId: record.vehicleId,
      expectedRevision: 2,
      mileageKm: 1199,
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps retirement terminal", async () => {
    const fixture = createFixture();
    const record = await fixture.service.create(fixture.context, fixture.command);
    const retired = await fixture.service.update(fixture.context, {
      vehicleId: record.vehicleId,
      expectedRevision: 1,
      status: "retired",
    });
    await expect(fixture.service.update(fixture.context, {
      vehicleId: record.vehicleId,
      expectedRevision: retired.revision,
      status: "active",
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("does not commit vehicle state when required audit fails", async () => {
    const fixture = createFixture({ failAudit: true });
    await expect(fixture.service.create(fixture.context, fixture.command))
      .rejects.toThrow("audit unavailable");
    expect(fixture.repository.records.size).toBe(0);
  });
});
