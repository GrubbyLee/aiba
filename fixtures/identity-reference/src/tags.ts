import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  TagAssignmentCommand,
  TagAssignmentResult,
  TagMutationCommand,
  TagPage,
  TagQueryCommand,
  TagRecord,
} from "aiba-spec";

const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export interface TagsContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
}

export interface TagsDependencies {
  authorize: (
    context: TagsContext,
    action: "tags:list" | "tags:list-archived" | "tags:mutate" | "tags:assign",
    resource?: { type: string; id: string },
  ) => Promise<boolean>;
  resourceExists: (context: TagsContext, resource: { type: string; id: string }) => Promise<boolean>;
  audit: (event: {
    action: string;
    outcome: "succeeded" | "failed";
    count: number;
    correlationId: string;
  }) => void;
  sanitizeText: (value: string) => string;
  cursorSecret: string;
  now: () => Date;
  tagId: () => string;
}

interface StoredTag extends TagRecord {
  tenantId: string;
  canonicalName: string;
}

interface AssignmentState {
  tagIds: Set<string>;
  revision: number;
  updatedAt: string;
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalizeName(name: string): { name: string; canonical: string; slug: string } {
  const normalized = name.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length < 1 || normalized.length > 100 || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new Error("invalid-tag-name");
  }
  const canonical = normalized.toLocaleLowerCase("en-US");
  const base = canonical.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "tag";
  return { name: normalized, canonical, slug: `${base}-${hash(canonical).slice(0, 12)}` };
}

function publicTag(tag: StoredTag, sanitizeText: (value: string) => string): TagRecord {
  const { tenantId: _tenantId, canonicalName: _canonicalName, ...record } = tag;
  return { ...record, name: sanitizeText(record.name) };
}

function signCursor(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function issueCursor(offset: number, scope: string, secret: string): string {
  const body = Buffer.from(JSON.stringify({ version: 1, offset, scope })).toString("base64url");
  return `${body}.${signCursor(body, secret)}`;
}

function readCursor(cursor: string, scope: string, secret: string): number {
  const [body, supplied, extra] = cursor.split(".");
  if (!body || !supplied || extra) throw new Error("invalid-tag-cursor");
  const actual = Buffer.from(supplied, "base64url");
  const expected = Buffer.from(signCursor(body, secret), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid-tag-cursor");
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.version !== 1 || !Number.isInteger(value.offset) || (value.offset as number) < 0 || value.scope !== scope) {
      throw new Error("invalid-tag-cursor");
    }
    return value.offset as number;
  } catch {
    throw new Error("invalid-tag-cursor");
  }
}

function resourceKey(tenantId: string, type: string, id: string): string {
  return `${tenantId}:${type}:${id}`;
}

