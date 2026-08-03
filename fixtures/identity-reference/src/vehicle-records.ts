import { createHash, randomUUID } from "node:crypto";
import type {
  AuthorizationDecision,
  Principal,
  VehicleCreateCommand,
  VehicleRecord,
  VehicleUpdateCommand,
} from "aiba-spec";
import type { AuditContext } from "./audit.js";

export interface StoredVehicleRecord extends VehicleRecord {
  tenantId: string;
}

export interface VehicleRepository {
  find(tenantId: string, vehicleId: string): Promise<StoredVehicleRecord | undefined>;
  list(tenantId: string, limit: number): Promise<StoredVehicleRecord[]>;
  create(
    record: StoredVehicleRecord,
    audit: () => Promise<void>,
  ): Promise<"created" | "duplicate">;
  update(
    record: StoredVehicleRecord,
    expectedRevision: number,
    audit: () => Promise<void>,
  ): Promise<boolean>;
}

export interface VehicleCreationGate {
  execute(
    scopedKey: string,
    fingerprint: string,
    operation: () => Promise<VehicleRecord>,
  ): Promise<VehicleRecord>;
}

export interface VehicleAuthorizer {
  decide(
    context: { principal: Principal; correlationId: string },
    input: {
      action: "vehicles:create" | "vehicles:read" | "vehicles:list" | "vehicles:update";
      resource: { type: "vehicle" | "vehicle-collection"; id?: string; tenantId: string };
    },
  ): Promise<AuthorizationDecision>;
}

export interface VehicleAudit {
  record(
    context: AuditContext,
    input: {
      action: "vehicles:create" | "vehicles:update";
      outcome: "succeeded";
      reasonCode: string;
      target: { type: "vehicle"; id: string; tenantId: string };
    },
  ): Promise<unknown>;
}

export interface VehicleRecordsDependencies {
  repository: VehicleRepository;
  authorization: VehicleAuthorizer;
  audit: VehicleAudit;
  creationGate: VehicleCreationGate;
  now?: () => Date;
  vehicleId?: () => string;
}

export interface VehicleContext {
  principal: Principal;
  correlationId: string;
}

export class VehicleRecordsError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "conflict"
      | "forbidden"
      | "idempotency-conflict"
      | "invalid-request"
      | "not-found",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "VehicleRecordsError";
  }
}

const transitions: Record<VehicleRecord["status"], VehicleRecord["status"][]> = {
  active: ["inactive", "retired"],
  inactive: ["active", "retired"],
  retired: [],
};
const CREATE_KEYS = new Set([
  "fleetNumber", "plateNumber", "vin", "make", "model", "year", "idempotencyKey",
]);
const UPDATE_KEYS = new Set(["vehicleId", "expectedRevision", "status", "mileageKm"]);
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

function object(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, required: string[]): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
    && required.every((key) => key in value);
}

function trustedTenant(context: VehicleContext): string {
  if (
    typeof context.principal.subject !== "string"
    || context.principal.subject.length < 1
    || typeof context.principal.tenantId !== "string"
    || context.principal.tenantId.length < 1
    || context.principal.tenantId.length > 255
    || typeof context.correlationId !== "string"
    || context.correlationId.length < 8
    || context.correlationId.length > 255
  ) throw new VehicleRecordsError("Trusted vehicle context is invalid", "invalid-request");
  return context.principal.tenantId;
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= maxLength ? normalized : undefined;
}

