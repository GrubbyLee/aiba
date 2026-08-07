import { readFileSync } from "node:fs";

export const AIBA_API_VERSION = "aiba.dev/v0alpha1" as const;

export type InvariantSeverity = "critical" | "error" | "warning";
export type EvidenceType = "source" | "test" | "config" | "document";
export type SemanticOwnership = "generated" | "shared" | "project";
export type CapabilityLayer =
  | "application-foundation"
  | "platform-integration"
  | "business-capability"
  | "engineering-governance"
  | "industry-solution";

export type PrincipalType = "user" | "service" | "reviewer" | "anonymous";

export interface Principal {
  type: PrincipalType;
  subject: string;
  tenantId?: string;
}

export interface AuthorizationResource {
  type: string;
  id?: string;
  tenantId?: string;
}

export interface AuthorizationDecision {
  decisionId: string;
  principal: Principal;
  action: string;
  resource: AuthorizationResource;
  allowed: boolean;
  reasonCode: string;
  policyVersion: string;
  evaluatedAt: string;
}

export type AuditOutcome = "allowed" | "denied" | "succeeded" | "failed";

export interface AuditEvent {
  eventId: string;
  action: string;
  outcome: AuditOutcome;
  actor: Principal;
  target?: AuthorizationResource;
  reasonCode?: string;
  occurredAt: string;
  correlationId: string;
}

export type NotificationChannel = "in-app" | "email" | "sms" | "wechat-template";

export interface NotificationCommand {
  recipientId: string;
  channel: NotificationChannel;
  templateId: string;
  templateVersion: number;
  parameters: Record<string, string>;
  idempotencyKey: string;
}

export interface NotificationReceipt {
  notificationId: string;
  status: "queued" | "delivering" | "sent" | "suppressed" | "failed";
  channel: NotificationChannel;
  templateId: string;
  templateVersion: number;
  attempt: number;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type ResourceFilterOperator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "contains"
  | "prefix";

export type ResourceFilterValue = string | number | boolean | null | Array<string | number | boolean>;

export interface ResourceFilter {
  field: string;
  operator: ResourceFilterOperator;
  value: ResourceFilterValue;
}

export interface ResourceQuery {
  pageSize: number;
  cursor?: string;
  filters: ResourceFilter[];
  sort: Array<{
    field: string;
    direction: "asc" | "desc";
  }>;
}

export interface ResourcePage<T extends object = Record<string, unknown>> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}

export interface OperationControl {
  idempotencyKey?: string;
  expectedRevision?: number;
}

export type VerificationChallengeChannel = "email" | "sms" | "authenticator";

export interface VerificationChallengeIssueCommand {
  recipientId: string;
  channel: VerificationChallengeChannel;
  purpose: string;
  idempotencyKey: string;
}

export interface VerificationChallengeVerifyCommand {
  challengeId: string;
  response: string;
}

export interface VerificationChallengeRecord {
  challengeId: string;
  channel: VerificationChallengeChannel;
  purpose: string;
  status: "pending" | "verified" | "expired" | "locked";
  attemptsRemaining: number;
  createdAt: string;
  expiresAt: string;
  verifiedAt?: string;
}

export interface ScheduledJobCommand {
  definitionId: string;
  scheduledFor: string;
  idempotencyKey: string;
}

export interface ScheduledJobRecord {
  jobId: string;
  definitionId: string;
  status: "queued" | "running" | "retrying" | "succeeded" | "failed";
  attempt: number;
  maximumAttempts: number;
  scheduledFor: string;
  leaseExpiresAt?: string;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
}

export interface WebhookDeliveryCommand {
  subscriptionId: string;
  eventType: string;
  resourceId: string;
  idempotencyKey: string;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  subscriptionId: string;
  eventType: string;
  status: "pending" | "delivering" | "retrying" | "delivered" | "failed";
  attempt: number;
  maximumAttempts: number;
  createdAt: string;
  deliveredAt?: string;
  errorCode?: string;
}


