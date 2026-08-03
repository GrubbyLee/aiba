import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AuditEvent,
  AuthorizationDecision,
  FileAssetRecord,
  FileAssetUploadCommand,
  Principal,
} from "aiba-spec";
import { createAuditService, type AuditStore } from "./audit.js";
import {
  createFileAssetService,
  type FileAssetRepository,
  type FileAssetUploadGate,
  type PrivateAssetStorage,
  type StoredFileAsset,
} from "./file-assets.js";

class MemoryAuditStore implements AuditStore {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> { this.events.push(event); }
}

class MemoryRepository implements FileAssetRepository {
  readonly records = new Map<string, StoredFileAsset>();

  private key(tenantId: string, assetId: string): string {
    return `${tenantId}\0${assetId}`;
  }

  async put(record: StoredFileAsset): Promise<void> {
    const key = this.key(record.tenantId, record.assetId);
    if (this.records.has(key)) throw new Error("duplicate asset");
    this.records.set(key, { ...record });
  }

  async get(tenantId: string, assetId: string): Promise<StoredFileAsset | undefined> {
    const found = this.records.get(this.key(tenantId, assetId));
    return found ? { ...found } : undefined;
  }

  async markDeleted(tenantId: string, assetId: string): Promise<StoredFileAsset> {
    const key = this.key(tenantId, assetId);
    const found = this.records.get(key);
    if (!found) throw new Error("missing asset");
    const deleted: StoredFileAsset = { ...found, status: "deleted" };
    this.records.set(key, deleted);
    return { ...deleted };
  }

  async remove(tenantId: string, assetId: string): Promise<void> {
    this.records.delete(this.key(tenantId, assetId));
  }
}

class MemoryStorage implements PrivateAssetStorage {
  readonly staged = new Map<string, Uint8Array>();
  readonly privateObjects = new Map<string, Uint8Array>();

  async stage(key: string, bytes: Uint8Array): Promise<void> {
    if (this.staged.has(key) || this.privateObjects.has(key)) throw new Error("duplicate key");
    this.staged.set(key, Uint8Array.from(bytes));
  }

  async promote(key: string): Promise<void> {
    const bytes = this.staged.get(key);
    if (!bytes) throw new Error("missing staged object");
    this.staged.delete(key);
    this.privateObjects.set(key, bytes);
  }

  async read(key: string): Promise<Uint8Array> {
    const bytes = this.privateObjects.get(key);
    if (!bytes) throw new Error("missing private object");
    return Uint8Array.from(bytes);
  }

  async delete(key: string): Promise<void> {
    this.staged.delete(key);
    this.privateObjects.delete(key);
  }
}

class MemoryUploadGate implements FileAssetUploadGate {
  readonly entries = new Map<string, { fingerprint: string; record: FileAssetRecord }>();