function parseCreate(value: unknown, maximumYear: number): VehicleCreateCommand | undefined {
  const input = object(value);
  if (!input || !exactKeys(input, CREATE_KEYS, [
    "fleetNumber", "plateNumber", "make", "model", "year", "idempotencyKey",
  ])) return undefined;
  const fleetNumber = boundedText(input.fleetNumber, 64)?.toLocaleUpperCase("en-US");
  const plateNumber = boundedText(input.plateNumber, 32)
    ?.replace(/[\s-]+/g, "")
    .toLocaleUpperCase("en-US");
  const make = boundedText(input.make, 80);
  const model = boundedText(input.model, 80);
  const vin = input.vin === undefined
    ? undefined
    : boundedText(input.vin, 17)?.toLocaleUpperCase("en-US");
  if (
    !fleetNumber
    || !plateNumber
    || plateNumber.length < 2
    || !make
    || !model
    || !Number.isSafeInteger(input.year)
    || (input.year as number) < 1886
    || (input.year as number) > maximumYear
    || typeof input.idempotencyKey !== "string"
    || input.idempotencyKey.length < 16
    || input.idempotencyKey.length > 255
    || (vin !== undefined && !VIN.test(vin))
  ) return undefined;
  return {
    fleetNumber,
    plateNumber,
    ...(vin ? { vin } : {}),
    make,
    model,
    year: input.year as number,
    idempotencyKey: input.idempotencyKey,
  };
}

function parseUpdate(value: unknown): VehicleUpdateCommand | undefined {
  const input = object(value);
  if (
    !input
    || !exactKeys(input, UPDATE_KEYS, ["vehicleId", "expectedRevision"])
    || typeof input.vehicleId !== "string"
    || input.vehicleId.length < 16
    || input.vehicleId.length > 255
    || !Number.isSafeInteger(input.expectedRevision)
    || (input.expectedRevision as number) < 1
    || (input.status === undefined && input.mileageKm === undefined)
    || (input.status !== undefined && !["active", "inactive", "retired"].includes(String(input.status)))
    || (input.mileageKm !== undefined && (
      !Number.isSafeInteger(input.mileageKm)
      || (input.mileageKm as number) < 0
      || (input.mileageKm as number) > 10_000_000
    ))
  ) return undefined;
  return {
    vehicleId: input.vehicleId,
    expectedRevision: input.expectedRevision as number,
    ...(input.status !== undefined
      ? { status: input.status as NonNullable<VehicleUpdateCommand["status"]> }
      : {}),
    ...(input.mileageKm !== undefined ? { mileageKm: input.mileageKm as number } : {}),
  };
}

