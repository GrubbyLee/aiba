import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  InboxMessageRecord,
  InboxMessageStatus,
  InboxPage,
  InboxQueryCommand,
  InboxTransitionCommand,
  InboxTransitionResult,
} from "aiba-spec";

const CATEGORY_PATTERN = /^[a-z][a-z0-9.-]{1,79}$/;
const MAX_PAGE_SIZE = 100;

export interface InboxContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
}

export interface TrustedInboxEvent {
  tenantId: string;
  recipientId: string;
  sourceEventId: string;
  templateId: string;
  templateVersion: number;
  parameters: Record<string, string>;
}

export interface RenderedInboxTemplate {
  category: string;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
}

export interface InboxDependencies {
  authorize: (context: InboxContext, action: "inbox:list" | "inbox:transition") => Promise<boolean>;
  renderTemplate: (event: TrustedInboxEvent) => Promise<RenderedInboxTemplate | undefined>;
  audit: (event: {
    action: string;
    outcome: "succeeded" | "failed";
    count: number;
    correlationId: string;
  }) => void;
  sanitizeText: (value: string) => string;
  cursorSecret: string;
  now: () => Date;
  messageId: () => string;
}

interface StoredInboxMessage extends InboxMessageRecord {
  tenantId: string;
  recipientId: string;
  sourceEventId: string;
}

