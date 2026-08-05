import { describe, expect, it } from "vitest";
import { createCommentsActivityService } from "./comments-activity.js";

function fixture(authorized = true) {
  let commentSequence = 0;
  let activitySequence = 0;
  const service = createCommentsActivityService({ authorize: async () => authorized, userExists: async (tenant, user) => tenant === "tenant-a" && user.startsWith("user-"), resourceExists: async (tenant, type, id) => tenant === "tenant-a" && type === "vehicle" && id === "vehicle-1", now: () => new Date("2026-08-05T01:00:00Z"), commentId: () => `comment_${++commentSequence}`.padEnd(12, "0"), activityId: () => `activity_${++activitySequence}`.padEnd(12, "0") });
  return { service, context: { tenantId: "tenant-a", principalId: "user-1", correlationId: "request-1" }, create: { action: "create" as const, resourceType: "vehicle", resourceId: "vehicle-1", body: "Ready for review", mentionUserIds: ["user-2"], idempotencyKey: "comment-create-1" } };
}

describe("comments and activity reference boundary", () => {
  it("attributes create and edit to trusted context", async () => {
    const f = fixture();
    const created = await f.service.mutate(f.context, f.create);
    expect(created).toMatchObject({ authorId: "user-1", revision: 1, body: "Ready for review" });
    const edited = await f.service.mutate(f.context, { action: "edit", resourceType: "vehicle", resourceId: "vehicle-1", commentId: created.commentId, body: "Approved", expectedRevision: 1, idempotencyKey: "comment-edit-01" });
    expect(edited).toMatchObject({ revision: 2, body: "Approved" });
    expect((await f.service.listActivity(f.context, { type: "vehicle", id: "vehicle-1" })).map((item) => item.action)).toEqual(["comment-created", "comment-edited"]);
  });
  it("soft deletes content while retaining immutable attribution", async () => {
    const f = fixture();
    const created = await f.service.mutate(f.context, f.create);
    const deleted = await f.service.mutate(f.context, { action: "delete", resourceType: "vehicle", resourceId: "vehicle-1", commentId: created.commentId, expectedRevision: 1, idempotencyKey: "comment-delete-1" });
    expect(deleted).toMatchObject({ status: "deleted", revision: 2, mentionUserIds: [] });
    expect(deleted).not.toHaveProperty("body");
    expect(await f.service.listActivity(f.context, { type: "vehicle", id: "vehicle-1" })).toHaveLength(2);
  });
  it("rejects authorization, unknown mentions, and resource scope", async () => {
    const denied = fixture(false);
    await expect(denied.service.mutate(denied.context, denied.create)).rejects.toThrow("comment-unavailable");
    const f = fixture();
    await expect(f.service.mutate(f.context, { ...f.create, mentionUserIds: ["external"] })).rejects.toThrow("comment-unavailable");
    await expect(f.service.mutate(f.context, { ...f.create, resourceId: "vehicle-2" })).rejects.toThrow("comment-unavailable");
  });
  it("rejects stale edits and control characters", async () => {
    const f = fixture();
    const created = await f.service.mutate(f.context, f.create);
    await expect(f.service.mutate(f.context, { action: "edit", resourceType: "vehicle", resourceId: "vehicle-1", commentId: created.commentId, body: "stale", expectedRevision: 2, idempotencyKey: "comment-edit-01" })).rejects.toThrow("comment-conflict");
    await expect(f.service.mutate(f.context, { ...f.create, body: "bad\u0000text", idempotencyKey: "comment-create-2" })).rejects.toThrow("comment-invalid");
  });
  it("deduplicates exact creates and rejects changed reuse", async () => {
    const f = fixture();
    expect(await f.service.mutate(f.context, f.create)).toEqual(await f.service.mutate(f.context, f.create));
    await expect(f.service.mutate(f.context, { ...f.create, body: "changed" })).rejects.toThrow("idempotency-conflict");
    expect(await f.service.listActivity(f.context, { type: "vehicle", id: "vehicle-1" })).toHaveLength(1);
  });
});