function publicRecord(record: StoredVehicleRecord): VehicleRecord {
  const { tenantId: _tenantId, ...result } = record;
  return structuredClone(result);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function decisionMatches(
  decision: AuthorizationDecision,
  context: VehicleContext,
  action: string,
  resource: { type: string; id?: string; tenantId: string },
): boolean {
  return decision.allowed
    && decision.action === action
    && decision.principal.type === context.principal.type
    && decision.principal.subject === context.principal.subject
    && decision.principal.tenantId === resource.tenantId
    && decision.resource.type === resource.type
    && decision.resource.id === resource.id
    && decision.resource.tenantId === resource.tenantId;
}

export function createVehicleRecordsService(dependencies: VehicleRecordsDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const vehicleId = dependencies.vehicleId ?? randomUUID;

  async function authorize(
    context: VehicleContext,
    action: "vehicles:create" | "vehicles:read" | "vehicles:list" | "vehicles:update",
    resource: { type: "vehicle" | "vehicle-collection"; id?: string; tenantId: string },
  ): Promise<void> {
    const decision = await dependencies.authorization.decide(context, { action, resource });
    if (!decisionMatches(decision, context, action, resource)) {
      throw new VehicleRecordsError("Vehicle operation is forbidden", "forbidden");
    }
  }

  return {
    async create(context: VehicleContext, value: unknown): Promise<VehicleRecord> {
      const tenantId = trustedTenant(context);
      const command = parseCreate(value, now().getUTCFullYear() + 1);
      if (!command) throw new VehicleRecordsError("Vehicle create command is invalid", "invalid-request");
      await authorize(context, "vehicles:create", { type: "vehicle-collection", tenantId });
      const { idempotencyKey, ...normalized } = command;
      try {
        return await dependencies.creationGate.execute(
          `${tenantId}:vehicles:create:${idempotencyKey}`,
          fingerprint(normalized),
          async () => {
            const timestamp = now().toISOString();
            const id = vehicleId();
            if (id.length < 16 || id.length > 255) {
              throw new VehicleRecordsError("Generated vehicle identifier is invalid", "invalid-request");
            }
            const record: StoredVehicleRecord = {
              ...normalized,
              vehicleId: id,
              tenantId,
              status: "active",
              mileageKm: 0,
              revision: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            const created = await dependencies.repository.create(record, async () => {
              await dependencies.audit.record({
                actor: context.principal,
                correlationId: context.correlationId,
              }, {
                action: "vehicles:create",
                outcome: "succeeded",
                reasonCode: "vehicle-created",
                target: { type: "vehicle", id, tenantId },
              });
            });
            if (created !== "created") {
              throw new VehicleRecordsError("Vehicle identifiers already exist", "conflict");
            }
            return publicRecord(record);
          },
        );
      } catch (error) {
        if (error instanceof VehicleRecordsError) throw error;
        if ((error as { code?: unknown }).code === "IDEMPOTENCY_CONFLICT") {
          throw new VehicleRecordsError("Idempotency key was reused", "idempotency-conflict");
        }
        throw error;
      }
    },

    async get(context: VehicleContext, id: string): Promise<VehicleRecord> {
      const tenantId = trustedTenant(context);
      if (typeof id !== "string" || id.length < 16 || id.length > 255) {
        throw new VehicleRecordsError("Vehicle identifier is invalid", "invalid-request");
      }
      await authorize(context, "vehicles:read", { type: "vehicle", id, tenantId });
      const record = await dependencies.repository.find(tenantId, id);
      if (!record) throw new VehicleRecordsError("Vehicle was not found", "not-found");
      return publicRecord(record);
    },

    async list(context: VehicleContext, limit: number): Promise<VehicleRecord[]> {
      const tenantId = trustedTenant(context);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new VehicleRecordsError("Vehicle list limit is invalid", "invalid-request");
      }
      await authorize(context, "vehicles:list", { type: "vehicle-collection", tenantId });
      const records = await dependencies.repository.list(tenantId, limit);
      if (records.length > limit || records.some((record) => record.tenantId !== tenantId)) {
        throw new VehicleRecordsError("Vehicle repository crossed its trusted boundary", "not-found");
      }
      return records.map(publicRecord);
    },

    async update(context: VehicleContext, value: unknown): Promise<VehicleRecord> {
      const tenantId = trustedTenant(context);
      const command = parseUpdate(value);
      if (!command) throw new VehicleRecordsError("Vehicle update command is invalid", "invalid-request");
      await authorize(context, "vehicles:update", {
        type: "vehicle",
        id: command.vehicleId,
        tenantId,
      });
      const current = await dependencies.repository.find(tenantId, command.vehicleId);
      if (!current) throw new VehicleRecordsError("Vehicle was not found", "not-found");
      if (current.revision !== command.expectedRevision) {
        throw new VehicleRecordsError("Vehicle revision is stale", "conflict");
      }
      if (command.status && command.status !== current.status
        && !transitions[current.status].includes(command.status)) {
        throw new VehicleRecordsError("Vehicle status transition is invalid", "conflict");
      }
      if (command.mileageKm !== undefined && command.mileageKm < current.mileageKm) {
        throw new VehicleRecordsError("Vehicle mileage cannot decrease", "conflict");
      }
      const updated: StoredVehicleRecord = {
        ...current,
        ...(command.status ? { status: command.status } : {}),
        ...(command.mileageKm !== undefined ? { mileageKm: command.mileageKm } : {}),
        revision: current.revision + 1,
        updatedAt: now().toISOString(),
      };
      const committed = await dependencies.repository.update(
        updated,
        command.expectedRevision,
        async () => {
          await dependencies.audit.record({
            actor: context.principal,
            correlationId: context.correlationId,
          }, {
            action: "vehicles:update",
            outcome: "succeeded",
            reasonCode: "vehicle-updated",
            target: { type: "vehicle", id: current.vehicleId, tenantId },
          });
        },
      );
      if (!committed) throw new VehicleRecordsError("Vehicle revision is stale", "conflict");
      return publicRecord(updated);
    },
  };
}