function publicRecord(message: StoredInboxMessage): InboxMessageRecord {
  const { tenantId: _tenantId, recipientId: _recipientId, sourceEventId: _sourceEventId, ...record } = message;
  return { ...record };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function cursorScope(context: InboxContext, command: InboxQueryCommand): string {
  return fingerprint([
    context.tenantId,
    context.principalId,
    [...(command.statuses ?? ["unread", "read"])].sort(),
    [...(command.categories ?? [])].sort(),
    command.pageSize,
  ]);
}

function cursorSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function issueCursor(offset: number, scope: string, secret: string): string {
  const body = Buffer.from(JSON.stringify({ version: 1, offset, scope })).toString("base64url");
  return `${body}.${cursorSignature(body, secret)}`;
}

function readCursor(cursor: string, scope: string, secret: string): number {
  const [body, supplied, extra] = cursor.split(".");
  if (!body || !supplied || extra) throw new Error("invalid-inbox-cursor");
  const actual = Buffer.from(supplied, "base64url");
  const expected = Buffer.from(cursorSignature(body, secret), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid-inbox-cursor");
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.version !== 1 || !Number.isInteger(value.offset) || (value.offset as number) < 0 || value.scope !== scope) {
      throw new Error("invalid-inbox-cursor");
    }
    return value.offset as number;
  } catch {
    throw new Error("invalid-inbox-cursor");
  }
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function createInboxService(dependencies: InboxDependencies) {
  if (Buffer.byteLength(dependencies.cursorSecret, "utf8") < 32) throw new Error("cursor-secret-too-short");
  const messages = new Map<string, StoredInboxMessage>();
  const sourceEvents = new Map<string, { fingerprint: string; messageId: string }>();
  const idempotency = new Map<string, { fingerprint: string; result: InboxTransitionResult }>();

  async function ingestTrustedEvent(event: TrustedInboxEvent): Promise<InboxMessageRecord> {
    if (!hasOnlyKeys(event, ["tenantId", "recipientId", "sourceEventId", "templateId", "templateVersion", "parameters"])
      || event.tenantId.length < 1 || event.tenantId.length > 160 || event.recipientId.length < 1 || event.recipientId.length > 160
      || event.sourceEventId.length < 1 || event.sourceEventId.length > 160 || !/^[a-z][a-z0-9-]{1,95}$/.test(event.templateId)
      || !Number.isInteger(event.templateVersion) || event.templateVersion < 1 || Object.keys(event.parameters).length > 30
      || Object.entries(event.parameters).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || value.length > 1000)) {
      throw new Error("invalid-trusted-inbox-event");
    }
    const sourceKey = `${event.tenantId}:${event.sourceEventId}`;
    const eventFingerprint = fingerprint({ ...event, parameters: Object.fromEntries(Object.entries(event.parameters).sort()) });
    const prior = sourceEvents.get(sourceKey);
    if (prior) {
      if (prior.fingerprint !== eventFingerprint) throw new Error("source-event-conflict");
      return publicRecord(messages.get(prior.messageId)!);
    }
    const rendered = await dependencies.renderTemplate(event);
    if (!rendered || !CATEGORY_PATTERN.test(rendered.category) || rendered.title.length < 1 || rendered.title.length > 300
      || rendered.body.length > 4000 || (rendered.resourceType !== undefined && !/^[a-z][a-z0-9-]{1,79}$/.test(rendered.resourceType))
      || (rendered.resourceId !== undefined && (rendered.resourceId.length < 1 || rendered.resourceId.length > 160))) {
      throw new Error("inbox-template-unavailable");
    }
    const now = dependencies.now().toISOString();
    const message: StoredInboxMessage = {
      messageId: dependencies.messageId(),
      tenantId: event.tenantId,
      recipientId: event.recipientId,
      sourceEventId: event.sourceEventId,
      category: rendered.category,
      title: dependencies.sanitizeText(rendered.title),
      body: dependencies.sanitizeText(rendered.body),
      status: "unread",
      ...(rendered.resourceType === undefined ? {} : { resourceType: rendered.resourceType }),
      ...(rendered.resourceId === undefined ? {} : { resourceId: rendered.resourceId }),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    messages.set(message.messageId, message);
    sourceEvents.set(sourceKey, { fingerprint: eventFingerprint, messageId: message.messageId });
    return publicRecord(message);
  }

  async function query(context: InboxContext, command: InboxQueryCommand): Promise<InboxPage> {
    if (!hasOnlyKeys(command, ["statuses", "categories", "pageSize", "cursor"])
      || !Number.isInteger(command.pageSize) || command.pageSize < 1 || command.pageSize > MAX_PAGE_SIZE
      || (command.statuses?.length ?? 0) > 3 || new Set(command.statuses).size !== (command.statuses?.length ?? 0)
      || command.statuses?.some((status) => !(["unread", "read", "archived"] as InboxMessageStatus[]).includes(status))
      || (command.categories?.length ?? 0) > 20 || new Set(command.categories).size !== (command.categories?.length ?? 0)
      || command.categories?.some((category) => !CATEGORY_PATTERN.test(category))) {
      throw new Error("invalid-inbox-query");
    }
    if (!await dependencies.authorize(context, "inbox:list")) throw new Error("inbox-unavailable");
    const scope = cursorScope(context, command);
    const offset = command.cursor ? readCursor(command.cursor, scope, dependencies.cursorSecret) : 0;
    const scoped = [...messages.values()].filter((message) => message.tenantId === context.tenantId && message.recipientId === context.principalId);
    const unreadCount = scoped.filter((message) => message.status === "unread").length;
    const statuses = command.statuses ?? ["unread", "read"];
    const filtered = scoped.filter((message) => statuses.includes(message.status)
      && (!command.categories || command.categories.includes(message.category)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.messageId.localeCompare(left.messageId));
    const selected = filtered.slice(offset, offset + command.pageSize);
    const hasMore = offset + selected.length < filtered.length;
    return {
      messages: selected.map(publicRecord),
      hasMore,
      ...(hasMore ? { nextCursor: issueCursor(offset + selected.length, scope, dependencies.cursorSecret) } : {}),
      unreadCount,
    };
  }

  async function transition(context: InboxContext, command: InboxTransitionCommand): Promise<InboxTransitionResult> {
    if (!hasOnlyKeys(command, ["action", "targets", "idempotencyKey"])
      || !(["mark-read", "mark-unread", "archive"] as const).includes(command.action)
      || command.targets.length < 1 || command.targets.length > 100 || command.idempotencyKey.length < 8 || command.idempotencyKey.length > 128
      || command.targets.some((target) => !hasOnlyKeys(target, ["messageId", "expectedRevision"])
        || target.messageId.length < 1 || target.messageId.length > 160 || !Number.isInteger(target.expectedRevision) || target.expectedRevision < 1)
      || new Set(command.targets.map((target) => target.messageId)).size !== command.targets.length) {
      throw new Error("invalid-inbox-transition");
    }
    if (!await dependencies.authorize(context, "inbox:transition")) throw new Error("inbox-unavailable");
    const normalizedTargets = [...command.targets].sort((left, right) => left.messageId.localeCompare(right.messageId));
    const commandFingerprint = fingerprint({ action: command.action, targets: normalizedTargets });
    const scopedKey = `${context.tenantId}:${context.principalId}:${command.idempotencyKey}`;
    const prior = idempotency.get(scopedKey);
    if (prior) {
      if (prior.fingerprint !== commandFingerprint) throw new Error("idempotency-conflict");
      return { ...prior.result, messages: prior.result.messages.map((message) => ({ ...message })) };
    }

    const selected: StoredInboxMessage[] = [];
    for (const target of command.targets) {
      const message = messages.get(target.messageId);
      if (!message || message.tenantId !== context.tenantId || message.recipientId !== context.principalId
        || message.revision !== target.expectedRevision || (message.status === "archived" && command.action !== "archive")) {
        dependencies.audit({ action: "inbox:transition", outcome: "failed", count: command.targets.length, correlationId: context.correlationId });
        throw new Error("inbox-transition-conflict");
      }
      selected.push(message);
    }

    const now = dependencies.now().toISOString();
    let changedCount = 0;
    for (const message of selected) {
      const nextStatus: InboxMessageStatus = command.action === "mark-read" ? "read" : command.action === "mark-unread" ? "unread" : "archived";
      if (message.status === nextStatus) continue;
      message.status = nextStatus;
      message.revision += 1;
      message.updatedAt = now;
      if (nextStatus === "read") message.readAt = now;
      if (nextStatus === "unread") delete message.readAt;
      if (nextStatus === "archived") message.archivedAt = now;
      changedCount += 1;
    }
    const result: InboxTransitionResult = {
      action: command.action,
      messages: selected.map((message) => ({ messageId: message.messageId, status: message.status, revision: message.revision, updatedAt: message.updatedAt })),
      changedCount,
      transitionedAt: now,
    };
    idempotency.set(scopedKey, { fingerprint: commandFingerprint, result });
    dependencies.audit({ action: "inbox:transition", outcome: "succeeded", count: changedCount, correlationId: context.correlationId });
    return result;
  }

  return { ingestTrustedEvent, query, transition };
}
