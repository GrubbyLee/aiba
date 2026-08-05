import { describe, expect, it } from "vitest";
import {
  validateActivityRecord,
  validateAuditEvent,
  validateAuthorizationDecision,
  validateCommentCommand,
  validateCommentRecord,
  validateCapabilityManifest,
  validateDataExportCommand,
  validateDataImportCommand,
  validateFileAssetRecord,
  validateFileAssetUploadCommand,
  validateFeatureFlagEvaluationCommand,
  validateFeatureFlagEvaluationResult,
  validateImportExportJobRecord,
  validateNotificationCommand,
  validateNotificationReceipt,
  validateOperationControl,
  validateOrganizationMembershipCommand,
  validateOrganizationMembershipRecord,
  validatePrincipal,
  validateResourcePage,
  validateResourceQuery,
  validateScheduledJobCommand,
  validateScheduledJobRecord,
  validateVehicleCreateCommand,
  validateVehicleRecord,
  validateVehicleUpdateCommand,
  validateVerificationChallengeIssueCommand,
  validateVerificationChallengeRecord,
  validateVerificationChallengeVerifyCommand,
  validateWebhookDeliveryCommand,
  validateWebhookDeliveryRecord,
  validateWechatMiniProgramLoginCommand,
  validateWechatMiniProgramLoginResult,
} from "./validation.js";