export interface DataDictItemRecord {
  itemId: string;
  dictCode: string;
  parentId?: string;
  value: string | number | boolean;
  valueType: "string" | "number" | "boolean";
  label: string;
  sortOrder: number;
  status: "enabled" | "disabled";
  revision: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DataDictQueryCommand {
  dictCode: string;
  parentId?: string;
  keyword?: string;
  includeDisabled?: boolean;
  pageSize?: number;
  page?: number;
  expectedRevision?: number;
}

export interface DataDictQueryResult {
  dictCode: string;
  revision: number;
  items: DataDictItemRecord[];
  page: number;
  pageSize: number;
  total: number;
  queriedAt: string;
}

export type FormFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "multiselect"
  | "textarea"
  | "file";

export type FormScalar = string | number | boolean | null;
export type FormValue = FormScalar | FormScalar[];

export interface FormFieldOption {
  value: string | number | boolean;
  label: string;
  disabled?: boolean;
}

export interface FormVisibilityCondition {
  field: string;
  equals: FormScalar;
}

export interface FormFieldDefinition {
  name: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  readonly?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  maximumSelections?: number;
  options?: FormFieldOption[];
  dependsOn?: string[];
  visibleWhen?: FormVisibilityCondition;
}

export interface FormSchemaCommand {
  formCode: string;
  revision?: number;
}

export interface FormSchemaResult {
  formCode: string;
  revision: number;
  title: string;
  description?: string;
  fields: FormFieldDefinition[];
  loadedAt: string;
}

export interface FormSubmitCommand {
  formCode: string;
  expectedRevision: number;
  data: Record<string, FormValue>;
  idempotencyKey: string;
}

export interface FormValidationError {
  field: string;
  code: string;
  message: string;
}

export interface FormSubmitResult {
  formCode: string;
  revision: number;
  submissionId?: string;
  valid: boolean;
  errors: FormValidationError[];
  data?: Record<string, FormValue>;
  submittedAt: string;
}

export interface FeatureFlagEvaluationCommand {
  flagKey: string;
  expectedRevision?: number;
}

export interface FeatureFlagEvaluationResult {
  flagKey: string;
  enabled: boolean;
  variant: string;
  reason: "disabled" | "target-match" | "rollout" | "default";
  policyRevision: number;
  evaluatedAt: string;
}
export interface I18nTranslateKeyCommand {
  key: string;
  params?: Record<string, string | number | boolean | null>;
  count?: number;
  fallback?: string;
}

export interface I18nTranslateCommand {
  keys: I18nTranslateKeyCommand[];
  expectedRevision?: string;
}

export interface I18nTranslateKeyResult {
  key: string;
  value: string;
  source: "exact" | "fallback-namespace" | "fallback-locale" | "default";
  pluralForm?: "zero" | "one" | "two" | "few" | "many" | "other";
}

export interface I18nTranslateResult {
  locale: string;
  catalogRevision: string;
  translations: I18nTranslateKeyResult[];
  resolvedAt: string;
}

export interface I18nCatalogCommand {
  locale: string;
  namespace?: string;
  revision?: string;
}

export interface I18nCatalogPluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other?: string;
}

export interface I18nCatalogNamespace {
  messages?: Record<string, string>;
  plurals?: Record<string, I18nCatalogPluralForms>;
}

export interface I18nCatalogResult {
  locale: string;
  revision: string;
  namespaces: Record<string, I18nCatalogNamespace>;
  loadedAt: string;
}

export type InboxMessageStatus = "unread" | "read" | "archived";
export type InboxTransitionAction = "mark-read" | "mark-unread" | "archive";

export interface InboxMessageRecord {
  messageId: string;
  category: string;
  title: string;
  body: string;
  status: InboxMessageStatus;
  resourceType?: string;
  resourceId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  readAt?: string;
  archivedAt?: string;
}

export interface InboxQueryCommand {
  statuses?: InboxMessageStatus[];
  categories?: string[];
  pageSize: number;
  cursor?: string;
}

export interface InboxPage {
  messages: InboxMessageRecord[];
  hasMore: boolean;
  nextCursor?: string;
  unreadCount: number;
}

export interface InboxTransitionTarget {
  messageId: string;
  expectedRevision: number;
}

export interface InboxTransitionCommand {
  action: InboxTransitionAction;
  targets: InboxTransitionTarget[];
  idempotencyKey: string;
}