export function createTagsService(dependencies: TagsDependencies) {
  if (Buffer.byteLength(dependencies.cursorSecret, "utf8") < 32) throw new Error("cursor-secret-too-short");
  const tags = new Map<string, StoredTag>();
  const assignments = new Map<string, AssignmentState>();
  const mutationKeys = new Map<string, { fingerprint: string; result: TagRecord }>();
  const assignmentKeys = new Map<string, { fingerprint: string; result: TagAssignmentResult }>();

  async function mutate(context: TagsContext, command: TagMutationCommand): Promise<TagRecord> {
    if (!hasOnlyKeys(command, ["action", "tagId", "name", "color", "expectedRevision", "idempotencyKey"])
      || !(["create", "update", "archive"] as const).includes(command.action)
      || typeof command.idempotencyKey !== "string" || command.idempotencyKey.length < 8 || command.idempotencyKey.length > 128
      || (command.color !== undefined && !COLOR_PATTERN.test(command.color))) {
      throw new Error("invalid-tag-mutation");
    }
    const createValid = command.action === "create" && command.tagId === undefined && command.expectedRevision === undefined && typeof command.name === "string";
    const updateValid = command.action === "update" && typeof command.tagId === "string" && Number.isInteger(command.expectedRevision)
      && command.expectedRevision! >= 1 && (typeof command.name === "string" || typeof command.color === "string");
    const archiveValid = command.action === "archive" && typeof command.tagId === "string" && Number.isInteger(command.expectedRevision)
      && command.expectedRevision! >= 1 && command.name === undefined && command.color === undefined;
    if (!createValid && !updateValid && !archiveValid) throw new Error("invalid-tag-mutation");
    if (!await dependencies.authorize(context, "tags:mutate")) throw new Error("tags-unavailable");

    const normalized = command.name === undefined ? undefined : normalizeName(command.name);
    const commandFingerprint = hash({
      action: command.action,
      tagId: command.tagId ?? null,
      name: normalized?.canonical ?? null,
      color: command.color?.toUpperCase() ?? null,
      expectedRevision: command.expectedRevision ?? null,
    });
    const scopedKey = `${context.tenantId}:${context.principalId}:${command.idempotencyKey}`;
    const prior = mutationKeys.get(scopedKey);
    if (prior) {
      if (prior.fingerprint !== commandFingerprint) throw new Error("idempotency-conflict");
      return { ...prior.result };
    }

    let tag: StoredTag;
    if (command.action === "create") {
      if ([...tags.values()].some((item) => item.tenantId === context.tenantId && item.canonicalName === normalized!.canonical)) {
        throw new Error("tag-name-conflict");
      }
      const now = dependencies.now().toISOString();
      tag = {
        tagId: dependencies.tagId(),
        tenantId: context.tenantId,
        canonicalName: normalized!.canonical,
        name: normalized!.name,
        slug: normalized!.slug,
        color: (command.color ?? "#64748B").toUpperCase(),
        status: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      tags.set(tag.tagId, tag);
    } else {
      const existing = tags.get(command.tagId!);
      if (!existing || existing.tenantId !== context.tenantId || existing.status === "archived" || existing.revision !== command.expectedRevision) {
        throw new Error("tag-mutation-conflict");
      }
      if (normalized && [...tags.values()].some((item) => item.tenantId === context.tenantId && item.tagId !== existing.tagId && item.canonicalName === normalized.canonical)) {
        throw new Error("tag-name-conflict");
      }
      const now = dependencies.now().toISOString();
      if (command.action === "update") {
        if (normalized) {
          existing.name = normalized.name;
          existing.canonicalName = normalized.canonical;
          existing.slug = normalized.slug;
        }
        if (command.color) existing.color = command.color.toUpperCase();
      } else {
        existing.status = "archived";
        existing.archivedAt = now;
      }
      existing.revision += 1;
      existing.updatedAt = now;
      tag = existing;
    }
    const result = publicTag(tag, dependencies.sanitizeText);
    mutationKeys.set(scopedKey, { fingerprint: commandFingerprint, result });
    dependencies.audit({ action: `tags:${command.action}`, outcome: "succeeded", count: 1, correlationId: context.correlationId });
    return result;
  }

  async function assign(context: TagsContext, command: TagAssignmentCommand): Promise<TagAssignmentResult> {
    if (!hasOnlyKeys(command, ["action", "resourceType", "resourceId", "tagIds", "expectedRevision", "idempotencyKey"])
      || !(["attach", "detach"] as const).includes(command.action) || !RESOURCE_TYPE_PATTERN.test(command.resourceType)
      || command.resourceId.length < 1 || command.resourceId.length > 160 || !Array.isArray(command.tagIds)
      || command.tagIds.length < 1 || command.tagIds.length > 50 || new Set(command.tagIds).size !== command.tagIds.length
      || command.tagIds.some((tagId) => typeof tagId !== "string" || tagId.length < 1 || tagId.length > 160)
      || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 0
      || command.idempotencyKey.length < 8 || command.idempotencyKey.length > 128) {
      throw new Error("invalid-tag-assignment");
    }
    const resource = { type: command.resourceType, id: command.resourceId };
    if (!await dependencies.authorize(context, "tags:assign", resource) || !await dependencies.resourceExists(context, resource)) {
      throw new Error("resource-unavailable");
    }
    const normalizedTagIds = [...command.tagIds].sort();
    const commandFingerprint = hash({ action: command.action, resource, tagIds: normalizedTagIds, expectedRevision: command.expectedRevision });
    const scopedKey = `${context.tenantId}:${context.principalId}:${command.idempotencyKey}`;
    const prior = assignmentKeys.get(scopedKey);
    if (prior) {
      if (prior.fingerprint !== commandFingerprint) throw new Error("idempotency-conflict");
      return { ...prior.result, tagIds: [...prior.result.tagIds] };
    }
    const selected: StoredTag[] = [];
    for (const tagId of command.tagIds) {
      const tag = tags.get(tagId);
      if (!tag || tag.tenantId !== context.tenantId || (command.action === "attach" && tag.status !== "active")) {
        throw new Error("tag-assignment-conflict");
      }
      selected.push(tag);
    }
    const key = resourceKey(context.tenantId, command.resourceType, command.resourceId);
    const state = assignments.get(key) ?? { tagIds: new Set<string>(), revision: 0, updatedAt: dependencies.now().toISOString() };
    if (state.revision !== command.expectedRevision) throw new Error("tag-assignment-conflict");
    const next = new Set(state.tagIds);
    let changedCount = 0;
    for (const tag of selected) {
      if (command.action === "attach") {
        if (!next.has(tag.tagId)) { next.add(tag.tagId); changedCount += 1; }
      } else if (next.delete(tag.tagId)) changedCount += 1;
    }
    if (next.size > 500) throw new Error("tag-assignment-limit");
    const now = dependencies.now().toISOString();
    const nextState: AssignmentState = { tagIds: next, revision: changedCount === 0 ? state.revision : state.revision + 1, updatedAt: now };
    assignments.set(key, nextState);
    const result: TagAssignmentResult = {
      resourceType: command.resourceType,
      resourceId: command.resourceId,
      tagIds: [...next].sort(),
      revision: nextState.revision,
      changedCount,
      updatedAt: now,
    };
    assignmentKeys.set(scopedKey, { fingerprint: commandFingerprint, result });
    dependencies.audit({ action: `tags:${command.action}`, outcome: "succeeded", count: changedCount, correlationId: context.correlationId });
    return result;
  }

  async function query(context: TagsContext, command: TagQueryCommand): Promise<TagPage> {
    if (!hasOnlyKeys(command, ["mode", "resourceType", "resourceId", "keyword", "includeArchived", "pageSize", "cursor"])
      || !(["catalog", "resource"] as const).includes(command.mode) || !Number.isInteger(command.pageSize) || command.pageSize < 1 || command.pageSize > 100
      || (command.keyword !== undefined && (command.keyword.trim().length < 1 || command.keyword.length > 100))
      || (command.mode === "catalog" && (command.resourceType !== undefined || command.resourceId !== undefined))
      || (command.mode === "resource" && (typeof command.resourceType !== "string" || !RESOURCE_TYPE_PATTERN.test(command.resourceType)
        || typeof command.resourceId !== "string" || command.resourceId.length < 1 || command.resourceId.length > 160))) {
      throw new Error("invalid-tag-query");
    }
    const resource = command.mode === "resource" ? { type: command.resourceType!, id: command.resourceId! } : undefined;
    const action = command.includeArchived ? "tags:list-archived" : "tags:list";
    if (!await dependencies.authorize(context, action, resource)
      || (resource !== undefined && !await dependencies.resourceExists(context, resource))) {
      throw new Error("tags-unavailable");
    }
    const scope = hash([context.tenantId, context.principalId, command.mode, command.resourceType ?? null, command.resourceId ?? null,
      command.keyword?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? null, command.includeArchived ?? false, command.pageSize]);
    const offset = command.cursor ? readCursor(command.cursor, scope, dependencies.cursorSecret) : 0;
    let assignmentRevision: number | undefined;
    let allowedTagIds: Set<string> | undefined;
    if (resource) {
      const state = assignments.get(resourceKey(context.tenantId, resource.type, resource.id));
      assignmentRevision = state?.revision ?? 0;
      allowedTagIds = state?.tagIds ?? new Set<string>();
    }
    const keyword = command.keyword?.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const filtered = [...tags.values()].filter((tag) => tag.tenantId === context.tenantId
      && (command.includeArchived || tag.status === "active") && (!allowedTagIds || allowedTagIds.has(tag.tagId))
      && (!keyword || tag.canonicalName.includes(keyword)))
      .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName) || left.tagId.localeCompare(right.tagId));
    const selected = filtered.slice(offset, offset + command.pageSize);
    const hasMore = offset + selected.length < filtered.length;
    return {
      tags: selected.map((tag) => publicTag(tag, dependencies.sanitizeText)),
      hasMore,
      ...(hasMore ? { nextCursor: issueCursor(offset + selected.length, scope, dependencies.cursorSecret) } : {}),
      ...(assignmentRevision === undefined ? {} : { assignmentRevision }),
    };
  }

  return { mutate, assign, query };
}
