import { createHash, randomUUID } from "node:crypto";
import type {
  AuthorizationDecision,
  FileAssetRecord,
  FileAssetUploadCommand,
  Principal,
} from "aiba-spec";
import type { AuditContext } from "./audit.js";

export interface StoredFileAsset extends FileAssetRecord {
  tenantId: string;
  storageKey: string;
}

export interface FileAssetRepository {
  put(record: StoredFileAsset): Promise<void>;
  get(tenantId: string, assetId: string): Promise<StoredFileAsset | undefined>;
  markDeleted(tenantId: string, assetId: string): Promise<StoredFileAsset>;
  remove(tenantId: string, assetId: string): Promise<void>;
}

export interface PrivateAssetStorage {
  stage(storageKey: string, bytes: Uint8Array): Promise<void>;
  promote(storageKey: string): Promise<void>;
  read(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
}

export interface FileAssetScanner {
  scan(storageKey: string): Promise<"clean" | "rejected">;
}

export interface FileAssetUploadGate {
  execute(
    scopedKey: string,
    fingerprint: string,
    upload: () => Promise<FileAssetRecord>,
  ): Promise<FileAssetRecord>;
}

export interface FileAssetAuthorizer {
  decide(
    context: { principal: Principal; correlationId: string },
    input: {
      action: "file-assets:create" | "file-assets:read" | "file-assets:delete";
      resource: { type: "file-asset"; id?: string; tenantId: string };
    },
  ): Promise<AuthorizationDecision>;
}

export interface FileAssetAudit {
  record(
    context: AuditContext,
    input: {
      action: "file-assets:upload" | "file-assets:read" | "file-assets:delete";
      outcome: "succeeded" | "failed";
      reasonCode: string;
      target: { type: "file-asset"; id: string; tenantId: string };
    },
  ): Promise<unknown>;
}

export interface FileAssetDependencies {
  authorization: FileAssetAuthorizer;
  audit: FileAssetAudit;
  repository: FileAssetRepository;
  storage: PrivateAssetStorage;
  scanner: FileAssetScanner;
  uploads: FileAssetUploadGate;
  detectContentType: (bytes: Uint8Array) => string | undefined;
  maxBytes: number;
  now?: () => Date;
  assetId?: () => string;
  storageKey?: () => string;
}

export interface FileAssetContext {
  principal: Principal;
  correlationId: string;
}

export interface FileAssetDownload {
  record: FileAssetRecord;
  bytes: Uint8Array;
}

export class FileAssetError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "asset-unavailable"
      | "content-mismatch"
      | "content-too-large"
      | "delivery-failed"
      | "forbidden"
      | "idempotency-conflict"
      | "invalid-request"
      | "unsafe-content",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "FileAssetError";
  }
}

const FILE_NAME = /^[^/\\\u0000-\u001F\u007F]+$/;
const CONTENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parseUploadCommand(input: unknown): FileAssetUploadCommand | undefined {
  const body = record(input);
  if (
    !body
    || !hasExactKeys(body, ["contentType", "fileName", "idempotencyKey", "sha256", "sizeBytes"])
    || typeof body.fileName !== "string"
    || body.fileName.length > 255
    || !FILE_NAME.test(body.fileName)
    || typeof body.contentType !== "string"
    || body.contentType.length > 255
    || !CONTENT_TYPE.test(body.contentType)
    || !Number.isSafeInteger(body.sizeBytes)
    || (body.sizeBytes as number) < 1
    || (body.sizeBytes as number) > 5_368_709_120
    || typeof body.sha256 !== "string"
    || !SHA256.test(body.sha256)
    || typeof body.idempotencyKey !== "string"
    || body.idempotencyKey.length < 16
    || body.idempotencyKey.length > 255
  ) return undefined;
  return {
    fileName: body.fileName,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes as number,
    sha256: body.sha256,
    idempotencyKey: body.idempotencyKey,
  };
}

function portable(record: StoredFileAsset): FileAssetRecord {
  return {
    assetId: record.assetId,
    status: record.status,
    sizeBytes: record.sizeBytes,
    contentType: record.contentType,
    sha256: record.sha256,
    createdAt: record.createdAt,
  };
}

function commandFingerprint(command: FileAssetUploadCommand): string {
  return createHash("sha256").update(JSON.stringify({
    contentType: command.contentType,
    fileName: command.fileName,
    sha256: command.sha256,
    sizeBytes: command.sizeBytes,
  }), "utf8").digest("hex");
}

