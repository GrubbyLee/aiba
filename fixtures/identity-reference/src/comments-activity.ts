import type { ActivityRecord, CommentCommand, CommentRecord } from "aiba-spec";

export interface CommentContext { tenantId: string; principalId: string; correlationId: string }
interface StoredComment extends CommentRecord { tenantId: string; commandFingerprint?: string }
interface StoredActivity extends ActivityRecord { tenantId: string }

export interface CommentsActivityDependencies {
  authorize: (context: CommentContext, action: string, resource: { type: string; id: string }) => Promise<boolean>;
  userExists: (tenantId: string, userId: string) => Promise<boolean>;
  resourceExists: (tenantId: string, type: string, id: string) => Promise<boolean>;
  now: () => Date;
  commentId: () => string;
  activityId: () => string;
}

function publicComment(comment: StoredComment): CommentRecord {
  const { tenantId: _tenant, commandFingerprint: _fingerprint, ...record } = comment;
  return { ...record, mentionUserIds: [...record.mentionUserIds] };
}

export function createCommentsActivityService(dependencies: CommentsActivityDependencies) {
  const comments = new Map<string, StoredComment>();
  const activities: StoredActivity[] = [];
  const idempotency = new Map<string, { fingerprint: string; commentId: string }>();

  async function mutate(context: CommentContext, command: CommentCommand): Promise<CommentRecord> {
    const resource = { type: command.resourceType, id: command.resourceId };
    if (!await dependencies.authorize(context, `comments:${command.action}`, resource)
      || !await dependencies.resourceExists(context.tenantId, resource.type, resource.id)) throw new Error("comment-unavailable");
    const key = `${context.tenantId}:${command.idempotencyKey}`;
    const fingerprint = JSON.stringify(command);
    const prior = idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("idempotency-conflict");
      return publicComment(comments.get(prior.commentId)!);
    }
    const mentions = command.mentionUserIds ?? [];
    if (mentions.length > 20 || !(await Promise.all(mentions.map((id) => dependencies.userExists(context.tenantId, id)))).every(Boolean)) throw new Error("comment-unavailable");
    const now = dependencies.now().toISOString();
    let comment: StoredComment;
    let action: ActivityRecord["action"];
    if (command.action === "create") {
      const body = command.body?.trim();
      if (!body || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) throw new Error("comment-invalid");
      comment = { commentId: dependencies.commentId(), resourceType: resource.type, resourceId: resource.id, authorId: context.principalId, body, status: "active", mentionUserIds: [...mentions], revision: 1, createdAt: now, updatedAt: now, tenantId: context.tenantId };
      comments.set(comment.commentId, comment);
      action = "comment-created";
    } else {
      const existing = command.commentId ? comments.get(command.commentId) : undefined;
      if (!existing || existing.tenantId !== context.tenantId || existing.resourceType !== resource.type || existing.resourceId !== resource.id
        || existing.status !== "active" || command.expectedRevision !== existing.revision) throw new Error("comment-conflict");
      comment = existing;
      if (command.action === "edit") {
        const body = command.body?.trim();
        if (!body || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) throw new Error("comment-invalid");
        comment.body = body;
        comment.mentionUserIds = [...mentions];
        action = "comment-edited";
      } else {
        comment.status = "deleted";
        comment.mentionUserIds = [];
        delete comment.body;
        action = "comment-deleted";
      }
      comment.revision += 1;
      comment.updatedAt = now;
    }
    activities.push({ activityId: dependencies.activityId(), resourceType: resource.type, resourceId: resource.id, actorId: context.principalId, action, occurredAt: now, correlationId: context.correlationId, tenantId: context.tenantId });
    idempotency.set(key, { fingerprint, commentId: comment.commentId });
    return publicComment(comment);
  }

  async function listActivity(context: CommentContext, resource: { type: string; id: string }): Promise<ActivityRecord[]> {
    if (!await dependencies.authorize(context, "activity:list", resource)) throw new Error("activity-unavailable");
    return activities.filter((item) => item.tenantId === context.tenantId && item.resourceType === resource.type && item.resourceId === resource.id).map(({ tenantId: _tenant, ...item }) => ({ ...item }));
  }
  return { listActivity, mutate };
}
