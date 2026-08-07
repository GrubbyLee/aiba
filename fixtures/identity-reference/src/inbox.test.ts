import { describe, expect, it } from "vitest";
import { createInboxService } from "./inbox.js";

function fixture(options: { authorized?: boolean } = {}) {
  let nextId = 1;
  let tick = 0;
  const audits: unknown[] = [];
  const service = createInboxService({
    authorize: async () => options.authorized !== false,
    renderTemplate: async (event) => event.templateId === "task-ready" && event.templateVersion === 1 ? {
      category: "fleet.update",
      title: `Task <${event.parameters.plate}> ready`,
      body: "Open the fleet record.",
      resourceType: "task",
      resourceId: event.parameters.taskId!,
    } : undefined,
    audit: (event) => audits.push(event),
    sanitizeText: (value) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    cursorSecret: "inbox-test-secret-with-at-least-32-bytes",
    now: () => new Date(Date.UTC(2026, 7, 7, 0, tick++, 0)),
    messageId: () => `message-${nextId++}`,
  });
  const context = { tenantId: "tenant-a", principalId: "user-1", correlationId: "correlation-1" };
  async function ingest(recipientId = "user-1", sourceEventId = `event-${nextId}`) {
    return service.ingestTrustedEvent({
      tenantId: "tenant-a",
      recipientId,
      sourceEventId,
      templateId: "task-ready",
      templateVersion: 1,
      parameters: { plate: "A123", taskId: "task-1" },
    });
  }
  return { service, context, ingest, audits };
}

describe("inbox reference boundary", () => {
  it("creates sanitized messages only from trusted versioned templates", async () => {
    const f = fixture();
    const message = await f.ingest();
    expect(message).toMatchObject({ status: "unread", title: "Task &lt;A123&gt; ready", revision: 1 });
    expect(JSON.stringify(message)).not.toContain("recipientId");
    await expect(f.service.ingestTrustedEvent({ tenantId: "tenant-a", recipientId: "user-1", sourceEventId: "bad", templateId: "unknown", templateVersion: 1, parameters: {} })).rejects.toThrow("inbox-template-unavailable");
  });

  it("deduplicates an exact source event and rejects changed reuse", async () => {
    const f = fixture();
    expect(await f.ingest("user-1", "event-same")).toEqual(await f.ingest("user-1", "event-same"));
    await expect(f.service.ingestTrustedEvent({ tenantId: "tenant-a", recipientId: "user-2", sourceEventId: "event-same", templateId: "task-ready", templateVersion: 1, parameters: { plate: "A123", taskId: "task-1" } })).rejects.toThrow("source-event-conflict");
  });

  it("derives tenant and recipient scope from authenticated context", async () => {
    const f = fixture();
    await f.ingest("user-1", "event-user-1");
    await f.ingest("user-2", "event-user-2");
    const page = await f.service.query(f.context, { pageSize: 10 });
    expect(page.messages).toHaveLength(1);
    expect(page.unreadCount).toBe(1);
  });

  it("rejects caller scope injection and unauthorized access", async () => {
    const f = fixture({ authorized: false });
    await expect(f.service.query(f.context, { pageSize: 10, tenantId: "tenant-b" } as never)).rejects.toThrow("invalid-inbox-query");
    await expect(f.service.query(f.context, { pageSize: 10 })).rejects.toThrow("inbox-unavailable");
  });

  it("uses stable bounded pages and rejects cursor tamper or principal replay", async () => {
    const f = fixture();
    await f.ingest("user-1", "event-1");
    await f.ingest("user-1", "event-2");
    const first = await f.service.query(f.context, { pageSize: 1 });
    expect(first.hasMore).toBe(true);
    const cursor = first.nextCursor;
    if (!cursor) throw new Error("expected next cursor");
    const second = await f.service.query(f.context, { pageSize: 1, cursor });
    expect(second.messages[0]?.messageId).not.toBe(first.messages[0]?.messageId);
    await expect(f.service.query(f.context, { pageSize: 1, cursor: `${cursor}x` })).rejects.toThrow("invalid-inbox-cursor");
    await expect(f.service.query({ ...f.context, principalId: "user-2" }, { pageSize: 1, cursor })).rejects.toThrow("invalid-inbox-cursor");
    await expect(f.service.query(f.context, { pageSize: 101 })).rejects.toThrow("invalid-inbox-query");
  });

  it("filters categories and states without changing the global unread count", async () => {
    const f = fixture();
    const message = await f.ingest();
    await f.service.transition(f.context, { action: "mark-read", targets: [{ messageId: message.messageId, expectedRevision: 1 }], idempotencyKey: "read-message-1" });
    const page = await f.service.query(f.context, { pageSize: 10, statuses: ["read"], categories: ["fleet.update"] });
    expect(page.messages).toHaveLength(1);
    expect(page.unreadCount).toBe(0);
  });

  it("applies revisioned transitions and exact idempotency", async () => {
    const f = fixture();
    const message = await f.ingest();
    const command = { action: "mark-read" as const, targets: [{ messageId: message.messageId, expectedRevision: 1 }], idempotencyKey: "read-message-1" };
    const first = await f.service.transition(f.context, command);
    expect(first).toMatchObject({ changedCount: 1, messages: [{ status: "read", revision: 2 }] });
    expect(await f.service.transition(f.context, command)).toEqual(first);
    await expect(f.service.transition(f.context, { ...command, action: "archive" })).rejects.toThrow("idempotency-conflict");
  });

  it("rejects an entire batch when one revision is stale", async () => {
    const f = fixture();
    const one = await f.ingest("user-1", "event-one");
    const two = await f.ingest("user-1", "event-two");
    await expect(f.service.transition(f.context, { action: "mark-read", targets: [
      { messageId: one.messageId, expectedRevision: 1 },
      { messageId: two.messageId, expectedRevision: 99 },
    ], idempotencyKey: "batch-read-1" })).rejects.toThrow("inbox-transition-conflict");
    const page = await f.service.query(f.context, { pageSize: 10, statuses: ["unread"] });
    expect(page.messages).toHaveLength(2);
  });

  it("keeps archived messages terminal", async () => {
    const f = fixture();
    const message = await f.ingest();
    await f.service.transition(f.context, { action: "archive", targets: [{ messageId: message.messageId, expectedRevision: 1 }], idempotencyKey: "archive-message-1" });
    await expect(f.service.transition(f.context, { action: "mark-unread", targets: [{ messageId: message.messageId, expectedRevision: 2 }], idempotencyKey: "reopen-message-1" })).rejects.toThrow("inbox-transition-conflict");
  });

  it("writes minimized transition audit without message content or recipient", async () => {
    const f = fixture();
    const message = await f.ingest();
    await f.service.transition(f.context, { action: "mark-read", targets: [{ messageId: message.messageId, expectedRevision: 1 }], idempotencyKey: "audit-message-1" });
    expect(f.audits).toEqual([{ action: "inbox:transition", outcome: "succeeded", count: 1, correlationId: "correlation-1" }]);
    expect(JSON.stringify(f.audits)).not.toContain("Task");
  });
});