function validContext(context: FileAssetContext): context is FileAssetContext & {
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

export function createFileAssetService(dependencies: FileAssetDependencies) {
  if (!Number.isSafeInteger(dependencies.maxBytes) || dependencies.maxBytes < 1) {
    throw new FileAssetError("File asset size policy is invalid", "invalid-request");
  }
  const now = dependencies.now ?? (() => new Date());
  const assetId = dependencies.assetId ?? randomUUID;
  const storageKey = dependencies.storageKey ?? randomUUID;

  async function authorize(
    context: FileAssetContext & { principal: Principal & { tenantId: string } },
    action: "file-assets:create" | "file-assets:read" | "file-assets:delete",
    id?: string,
  ): Promise<void> {
    const resource = {
      type: "file-asset" as const,
      ...(id ? { id } : {}),
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
    ) throw new FileAssetError("File asset operation is forbidden", "forbidden");
  }

  async function audit(
    context: FileAssetContext & { principal: Principal & { tenantId: string } },
    action: "file-assets:upload" | "file-assets:read" | "file-assets:delete",
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
      target: { type: "file-asset", id, tenantId: context.principal.tenantId },
    });
  }

  async function upload(
    context: FileAssetContext,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<FileAssetRecord> {
    const command = parseUploadCommand(input);
    if (!validContext(context) || !command || !(bytes instanceof Uint8Array)) {
      throw new FileAssetError("File asset upload is invalid", "invalid-request");
    }
    await authorize(context, "file-assets:create");
    if (bytes.byteLength > dependencies.maxBytes || command.sizeBytes > dependencies.maxBytes) {
      throw new FileAssetError("File asset exceeds the configured size limit", "content-too-large");
    }
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    const actualContentType = dependencies.detectContentType(bytes);
    if (
      bytes.byteLength !== command.sizeBytes
      || actualSha256 !== command.sha256
      || !actualContentType
      || actualContentType !== command.contentType
    ) throw new FileAssetError("File asset bytes do not match the command", "content-mismatch");

    const tenantId = context.principal.tenantId;
    const scopedKey = createHash("sha256")
      .update(`${tenantId}\0${command.idempotencyKey}`, "utf8")
      .digest("hex");
    try {
      const result = await dependencies.uploads.execute(
        scopedKey,
        commandFingerprint(command),
        async () => {
          const id = assetId();
          const key = storageKey();
          const createdAt = now().toISOString();
          let stored = false;
          let persisted = false;
          try {
            await dependencies.storage.stage(key, Uint8Array.from(bytes));
            stored = true;
            if (await dependencies.scanner.scan(key) !== "clean") {
              await audit(context, "file-assets:upload", id, "failed", "content-rejected");
              throw new FileAssetError("File asset content was rejected", "unsafe-content");
            }
            await dependencies.storage.promote(key);
            const internal: StoredFileAsset = {
              assetId: id,
              status: "available",
              sizeBytes: bytes.byteLength,
              contentType: actualContentType,
              sha256: actualSha256,
              createdAt,
              tenantId,
              storageKey: key,
            };
            await dependencies.repository.put(internal);
            persisted = true;
            await audit(context, "file-assets:upload", id, "succeeded", "content-accepted");
            return portable(internal);
          } catch (error) {
            if (persisted) await dependencies.repository.remove(tenantId, id).catch(() => undefined);
            if (stored) await dependencies.storage.delete(key).catch(() => undefined);
            throw error;
          }
        },
      );
      const current = await dependencies.repository.get(tenantId, result.assetId);
      if (!current || current.status !== "available") {
        throw new FileAssetError("File asset is no longer available", "asset-unavailable");
      }
      return portable(current);
    } catch (error) {
      if (error instanceof FileAssetError) throw error;
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "IDEMPOTENCY_CONFLICT") {
        throw new FileAssetError(
          "Idempotency key is bound to another upload",
          "idempotency-conflict",
        );
      }
      throw new FileAssetError("File asset upload failed", "delivery-failed", { cause: error });
    }
  }

  async function download(context: FileAssetContext, id: string): Promise<FileAssetDownload> {
    if (!validContext(context) || typeof id !== "string" || id.length < 16 || id.length > 255) {
      throw new FileAssetError("File asset request is invalid", "invalid-request");
    }
    await authorize(context, "file-assets:read", id);
    const current = await dependencies.repository.get(context.principal.tenantId, id);
    if (!current || current.status !== "available") {
      throw new FileAssetError("File asset is unavailable", "asset-unavailable");
    }
    try {
      const bytes = await dependencies.storage.read(current.storageKey);
      await audit(context, "file-assets:read", id, "succeeded", "asset-read");
      return { record: portable(current), bytes: Uint8Array.from(bytes) };
    } catch (error) {
      if (error instanceof FileAssetError) throw error;
      throw new FileAssetError("File asset delivery failed", "delivery-failed", { cause: error });
    }
  }

  async function remove(context: FileAssetContext, id: string): Promise<FileAssetRecord> {
    if (!validContext(context) || typeof id !== "string" || id.length < 16 || id.length > 255) {
      throw new FileAssetError("File asset request is invalid", "invalid-request");
    }
    await authorize(context, "file-assets:delete", id);
    const current = await dependencies.repository.get(context.principal.tenantId, id);
    if (!current) throw new FileAssetError("File asset is unavailable", "asset-unavailable");
    if (current.status === "deleted") return portable(current);
    if (current.status !== "available") {
      throw new FileAssetError("File asset is unavailable", "asset-unavailable");
    }
    try {
      await dependencies.storage.delete(current.storageKey);
      const deleted = await dependencies.repository.markDeleted(context.principal.tenantId, id);
      await audit(context, "file-assets:delete", id, "succeeded", "asset-deleted");
      return portable(deleted);
    } catch (error) {
      throw new FileAssetError("File asset deletion failed", "delivery-failed", { cause: error });
    }
  }

  return Object.freeze({ download, remove, upload });
}
