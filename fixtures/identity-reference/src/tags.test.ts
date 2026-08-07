import { describe, expect, it } from "vitest";
import { createTagsService } from "./tags.js";

function fixture(options: { authorized?: boolean; resourceExists?: boolean } = {}) {
  let nextId = 1;
  let tick = 0;
  const audits: unknown[] = [];
  const service = createTagsService({
    authorize: async () => options.authorized !== false,
    resourceExists: async (context, resource) => options.resourceExists !== false && context.tenantId === "tenant-a" && resource.type === "vehicle" && resource.id === "vehicle-1",
    audit: (event) => audits.push(event),
    sanitizeText: (value) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    cursorSecret: "tags-test-secret-with-at-least-32-bytes",
    now: () => new Date(Date.UTC(2026, 7, 7, 1, tick++, 0)),
    tagId: () => `tag-${nextId++}`,
  });
  const context = { tenantId: "tenant-a", principalId: "user-1", correlationId: "correlation-1" };
  async function create(name: string, key = `create-tag-${nextId}`, color?: string) {
    return service.mutate(context, { action: "create", name, ...(color ? { color } : {}), idempotencyKey: key });
  }
  return { service, context, create, audits };
}

describe("tags reference boundary", () => {
  it("normalizes, sanitizes, and server-slugs a new tag", async () => {
    const f = fixture();
    const tag = await f.create("  Urgent <Now>  ", "create-urgent", "#aabbcc");
    expect(tag).toMatchObject({ name: "Urgent &lt;Now&gt;", color: "#AABBCC", status: "active", revision: 1 });
    expect(tag.slug).toMatch(/^urgent-now-[a-f0-9]{12}$/);
    expect(JSON.stringify(tag)).not.toContain("tenantId");
  });

  it("enforces normalized tenant uniqueness across case and whitespace", async () => {
    const f = fixture();
    await f.create("Fleet Priority", "create-priority-1");
    await expect(f.create("  FLEET   PRIORITY ", "create-priority-2")).rejects.toThrow("tag-name-conflict");
  });

  it("rejects unauthorized operations and caller scope injection", async () => {
    const denied = fixture({ authorized: false });
    await expect(denied.create("Urgent", "create-denied")).rejects.toThrow("tags-unavailable");
    const f = fixture();
    await expect(f.service.mutate(f.context, { action: "create", name: "Urgent", idempotencyKey: "create-injected", tenantId: "tenant-b" } as never)).rejects.toThrow("invalid-tag-mutation");
  });

  it("uses exact revision and idempotency for updates", async () => {
    const f = fixture();
    const tag = await f.create("Urgent", "create-urgent");
    const command = { action: "update" as const, tagId: tag.tagId, name: "Critical", expectedRevision: 1, idempotencyKey: "update-urgent" };
    const updated = await f.service.mutate(f.context, command);
    expect(updated).toMatchObject({ name: "Critical", revision: 2 });
    expect(await f.service.mutate(f.context, command)).toEqual(updated);
    await expect(f.service.mutate(f.context, { ...command, color: "#FF0000" })).rejects.toThrow("idempotency-conflict");
    await expect(f.service.mutate(f.context, { ...command, idempotencyKey: "stale-update" })).rejects.toThrow("tag-mutation-conflict");
  });

  it("attaches active same-tenant tags to an existing authorized resource", async () => {
    const f = fixture();
    const one = await f.create("Urgent", "create-one");
    const two = await f.create("Inspection", "create-two");
    const result = await f.service.assign(f.context, { action: "attach", resourceType: "vehicle", resourceId: "vehicle-1", tagIds: [one.tagId, two.tagId], expectedRevision: 0, idempotencyKey: "attach-tags-1" });
    expect(result).toMatchObject({ changedCount: 2, revision: 1 });
    expect(result.tagIds).toEqual([one.tagId, two.tagId]);
  });

  it("rejects the complete assignment for missing resources, tags, or stale revisions", async () => {
    const missingResource = fixture({ resourceExists: false });
    await expect(missingResource.service.assign(missingResource.context, { action: "attach", resourceType: "vehicle", resourceId: "vehicle-1", tagIds: ["tag-1"], expectedRevision: 0, idempotencyKey: "attach-missing" })).rejects.toThrow("resource-unavailable");
    const f = fixture();
    const tag = await f.create("Urgent", "create-urgent");
    await expect(f.service.assign(f.context, { action: "attach", resourceType: "vehicle", resourceId: "vehicle-1", tagIds: [tag.tagId, "unknown"], expectedRevision: 0, idempotencyKey: "attach-unknown" })).rejects.toThrow("tag-assignment-conflict");
    const page = await f.service.query(f.context, { mode: "resource", resourceType: "vehicle", resourceId: "vehicle-1", pageSize: 10 });
    expect(page.tags).toHaveLength(0);
  });

  it("binds assignment idempotency to exact sorted tag IDs and revision", async () => {
    const f = fixture();
    const tag = await f.create("Urgent", "create-urgent");
    const command = { action: "attach" as const, resourceType: "vehicle", resourceId: "vehicle-1", tagIds: [tag.tagId], expectedRevision: 0, idempotencyKey: "attach-urgent" };
    const first = await f.service.assign(f.context, command);
    expect(await f.service.assign(f.context, command)).toEqual(first);
    await expect(f.service.assign(f.context, { ...command, action: "detach" })).rejects.toThrow("idempotency-conflict");
  });

  it("keeps archived history, blocks new attach, and permits detach cleanup", async () => {
    const f = fixture();
    const tag = await f.create("Legacy", "create-legacy");
    await f.service.assign(f.context, { action: "attach", resourceType: "vehicle", resourceId: "vehicle-1", tagIds: [tag.tagId], expectedRevision: 0, idempotencyKey: "attach-legacy" });
    const archived = await f.service.mutate(f.context, { action: "archive", tagId: tag.tagId, expectedRevision: 1, idempotencyKey: "archive-legacy" });
    expect(archived.status).toBe("archived");
    await expect(f.service.assign(f.context, { action: "attach", resourceType: "vehicle", resourceId: "vehicle-1", tagIds: [tag.tagId], expectedRevision: 1, idempotencyKey: "reattach-legacy" })).rejects.toThrow("tag-assignment-conflict");
    await expect(f.service.assign(f.context, { action: "detach", resourceType: "vehicle", resourceId: "vehicle-1", tagIds: [tag.tagId], expectedRevision: 1, idempotencyKey: "detach-legacy" })).resolves.toMatchObject({ changedCount: 1, revision: 2 });
    await expect(f.service.mutate(f.context, { action: "update", tagId: tag.tagId, name: "Restored", expectedRevision: 2, idempotencyKey: "restore-legacy" })).rejects.toThrow("tag-mutation-conflict");
  });

  it("queries bounded stable pages and rejects cursor tamper or scope replay", async () => {
    const f = fixture();
    await f.create("Alpha", "create-alpha");
    await f.create("Beta", "create-beta");
    const first = await f.service.query(f.context, { mode: "catalog", pageSize: 1 });
    const cursor = first.nextCursor;
    if (!cursor) throw new Error("expected next cursor");
    const second = await f.service.query(f.context, { mode: "catalog", pageSize: 1, cursor });
    expect(second.tags[0]?.tagId).not.toBe(first.tags[0]?.tagId);
    await expect(f.service.query(f.context, { mode: "catalog", pageSize: 1, cursor: `${cursor}x` })).rejects.toThrow("invalid-tag-cursor");
    await expect(f.service.query({ ...f.context, principalId: "user-2" }, { mode: "catalog", pageSize: 1, cursor })).rejects.toThrow("invalid-tag-cursor");
    await expect(f.service.query(f.context, { mode: "catalog", pageSize: 101 })).rejects.toThrow("invalid-tag-query");
  });

  it("writes minimized audit without tag names, tenant values, or resource payloads", async () => {
    const f = fixture();
    await f.create("Sensitive Label", "create-sensitive");
    expect(f.audits).toEqual([{ action: "tags:create", outcome: "succeeded", count: 1, correlationId: "correlation-1" }]);
    expect(JSON.stringify(f.audits)).not.toContain("Sensitive");
    expect(JSON.stringify(f.audits)).not.toContain("tenant-a");
  });
});