export interface InboxTransitionRecord {
  messageId: string;
  status: InboxMessageStatus;
  revision: number;
  updatedAt: string;
}

export interface InboxTransitionResult {
  action: InboxTransitionAction;
  messages: InboxTransitionRecord[];
  changedCount: number;
  transitionedAt: string;
}

export type TagStatus = "active" | "archived";
export type TagMutationAction = "create" | "update" | "archive";

export interface TagRecord {
  tagId: string;
  name: string;
  slug: string;
  color: string;
  status: TagStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface TagMutationCommand {
  action: TagMutationAction;
  tagId?: string;
  name?: string;
  color?: string;
  expectedRevision?: number;
  idempotencyKey: string;
}

export interface TagAssignmentCommand {
  action: "attach" | "detach";
  resourceType: string;
  resourceId: string;
  tagIds: string[];
  expectedRevision: number;
  idempotencyKey: string;
}

export interface TagAssignmentResult {
  resourceType: string;
  resourceId: string;
  tagIds: string[];
  revision: number;
  changedCount: number;
  updatedAt: string;
}

export interface TagQueryCommand {
  mode: "catalog" | "resource";
  resourceType?: string;
  resourceId?: string;
  keyword?: string;
  includeArchived?: boolean;
  pageSize: number;
  cursor?: string;
}

export interface TagPage {
  tags: TagRecord[];
  hasMore: boolean;
  nextCursor?: string;
  assignmentRevision?: number;
}

export interface OrganizationMembershipCommand {
  action: "add" | "change-role" | "remove";
  userId: string;
  roleId?: string;
  expectedRevision?: number;
  idempotencyKey: string;
}

export interface OrganizationMembershipRecord {
  membershipId: string;
  organizationId: string;
  userId: string;
  roleId: string;
  status: "active" | "removed";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentCommand {
  action: "create" | "edit" | "delete";
  resourceType: string;
  resourceId: string;
  commentId?: string;
  body?: string;
  mentionUserIds?: string[];
  expectedRevision?: number;
  idempotencyKey: string;
}

export interface CommentRecord {
  commentId: string;
  resourceType: string;
  resourceId: string;
  authorId: string;
  body?: string;
  status: "active" | "deleted";
  mentionUserIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  activityId: string;
  resourceType: string;
  resourceId: string;
  actorId: string;
  action: "comment-created" | "comment-edited" | "comment-deleted";
  occurredAt: string;
  correlationId: string;
}

export interface SearchQuery {
  term: string;
  resourceTypes: string[];
  pageSize: number;
  cursor?: string;
}

export interface SearchResultItem {
  resourceType: string;
  resourceId: string;
  title: string;
  snippet: string;
}

export interface SearchPage {
  items: SearchResultItem[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface ReportRunCommand {
  definitionId: string;
  format: "csv" | "json" | "pdf";
  parameters: Record<string, string | number | boolean | null>;
  idempotencyKey: string;
}

export interface ReportRunRecord {
  reportId: string;
  definitionId: string;
  format: "csv" | "json" | "pdf";
  status: "queued" | "running" | "succeeded" | "failed";
  assetId?: string;
  rowCount?: number;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ApprovalRequestCommand { definitionId: string; resourceType: string; resourceId: string; idempotencyKey: string }
export interface ApprovalDecisionCommand { workflowId: string; decision: "approve" | "reject"; reason?: string; expectedRevision: number; idempotencyKey: string }
export interface ApprovalDecisionRecord { decisionId: string; actorId: string; decision: "approve" | "reject"; reason?: string; decidedAt: string }
export interface ApprovalWorkflowRecord {
  workflowId: string; definitionId: string; resourceType: string; resourceId: string; requesterId: string;
  status: "pending" | "approved" | "rejected"; requiredApprovals: number; revision: number;
  decisions: ApprovalDecisionRecord[]; createdAt: string; updatedAt: string;
}

export interface FileAssetUploadCommand {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  idempotencyKey: string;
}

export interface FileAssetRecord {
  assetId: string;
  status: "quarantined" | "available" | "rejected" | "deleted";
  sizeBytes: number;
  contentType: string;
  sha256: string;
  createdAt: string;
}

export interface DataImportCommand {
  profileId: string;
  sourceAssetId: string;
  idempotencyKey: string;
}

export interface DataExportCommand {
  profileId: string;
  idempotencyKey: string;
}

export interface ImportExportJobRecord {
  jobId: string;
  operation: "import" | "export";
  status: "succeeded" | "failed";
  processedRows: number;
  rejectedRows: number;
  outputAssetId?: string;
  errorReportAssetId?: string;
  errorCode?: string;
  createdAt: string;
  completedAt: string;
}

export interface VehicleCreateCommand {
  fleetNumber: string;
  plateNumber: string;
  vin?: string;
  make: string;
  model: string;
  year: number;
  idempotencyKey: string;
}

export interface VehicleUpdateCommand {
  vehicleId: string;
  expectedRevision: number;
  status?: "active" | "inactive" | "retired";
  mileageKm?: number;
}

export interface VehicleRecord {
  vehicleId: string;
  fleetNumber: string;
  plateNumber: string;
  vin?: string;
  make: string;
  model: string;
  year: number;
  status: "active" | "inactive" | "retired";
  mileageKm: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WechatMiniProgramLoginCommand {
  code: string;
}

export interface WechatMiniProgramLoginResult {
  principal: Principal;
  issuedAt: string;
}

export interface CapabilityInvariant {
  id: string;
  title: string;
  description: string;
  severity: InvariantSeverity;
  evidence: {
    acceptedTypes: EvidenceType[];
    requiredTypes: EvidenceType[];
    minimum: number;
    requireHash: boolean;
  };
}

export interface CapabilityManifest {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "Capability";
  metadata: {
    id: string;
    version: string;
    title: string;
    description: string;
    layer?: CapabilityLayer;
  };
  spec: {
    interfaces: string[];
    dependencies: Array<{
      id: string;
      version: string;
      optional: boolean;
    }>;
    invariants: CapabilityInvariant[];
  };
}

export interface CapabilityCatalog {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityCatalog";
  capabilities: Array<{
    id: string;
    version: string;
    layer: CapabilityLayer;
  }>;
}

export interface CapabilitySolution {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilitySolution";
  metadata: {
    id: string;
    version: string;
    title: string;
    description: string;
    layer: "industry-solution";
  };
  spec: {
    capabilities: Array<{
      id: string;
      version: string;
      manifestSha256: string;
      purpose: string;
    }>;
  };
}

export interface ProjectManifest {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "Project";
  project: {
    name: string;
    stack?: {
      languages?: string[];
      frameworks?: string[];
    };
  };
  capabilities: Array<{
    id: string;
    version: string;
    receipt: string;
  }>;
}

export interface ProjectLock {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "Lock";
  generatedAt: string;
  capabilities: Array<{
    id: string;
    version: string;
    manifestSha256: string;
    recipe?: {
      id: string;
      sha256: string;
    };
  }>;
}

export interface CapabilityEvidence {
  type: EvidenceType;
  path: string;
  sha256?: string;
  description?: string;
  ownership?: SemanticOwnership;
  operation?: string;
}

export interface CapabilityReceipt {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityReceipt";
  capability: {
    id: string;
    version: string;
  };
  installation: {
    method: "manual" | "agent" | "generator";
    createdAt: string;
    agent?: string;
    recipe?: string;
    plan?: string;
    planSha256?: string;
    ancestry?: string;
    ancestrySha256?: string;
    governance?: {
      operation: GovernanceOperation;
      policy: string;
      policySha256: string;
      approvals: Array<{
        path: string;
        sha256: string;
        approver: string;
        keyId: string;
      }>;
    };
  };
  invariants: Array<{
    id: string;
    evidence: CapabilityEvidence[];
  }>;
}

export interface CapabilityRecipe {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityRecipe";
  metadata: {
    id: string;
    version: string;
    title: string;
    description: string;
  };
  spec: {
    capability: {
      id: string;
      version: string;
    };
    compatibility: {
      languages: string[];
      frameworks: string[];
    };
    writeScope: {
      allowedPatterns: string[];
    };
    operations: Array<{
      id: string;
      intent: string;
      requiredInterfaces: string[];
      invariants: string[];
      guidance: string[];
    }>;
    evidence: Array<{
      invariant: string;
      suggestions: Array<{
        type: EvidenceType;
        pathPattern: string;
        description: string;
      }>;
    }>;
  };
}

export interface OperationPlan {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "OperationPlan";
  metadata: {
    id: string;
    createdAt: string;
  };
  capability: {
    id: string;
    version: string;
    manifestSha256: string;
  };
  recipe: {
    id: string;
    version: string;
    sha256: string;
  };
  project: {
    name: string;
    stack: {
      languages: string[];
      frameworks: string[];
    };
  };
  writeScope: {
    allowedPatterns: string[];
  };
  operations: CapabilityRecipe["spec"]["operations"];
  evidence: Array<{
    invariant: string;
    requirements: CapabilityInvariant["evidence"];
    suggestions: CapabilityRecipe["spec"]["evidence"][number]["suggestions"];
    items: Array<Omit<CapabilityEvidence, "sha256">>;
  }>;
}

export interface CapabilityAncestry {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityAncestry";
  capability: {
    id: string;
    version: string;
  };
  recipe: {
    id: string;
    version: string;
  };
  createdAt: string;
  files: Array<{
    path: string;
    installedSha256: string;
    ownership: SemanticOwnership;
    evidenceTypes: EvidenceType[];
    invariants: string[];
    operations: string[];
  }>;
}

export interface CapabilityMigration {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityMigration";
  metadata: {
    id: string;
    version: string;
    title: string;
    description: string;
  };
  spec: {
    capability: {
      id: string;
      fromVersion: string;
      toVersion: string;
    };
    operations: Array<{
      id: string;
      intent: string;
      affectedInvariants: string[];
      guidance: string[];
    }>;
  };
}

export type UpgradeConflict =
  | "none"
  | "customized-generated"
  | "customized-shared"
  | "missing-generated"
  | "missing-shared";

export interface UpgradePlan {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "UpgradePlan";
  metadata: {
    id: string;
    createdAt: string;
  };
  capability: {
    id: string;
    fromVersion: string;
    toVersion: string;
    fromManifestSha256: string;
    targetManifestSha256: string;
  };
  recipe: {
    id: string;
    fromVersion?: string;
    toVersion: string;
    targetSha256: string;
  };
  migration: {
    id: string;
    version: string;
    sha256: string;
  };
  project: {
    name: string;
  };
  drift: Array<CapabilityAncestry["files"][number] & {
    status: "unchanged" | "customized" | "missing";
    actualSha256?: string;
    conflict: UpgradeConflict;
    resolution?: {
      action: "adapt" | "preserve" | "replace" | "remove";
      rationale: string;
    };
  }>;
  operations: CapabilityMigration["spec"]["operations"];
  evidence: OperationPlan["evidence"];
}

export interface CapabilityBundle {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityBundle";
  metadata: { createdAt: string };
  capability: { id: string; version: string };
  publisher: { id: string; keyId: string };
  files: Array<{ path: string; size: number; sha256: string }>;
}

export interface CapabilityBundleSignature {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityBundleSignature";
  algorithm: "Ed25519";
  keyId: string;
  manifestSha256: string;
  signature: string;
}

export interface PublisherTrustPolicy {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "PublisherTrustPolicy";
  metadata: { id: string };
  publishers: Array<{
    publisher: string;
    keyId: string;
    algorithm: "Ed25519";
    publicKey: string;
    capabilities: string[];
  }>;
}

export interface CapabilityRegistryIndex {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityRegistryIndex";
  metadata: {
    id: string;
    sequence: number;
    generatedAt: string;
    expiresAt: string;
  };
  publisher: { id: string; keyId: string };
  entries: Array<{
    capability: string;
    version: string;
    path: string;
    bundleManifestSha256: string;
    publisher: string;
    keyId: string;
  }>;
}

export interface CapabilityRegistryIndexSignature {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityRegistryIndexSignature";
  algorithm: "Ed25519";
  keyId: string;
  indexSha256: string;
  signature: string;
}

export interface CapabilityRegistryTrustPolicy {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityRegistryTrustPolicy";
  metadata: { id: string };
  registries: Array<{
    registry: string;
    publisher: string;
    keyId: string;
    algorithm: "Ed25519";
    publicKey: string;
  }>;
}

export interface CapabilityRegistryState {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityRegistryState";
  registry: {
    id: string;
    sequence: number;
    indexSha256: string;
    verifiedAt: string;
  };
}

export type GovernanceOperation = "install" | "upgrade";

export interface TeamGovernancePolicy {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "TeamGovernancePolicy";
  metadata: { id: string; version: string };
  spec: {
    capabilities: Array<{ id: string; versions: string }>;
    approvers: Array<{
      id: string;
      keyId: string;
      algorithm: "Ed25519";
      publicKey: string;
      permissions: GovernanceOperation[];
    }>;
    requirements: {
      install: number;
      upgrade: number;
      upgradeWithConflicts: number;
    };
    approvalTtlSeconds: number;
    prohibitSelfApproval: boolean;
  };
}

export interface CapabilityApproval {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "CapabilityApproval";
  statement: {
    id: string;
    createdAt: string;
    expiresAt: string;
    project: string;
    operation: {
      type: GovernanceOperation;
      capability: string;
      fromVersion?: string;
      toVersion: string;
      conflicts: number;
    };
    plan: { path: string; sha256: string };
    evidence: Array<{ path: string; sha256: string }>;
    policy: { id: string; version: string; path: string; sha256: string };
    approver: { id: string; keyId: string };
  };
  signature: {
    algorithm: "Ed25519";
    keyId: string;
    value: string;
  };
}

export interface BehaviorChallenge {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "BehaviorChallenge";
  metadata: {
    id: string;
    createdAt: string;
    expiresAt: string;
  };
  project: {
    name: string;
    snapshotSha256: string;
  };
  subject: {
    kind: "capability" | "solution";
    id: string;
    version: string;
  };
  runner: {
    id: string;
    keyId: string;
  };
  test: {
    id: string;
    commandSha256: string;
  };
}

export interface BehaviorProof {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "BehaviorProof";
  statement: {
    id: string;
    challenge: {
      id: string;
      path: string;
      sha256: string;
    };
    project: BehaviorChallenge["project"];
    subject: BehaviorChallenge["subject"];
    runner: BehaviorChallenge["runner"];
    test: BehaviorChallenge["test"] & {
      startedAt: string;
      completedAt: string;
      exitCode: number;
      summarySha256: string;
    };
  };
  signature: {
    algorithm: "Ed25519";
    keyId: string;
    value: string;
  };
}

export interface BehaviorRunnerTrustPolicy {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "BehaviorRunnerTrustPolicy";
  metadata: { id: string };
  runners: Array<{
    runner: string;
    keyId: string;
    algorithm: "Ed25519";
    publicKey: string;
    subjects: string[];
    revokedAt?: string;
  }>;
}

export interface AgentProtocolDescriptor {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "AgentProtocolDescriptor";
  cliVersion: string;
  protocolVersion: "0.1.0";
  capabilities: Array<
    | "catalog-discovery"
    | "project-inspection"
    | "capability-install"
    | "solution-workflow"
    | "evidence-verification"
    | "behavior-proof"
    | "customization-upgrade"
    | "registry"
    | "governance"
  >;
  commands: Array<{
    name: string;
    mutatesProject: boolean;
    resumable: boolean;
    json: boolean;
  }>;
  envelopes: {
    success: "command-specific-json";
    error: "AibaErrorEnvelope";
  };
}

export interface AibaErrorEnvelope {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "AibaErrorEnvelope";
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface SignedSolutionEnvelope {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "SignedSolutionEnvelope";
  metadata: {
    sequence: number;
    createdAt: string;
    expiresAt: string;
  };
  solution: {
    id: string;
    version: string;
    path: "solution.yaml";
    sha256: string;
  };
  publisher: { id: string; keyId: string };
  signature: {
    algorithm: "Ed25519";
    keyId: string;
    value: string;
  };
}

export interface SolutionPublisherTrustPolicy {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "SolutionPublisherTrustPolicy";
  metadata: { id: string };
  publishers: Array<{
    publisher: string;
    keyId: string;
    algorithm: "Ed25519";
    publicKey: string;
    solutions: string[];
    revokedAt?: string;
  }>;
}

export interface SolutionVerificationState {
  apiVersion: typeof AIBA_API_VERSION;
  kind: "SolutionVerificationState";
  solution: {
    id: string;
    sequence: number;
    envelopeSha256: string;
    verifiedAt: string;
  };
}

export type ProtocolSchemaName =
  | "ancestry.schema.json"
  | "agent-protocol.schema.json"
  | "error-envelope.schema.json"
  | "signed-solution.schema.json"
  | "solution-trust-policy.schema.json"
  | "solution-state.schema.json"
  | "behavior-challenge.schema.json"
  | "behavior-proof.schema.json"
  | "behavior-runner-trust-policy.schema.json"
  | "bundle.schema.json"
  | "bundle-signature.schema.json"
  | "capability-approval.schema.json"
  | "capability-catalog.schema.json"
  | "capability.schema.json"
  | "lock.schema.json"
  | "migration.schema.json"
  | "operation-plan.schema.json"
  | "project.schema.json"
  | "recipe.schema.json"
  | "receipt.schema.json"
  | "governance-policy.schema.json"
  | "registry-index.schema.json"
  | "registry-index-signature.schema.json"
  | "registry-state.schema.json"
  | "registry-trust-policy.schema.json"
  | "solution.schema.json"
  | "trust-policy.schema.json"
  | "upgrade-plan.schema.json";

export type InterfaceSchemaName =
  | "activity-record.schema.json"
  | "approval-decision-command.schema.json"
  | "approval-request-command.schema.json"
  | "approval-workflow-record.schema.json"
  | "audit-event.schema.json"
  | "authorization-decision.schema.json"
  | "comment-command.schema.json"
  | "comment-record.schema.json"
  | "data-export-command.schema.json"
  | "data-import-command.schema.json"
  | "data-dict-item-record.schema.json"
  | "data-dict-query-command.schema.json"
  | "data-dict-query-result.schema.json"
  | "file-asset-record.schema.json"
  | "file-asset-upload-command.schema.json"
  | "feature-flag-evaluation-command.schema.json"
  | "feature-flag-evaluation-result.schema.json"
  | "form-engine-schema-command.schema.json"
  | "form-engine-schema-result.schema.json"
  | "form-engine-submit-command.schema.json"
  | "form-engine-submit-result.schema.json"
  | "i18n-catalog-command.schema.json"
  | "i18n-catalog-result.schema.json"
  | "i18n-translate-command.schema.json"
  | "i18n-translate-result.schema.json"
  | "inbox-message-record.schema.json"
  | "inbox-page.schema.json"
  | "inbox-query-command.schema.json"
  | "inbox-transition-command.schema.json"
  | "inbox-transition-result.schema.json"
  | "import-export-job-record.schema.json"
  | "notification-command.schema.json"
  | "notification-receipt.schema.json"
  | "organization-membership-command.schema.json"
  | "organization-membership-record.schema.json"
  | "operation-control.schema.json"
  | "principal.schema.json"
  | "resource-page.schema.json"
  | "resource-query.schema.json"
  | "report-run-command.schema.json"
  | "report-run-record.schema.json"
  | "scheduled-job-command.schema.json"
  | "scheduled-job-record.schema.json"
  | "search-page.schema.json"
  | "search-query.schema.json"
  | "tag-assignment-command.schema.json"
  | "tag-assignment-result.schema.json"
  | "tag-mutation-command.schema.json"
  | "tag-page.schema.json"
  | "tag-query-command.schema.json"
  | "tag-record.schema.json"
  | "webhook-delivery-command.schema.json"
  | "webhook-delivery-record.schema.json"
  | "vehicle-create-command.schema.json"
  | "vehicle-record.schema.json"
  | "vehicle-update-command.schema.json"
  | "verification-challenge-issue-command.schema.json"
  | "verification-challenge-record.schema.json"
  | "verification-challenge-verify-command.schema.json"
  | "wechat-miniprogram-login-command.schema.json"
  | "wechat-miniprogram-login-result.schema.json";

export function loadProtocolSchema(name: ProtocolSchemaName): object {
  const url = new URL(`../schema/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}

export function loadInterfaceSchema(name: InterfaceSchemaName): object {
  const url = new URL(`../schema/interfaces/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}