describe("core portable interfaces", () => {
  it("accepts only defined capability layers while preserving legacy manifests", () => {
    const manifest = {
      apiVersion: "aiba.dev/v0alpha1",
      kind: "Capability",
      metadata: {
        id: "sample-capability",
        version: "0.1.0",
        title: "Sample",
        description: "A sample capability.",
      },
      spec: {
        interfaces: [],
        dependencies: [],
        invariants: [{
          id: "sample-invariant",
          title: "Sample invariant",
          description: "The sample remains verifiable.",
          severity: "error",
          evidence: {
            acceptedTypes: ["source"],
            requiredTypes: ["source"],
            minimum: 1,
            requireHash: true,
          },
        }],
      },
    };
    expect(validateCapabilityManifest(manifest).metadata.layer).toBeUndefined();
    expect(validateCapabilityManifest({
      ...manifest,
      metadata: { ...manifest.metadata, layer: "business-capability" },
    }).metadata.layer).toBe("business-capability");
    expect(() => validateCapabilityManifest({
      ...manifest,
      metadata: { ...manifest.metadata, layer: "ui-template" },
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("accepts a minimal server-derived principal", () => {
    expect(validatePrincipal({
      type: "user",
      subject: "user-42",
      tenantId: "tenant-a",
    })).toEqual({ type: "user", subject: "user-42", tenantId: "tenant-a" });
  });

  it("rejects roles, permissions, and unknown principal claims", () => {
    expect(() => validatePrincipal({
      type: "user",
      subject: "user-42",
      roles: ["admin"],
      permissions: ["users:write"],
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates an explicit authorization decision", () => {
    expect(validateAuthorizationDecision({
      decisionId: "decision-00000001",
      principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      action: "users:read",
      resource: { type: "user", id: "user-99", tenantId: "tenant-a" },
      allowed: false,
      reasonCode: "not-owner",
      policyVersion: "policy-7",
      evaluatedAt: "2026-07-26T00:00:00Z",
    }).allowed).toBe(false);
    expect(() => validateAuthorizationDecision({
      decisionId: "decision-00000001",
      principal: { type: "user", subject: "user-42" },
      action: "admin",
      resource: { type: "system" },
      allowed: true,
      reasonCode: "admin",
      policyVersion: "policy-7",
      evaluatedAt: "2026-07-26T00:00:00Z",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("rejects reusable secrets in the portable audit event shape", () => {
    expect(validateAuditEvent({
      eventId: "event-00000000001",
      action: "identity:authenticate",
      outcome: "denied",
      actor: { type: "anonymous", subject: "transport:hashed" },
      reasonCode: "invalid-credentials",
      occurredAt: "2026-07-26T00:00:00Z",
      correlationId: "request-001",
    }).outcome).toBe("denied");
    expect(() => validateAuditEvent({
      eventId: "event-00000000001",
      action: "identity:authenticate",
      outcome: "denied",
      actor: { type: "anonymous", subject: "transport:hashed" },
      occurredAt: "2026-07-26T00:00:00Z",
      correlationId: "request-001",
      password: "reusable-secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates template notification commands and minimized receipts", () => {
    expect(validateNotificationCommand({
      recipientId: "user-42",
      channel: "wechat-template",
      templateId: "account-disabled",
      parameters: { displayName: "User" },
      idempotencyKey: "workflow-00000001",
    }).channel).toBe("wechat-template");
    expect(validateNotificationReceipt({
      notificationId: "notification-0001",
      status: "sent",
      channel: "wechat-template",
      templateId: "account-disabled",
      createdAt: "2026-07-26T00:00:00Z",
    }).status).toBe("sent");
    expect(() => validateNotificationCommand({
      recipientId: "user-42",
      channel: "wechat-template",
      templateId: "account-disabled",
      parameters: {},
      idempotencyKey: "workflow-00000001",
      providerSecret: "secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates bounded resource queries, pages, and mutation controls", () => {
    expect(validateResourceQuery({
      pageSize: 50,
      filters: [{ field: "status", operator: "in", value: ["active", "pending"] }],
      sort: [{ field: "createdAt", direction: "desc" }],
    }).pageSize).toBe(50);
    expect(validateResourcePage({
      items: [{ resourceId: "resource-1" }],
      hasMore: true,
      nextCursor: "cursor_part.signature_part",
    }).hasMore).toBe(true);
    expect(validateOperationControl({
      idempotencyKey: "operation-0001",
      expectedRevision: 3,
    }).expectedRevision).toBe(3);
  });

  it("validates scheduled job commands and minimized records", () => {
    expect(validateScheduledJobCommand({
      definitionId: "daily-report",
      scheduledFor: "2026-08-05T01:00:00Z",
      idempotencyKey: "schedule-0001",
    }).definitionId).toBe("daily-report");
    expect(validateScheduledJobRecord({
      jobId: "job_daily_0001",
      definitionId: "daily-report",
      status: "queued",
      attempt: 0,
      maximumAttempts: 2,
      scheduledFor: "2026-08-05T01:00:00Z",
      createdAt: "2026-08-05T00:59:00Z",
    }).status).toBe("queued");
    expect(() => validateScheduledJobCommand({
      definitionId: "daily-report",
      scheduledFor: "2026-08-05T01:00:00Z",
      idempotencyKey: "schedule-0001",
      handler: "curl https://example.test/secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates webhook selectors without accepting destinations or secrets", () => {
    expect(validateWebhookDeliveryCommand({
      subscriptionId: "subscription_0001",
      eventType: "vehicle.updated",
      resourceId: "vehicle-1",
      idempotencyKey: "webhook-0001",
    }).eventType).toBe("vehicle.updated");
    expect(validateWebhookDeliveryRecord({
      deliveryId: "delivery_0001",
      subscriptionId: "subscription_0001",
      eventType: "vehicle.updated",
      status: "pending",
      attempt: 0,
      maximumAttempts: 3,
      createdAt: "2026-08-05T01:00:00Z",
    }).status).toBe("pending");
    expect(() => validateWebhookDeliveryCommand({
      subscriptionId: "subscription_0001",
      eventType: "vehicle.updated",
      resourceId: "vehicle-1",
      idempotencyKey: "webhook-0001",
      url: "http://169.254.169.254/latest/meta-data",
      secret: "caller-secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates feature flag selectors without caller-owned targeting context", () => {
    expect(validateFeatureFlagEvaluationCommand({ flagKey: "vehicle.beta", expectedRevision: 3 }).expectedRevision).toBe(3);
    expect(validateFeatureFlagEvaluationResult({
      flagKey: "vehicle.beta",
      enabled: true,
      variant: "compact",
      reason: "rollout",
      policyRevision: 3,
      evaluatedAt: "2026-08-05T01:00:00Z",
    }).variant).toBe("compact");
    expect(() => validateFeatureFlagEvaluationCommand({
      flagKey: "vehicle.beta",
      attributes: { plan: "enterprise" },
      subjectId: "chosen-subject",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates organization membership mutations without caller-owned scope", () => {
    expect(validateOrganizationMembershipCommand({ action: "change-role", userId: "user-2", roleId: "manager", expectedRevision: 2, idempotencyKey: "member-change-1" }).roleId).toBe("manager");
    expect(validateOrganizationMembershipRecord({ membershipId: "membership_001", organizationId: "organization-1", userId: "user-2", roleId: "manager", status: "active", revision: 3, createdAt: "2026-08-05T01:00:00Z", updatedAt: "2026-08-05T01:01:00Z" }).revision).toBe(3);
    expect(() => validateOrganizationMembershipCommand({ action: "add", userId: "user-2", roleId: "owner", idempotencyKey: "member-change-1", tenantId: "tenant-b", organizationId: "organization-b" })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateOrganizationMembershipCommand({ action: "remove", userId: "user-2", roleId: "owner", idempotencyKey: "member-change-1" })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates bounded comments and attributable activity", () => {
    expect(validateCommentCommand({ action: "create", resourceType: "vehicle", resourceId: "vehicle-1", body: "Ready for review", mentionUserIds: ["user-2"], idempotencyKey: "comment-create-1" }).body).toBe("Ready for review");
    expect(validateCommentRecord({ commentId: "comment_0001", resourceType: "vehicle", resourceId: "vehicle-1", authorId: "user-1", status: "deleted", mentionUserIds: [], revision: 2, createdAt: "2026-08-05T01:00:00Z", updatedAt: "2026-08-05T01:01:00Z" }).status).toBe("deleted");
    expect(validateActivityRecord({ activityId: "activity_001", resourceType: "vehicle", resourceId: "vehicle-1", actorId: "user-1", action: "comment-created", occurredAt: "2026-08-05T01:00:00Z", correlationId: "request-1" }).action).toBe("comment-created");
    expect(() => validateCommentCommand({ action: "create", resourceType: "vehicle", resourceId: "vehicle-1", body: "hello", idempotencyKey: "comment-create-1", authorId: "admin", tenantId: "tenant-b" })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("rejects unbounded queries, caller-owned scope, invalid cursors, and empty controls", () => {
    expect(() => validateResourceQuery({
      pageSize: 1000,
      filters: [],
      sort: [{ field: "createdAt", direction: "desc" }],
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateResourceQuery({
      pageSize: 20,
      filters: [],
      sort: [{ field: "createdAt", direction: "desc" }],
      tenantId: "tenant-b",
      rawWhere: "1=1",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateResourcePage({
      items: [],
      hasMore: false,
      nextCursor: "cursor_part.signature_part",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateOperationControl({}))
      .toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates bounded file asset commands and minimized records", () => {
    const sha256 = "a".repeat(64);
    expect(validateFileAssetUploadCommand({
      fileName: "invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: 4096,
      sha256,
      idempotencyKey: "upload-command-0001",
    }).sizeBytes).toBe(4096);
    expect(validateFileAssetRecord({
      assetId: "asset-00000000001",
      status: "available",
      sizeBytes: 4096,
      contentType: "application/pdf",
      sha256,
      createdAt: "2026-08-03T00:00:00Z",
    }).status).toBe("available");
    expect(() => validateFileAssetUploadCommand({
      fileName: "../../secret.txt",
      contentType: "text/plain",
      sizeBytes: 6,
      sha256,
      idempotencyKey: "upload-command-0001",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateFileAssetRecord({
      assetId: "asset-00000000001",
      status: "available",
      sizeBytes: 4096,
      contentType: "application/pdf",
      sha256,
      createdAt: "2026-08-03T00:00:00Z",
      providerUrl: "https://storage.example/private?token=secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates profile-bound import/export commands and minimized jobs", () => {
    expect(validateDataImportCommand({
      profileId: "vehicle-import",
      sourceAssetId: "asset-00000000001",
      idempotencyKey: "import-request-0001",
    }).profileId).toBe("vehicle-import");
    expect(validateDataExportCommand({
      profileId: "vehicle-export",
      idempotencyKey: "export-request-0001",
    }).profileId).toBe("vehicle-export");
    expect(validateImportExportJobRecord({
      jobId: "job-import-000001",
      operation: "import",
      status: "succeeded",
      processedRows: 12,
      rejectedRows: 0,
      createdAt: "2026-08-03T00:00:00Z",
      completedAt: "2026-08-03T00:00:01Z",
    }).processedRows).toBe(12);
    expect(() => validateDataImportCommand({
      profileId: "vehicle-import",
      sourceAssetId: "asset-00000000001",
      idempotencyKey: "import-request-0001",
      tenantId: "tenant-b",
      table: "internal_users",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateDataExportCommand({
      profileId: "vehicle-export",
      idempotencyKey: "export-request-0001",
      query: "select * from secrets",
      callbackUrl: "https://attacker.example/collect",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates bounded vehicle commands and portable records", () => {
    expect(validateVehicleCreateCommand({
      fleetNumber: "FLEET-001",
      plateNumber: "AB1234",
      vin: "1HGCM82633A004352",
      make: "Example Motors",
      model: "Cargo One",
      year: 2025,
      idempotencyKey: "vehicle-create-0001",
    }).fleetNumber).toBe("FLEET-001");
    expect(validateVehicleUpdateCommand({
      vehicleId: "vehicle-000000000001",
      expectedRevision: 3,
      mileageKm: 1200,
    }).expectedRevision).toBe(3);
    expect(validateVehicleRecord({
      vehicleId: "vehicle-000000000001",
      fleetNumber: "FLEET-001",
      plateNumber: "AB1234",
      make: "Example Motors",
      model: "Cargo One",
      year: 2025,
      status: "active",
      mileageKm: 1200,
      revision: 3,
      createdAt: "2026-08-03T00:00:00Z",
      updatedAt: "2026-08-03T00:01:00Z",
    }).status).toBe("active");
    expect(() => validateVehicleCreateCommand({
      fleetNumber: "FLEET-001",
      plateNumber: "AB1234",
      make: "Example Motors",
      model: "Cargo One",
      year: 2025,
      idempotencyKey: "vehicle-create-0001",
      tenantId: "tenant-b",
      vehicleId: "attacker-selected-id",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateVehicleUpdateCommand({
      vehicleId: "vehicle-000000000001",
      expectedRevision: 3,
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("keeps WeChat Mini Program login commands and results free of provider secrets", () => {
    expect(validateWechatMiniProgramLoginCommand({
      code: "wechat_one_time_code_001",
    }).code).toBe("wechat_one_time_code_001");
    expect(validateWechatMiniProgramLoginResult({
      principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      issuedAt: "2026-08-04T00:00:00Z",
    }).principal.subject).toBe("user-42");
    expect(() => validateWechatMiniProgramLoginCommand({
      code: "wechat_one_time_code_001",
      appSecret: "secret",
      openId: "attacker-selected",
      tenantId: "tenant-b",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
    expect(() => validateWechatMiniProgramLoginResult({
      principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      issuedAt: "2026-08-04T00:00:00Z",
      sessionKey: "provider-session-key-0001",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates minimized verification challenge commands and records", () => {
    expect(validateVerificationChallengeIssueCommand({
      recipientId: "user-42",
      channel: "email",
      purpose: "identity:login",
      idempotencyKey: "challenge-0001",
    }).purpose).toBe("identity:login");
    expect(validateVerificationChallengeVerifyCommand({
      challengeId: "challenge_0001",
      response: "123456",
    }).response).toBe("123456");
    expect(validateVerificationChallengeRecord({
      challengeId: "challenge_0001",
      channel: "email",
      purpose: "identity:login",
      status: "pending",
      attemptsRemaining: 5,
      createdAt: "2026-08-05T00:00:00Z",
      expiresAt: "2026-08-05T00:05:00Z",
    }).status).toBe("pending");
    expect(() => validateVerificationChallengeRecord({
      challengeId: "challenge_0001",
      channel: "email",
      purpose: "identity:login",
      status: "pending",
      attemptsRemaining: 5,
      createdAt: "2026-08-05T00:00:00Z",
      expiresAt: "2026-08-05T00:05:00Z",
      destination: "private@example.com",
      responseDigest: "secret",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });

  it("validates server-defined scheduled job commands and minimized state", () => {
    expect(validateScheduledJobCommand({
      definitionId: "daily-report",
      scheduledFor: "2026-08-05T01:00:00Z",
      idempotencyKey: "schedule-0001",
    }).definitionId).toBe("daily-report");
    expect(validateScheduledJobRecord({
      jobId: "job_daily_0001",
      definitionId: "daily-report",
      status: "retrying",
      attempt: 1,
      maximumAttempts: 3,
      scheduledFor: "2026-08-05T01:00:00Z",
      errorCode: "execution-failed",
      createdAt: "2026-08-05T00:00:00Z",
    }).attempt).toBe(1);
    expect(() => validateScheduledJobCommand({
      definitionId: "daily-report",
      scheduledFor: "2026-08-05T01:00:00Z",
      idempotencyKey: "schedule-0001",
      command: "curl attacker.example",
      callbackUrl: "https://attacker.example",
      tenantId: "tenant-b",
    })).toThrowError(expect.objectContaining({ code: "PROTOCOL_VALIDATION_FAILED" }));
  });
});