  async execute(
    key: string,
    fingerprint: string,
    upload: () => Promise<FileAssetRecord>,
  ): Promise<FileAssetRecord> {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw Object.assign(new Error("idempotency conflict"), { code: "IDEMPOTENCY_CONFLICT" });
      }
      return { ...existing.record };
    }
    const result = await upload();
    this.entries.set(key, { fingerprint, record: { ...result } });
    return result;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createFixture(options: {
  allowed?: boolean;
  clean?: boolean;
  decisionTenant?: string;
  decisionType?: Principal["type"];
} = {}) {
  const auditStore = new MemoryAuditStore();
  const audit = createAuditService({
    store: auditStore,
    now: () => new Date("2026-08-03T00:00:00Z"),
    eventId: () => `event-${auditStore.events.length.toString().padStart(11, "0")}`,
  });
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const uploads = new MemoryUploadGate();
  const decisions: Array<{
    action: string;
    resource: { type: string; id?: string; tenantId: string };
  }> = [];
  const allowed = options.allowed ?? true;
  const service = createFileAssetService({
    authorization: {
      decide: async (context, input): Promise<AuthorizationDecision> => {
        decisions.push(input);
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
    repository,
    storage,
    scanner: { scan: async () => options.clean === false ? "rejected" : "clean" },
    uploads,
    detectContentType: (bytes) => Buffer.from(bytes).subarray(0, 4).toString() === "%PDF"
      ? "application/pdf"
      : undefined,
    maxBytes: 1024,
    now: () => new Date("2026-08-03T00:00:00Z"),
    assetId: () => "asset-00000000001",
    storageKey: () => "opaque-storage-object-0001",
  });
  const bytes = Buffer.from("%PDF-1.7\ntrusted fixture bytes", "utf8");
  const command: FileAssetUploadCommand = {
    fileName: "invoice.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    idempotencyKey: "upload-request-0001",
  };
  const principal: Principal = { type: "user", subject: "user-42", tenantId: "tenant-a" };
  const context = { principal, correlationId: "request-file-0001" };
  return {
    auditStore,
    bytes,
    command,
    context,
    decisions,
    repository,
    service,
    storage,
    uploads,
  };
}

describe("file assets reference boundary", () => {
  it("stores verified content privately and returns only a minimized record", async () => {
    const fixture = createFixture();
    const result = await fixture.service.upload(
      fixture.context,
      fixture.command,
      fixture.bytes,
    );
    expect(result).toEqual({
      assetId: "asset-00000000001",
      status: "available",
      sizeBytes: fixture.bytes.byteLength,
      contentType: "application/pdf",
      sha256: sha256(fixture.bytes),
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    expect(fixture.storage.staged.size).toBe(0);
    expect(Array.from(fixture.storage.privateObjects.get("opaque-storage-object-0001") ?? []))
      .toEqual(Array.from(fixture.bytes));
    const download = await fixture.service.download(fixture.context, result.assetId);
    expect(Array.from(download.bytes)).toEqual(Array.from(fixture.bytes));
    const provenance = JSON.stringify({ record: result, events: fixture.auditStore.events });
    expect(provenance).not.toContain("invoice.pdf");
    expect(provenance).not.toContain("opaque-storage-object");
    expect(provenance).not.toContain("trusted fixture bytes");
  });

  it("authorizes before storing content and rejects an unbound decision", async () => {
    const denied = createFixture({ allowed: false });
    await expect(denied.service.upload(denied.context, denied.command, denied.bytes))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(denied.storage.staged.size).toBe(0);
    expect(denied.storage.privateObjects.size).toBe(0);

    const unbound = createFixture({ decisionTenant: "tenant-b" });
    await expect(unbound.service.upload(unbound.context, unbound.command, unbound.bytes))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(unbound.storage.privateObjects.size).toBe(0);

    const wrongPrincipalType = createFixture({ decisionType: "service" });
    await expect(wrongPrincipalType.service.upload(
      wrongPrincipalType.context,
      wrongPrincipalType.command,
      wrongPrincipalType.bytes,
    )).rejects.toMatchObject({ code: "forbidden" });
    expect(wrongPrincipalType.storage.privateObjects.size).toBe(0);
  });

  it("rejects tenant injection, storage fields, and path-like file names", async () => {
    const fixture = createFixture();
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      tenantId: "tenant-b",
      storageKey: "../../internal",
      providerUrl: "https://storage.example/private?token=secret",
    }, fixture.bytes)).rejects.toMatchObject({ code: "invalid-request" });
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      fileName: "../../secret.pdf",
    }, fixture.bytes)).rejects.toMatchObject({ code: "invalid-request" });
    expect(fixture.storage.privateObjects.size).toBe(0);
  });

  it("checks actual size, digest, detected type, and the application limit", async () => {
    const fixture = createFixture();
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      sizeBytes: fixture.command.sizeBytes + 1,
    }, fixture.bytes)).rejects.toMatchObject({ code: "content-mismatch" });
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      sha256: "0".repeat(64),
    }, fixture.bytes)).rejects.toMatchObject({ code: "content-mismatch" });
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      contentType: "image/png",
    }, fixture.bytes)).rejects.toMatchObject({ code: "content-mismatch" });
    const oversized = Buffer.alloc(1025, 1);
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      sizeBytes: oversized.byteLength,
      sha256: sha256(oversized),
    }, oversized)).rejects.toMatchObject({ code: "content-too-large" });
    expect(fixture.storage.privateObjects.size).toBe(0);
  });

  it("quarantines scans and removes rejected content", async () => {
    const fixture = createFixture({ clean: false });
    await expect(fixture.service.upload(fixture.context, fixture.command, fixture.bytes))
      .rejects.toMatchObject({ code: "unsafe-content" });
    expect(fixture.storage.staged.size).toBe(0);
    expect(fixture.storage.privateObjects.size).toBe(0);
    expect(fixture.repository.records.size).toBe(0);
    expect(fixture.auditStore.events).toContainEqual(expect.objectContaining({
      outcome: "failed",
      reasonCode: "content-rejected",
    }));
  });

  it("deduplicates identical uploads and rejects conflicting reuse", async () => {
    const fixture = createFixture();
    const first = await fixture.service.upload(fixture.context, fixture.command, fixture.bytes);
    const second = await fixture.service.upload(fixture.context, fixture.command, fixture.bytes);
    expect(second).toEqual(first);
    expect(fixture.storage.privateObjects.size).toBe(1);
    expect(fixture.auditStore.events).toHaveLength(1);
    await expect(fixture.service.upload(fixture.context, {
      ...fixture.command,
      fileName: "other.pdf",
    }, fixture.bytes)).rejects.toMatchObject({ code: "idempotency-conflict" });
  });

  it("isolates reads and deletes by trusted tenant", async () => {
    const fixture = createFixture();
    const asset = await fixture.service.upload(fixture.context, fixture.command, fixture.bytes);
    const otherContext = {
      principal: { ...fixture.context.principal, tenantId: "tenant-b" },
      correlationId: "request-file-0002",
    };
    await expect(fixture.service.download(otherContext, asset.assetId))
      .rejects.toMatchObject({ code: "asset-unavailable" });
    await expect(fixture.service.remove(otherContext, asset.assetId))
      .rejects.toMatchObject({ code: "asset-unavailable" });
    expect(fixture.storage.privateObjects.size).toBe(1);
  });

  it("makes deletion terminal across repeated delete and upload retry", async () => {
    const fixture = createFixture();
    const asset = await fixture.service.upload(fixture.context, fixture.command, fixture.bytes);
    const deleted = await fixture.service.remove(fixture.context, asset.assetId);
    expect(deleted.status).toBe("deleted");
    expect((await fixture.service.remove(fixture.context, asset.assetId)).status).toBe("deleted");
    await expect(fixture.service.download(fixture.context, asset.assetId))
      .rejects.toMatchObject({ code: "asset-unavailable" });
    await expect(fixture.service.upload(fixture.context, fixture.command, fixture.bytes))
      .rejects.toMatchObject({ code: "asset-unavailable" });
    expect(fixture.storage.privateObjects.size).toBe(0);
  });

  it("cleans up storage and metadata when required audit delivery fails", async () => {
    const fixture = createFixture();
    fixture.auditStore.append = async () => { throw new Error("audit unavailable"); };
    await expect(fixture.service.upload(fixture.context, fixture.command, fixture.bytes))
      .rejects.toMatchObject({ code: "delivery-failed" });
    expect(fixture.storage.staged.size).toBe(0);
    expect(fixture.storage.privateObjects.size).toBe(0);
    expect(fixture.repository.records.size).toBe(0);
  });
});
