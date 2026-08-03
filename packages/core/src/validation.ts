import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import {
  loadInterfaceSchema,
  loadProtocolSchema,
  type AuditEvent,
  type AuthorizationDecision,
  type CapabilityAncestry,
  type CapabilityApproval,
  type CapabilityCatalog,
  type CapabilityBundle,
  type CapabilityBundleSignature,
  type CapabilityManifest,
  type CapabilityMigration,
  type CapabilityRecipe,
  type CapabilityReceipt,
  type CapabilityRegistryIndex,
  type CapabilityRegistryIndexSignature,
  type CapabilityRegistryState,
  type CapabilityRegistryTrustPolicy,
  type CapabilitySolution,
  type DataExportCommand,
  type DataImportCommand,
  type FileAssetRecord,
  type FileAssetUploadCommand,
  type ImportExportJobRecord,
  type OperationPlan,
  type NotificationCommand,
  type NotificationReceipt,
  type Principal,
  type PublisherTrustPolicy,
  type ProjectLock,
  type ProjectManifest,
  type TeamGovernancePolicy,
  type UpgradePlan,
  type VehicleCreateCommand,
  type VehicleRecord,
  type VehicleUpdateCommand,
  type WechatMiniProgramLoginCommand,
  type WechatMiniProgramLoginResult,
} from "aiba-spec";
import { ProtocolValidationError } from "./errors.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value)),
});

const principalSchema = loadInterfaceSchema("principal.schema.json");
const principalValidator = ajv.compile<Principal>(
  principalSchema,
);
const authorizationDecisionValidator = ajv.compile<AuthorizationDecision>(
  loadInterfaceSchema("authorization-decision.schema.json"),
);
const auditEventValidator = ajv.compile<AuditEvent>(
  loadInterfaceSchema("audit-event.schema.json"),
);
const notificationCommandValidator = ajv.compile<NotificationCommand>(
  loadInterfaceSchema("notification-command.schema.json"),
);
const notificationReceiptValidator = ajv.compile<NotificationReceipt>(
  loadInterfaceSchema("notification-receipt.schema.json"),
);
const fileAssetUploadCommandValidator = ajv.compile<FileAssetUploadCommand>(
  loadInterfaceSchema("file-asset-upload-command.schema.json"),
);
const fileAssetRecordValidator = ajv.compile<FileAssetRecord>(
  loadInterfaceSchema("file-asset-record.schema.json"),
);
const dataImportCommandValidator = ajv.compile<DataImportCommand>(
  loadInterfaceSchema("data-import-command.schema.json"),
);
const dataExportCommandValidator = ajv.compile<DataExportCommand>(
  loadInterfaceSchema("data-export-command.schema.json"),
);
const importExportJobRecordValidator = ajv.compile<ImportExportJobRecord>(
  loadInterfaceSchema("import-export-job-record.schema.json"),
);
const vehicleCreateCommandValidator = ajv.compile<VehicleCreateCommand>(
  loadInterfaceSchema("vehicle-create-command.schema.json"),
);
const vehicleUpdateCommandValidator = ajv.compile<VehicleUpdateCommand>(
  loadInterfaceSchema("vehicle-update-command.schema.json"),
);
const vehicleRecordValidator = ajv.compile<VehicleRecord>(
  loadInterfaceSchema("vehicle-record.schema.json"),
);
const wechatMiniProgramLoginCommandValidator = ajv.compile<WechatMiniProgramLoginCommand>(
  loadInterfaceSchema("wechat-miniprogram-login-command.schema.json"),
);
const wechatMiniProgramLoginResultValidator = ajv.compile<WechatMiniProgramLoginResult>(
  loadInterfaceSchema("wechat-miniprogram-login-result.schema.json"),
);

const capabilityValidator = ajv.compile<CapabilityManifest>(
  loadProtocolSchema("capability.schema.json"),
);
const capabilityCatalogValidator = ajv.compile<CapabilityCatalog>(
  loadProtocolSchema("capability-catalog.schema.json"),
);
const capabilitySolutionValidator = ajv.compile<CapabilitySolution>(
  loadProtocolSchema("solution.schema.json"),
);
const bundleValidator = ajv.compile<CapabilityBundle>(
  loadProtocolSchema("bundle.schema.json"),
);
const bundleSignatureValidator = ajv.compile<CapabilityBundleSignature>(
  loadProtocolSchema("bundle-signature.schema.json"),
);
const trustPolicyValidator = ajv.compile<PublisherTrustPolicy>(
  loadProtocolSchema("trust-policy.schema.json"),
);
const governancePolicyValidator = ajv.compile<TeamGovernancePolicy>(
  loadProtocolSchema("governance-policy.schema.json"),
);
const capabilityApprovalValidator = ajv.compile<CapabilityApproval>(
  loadProtocolSchema("capability-approval.schema.json"),
);
const registryIndexValidator = ajv.compile<CapabilityRegistryIndex>(
  loadProtocolSchema("registry-index.schema.json"),
);
const registryIndexSignatureValidator = ajv.compile<CapabilityRegistryIndexSignature>(
  loadProtocolSchema("registry-index-signature.schema.json"),
);
const registryStateValidator = ajv.compile<CapabilityRegistryState>(
  loadProtocolSchema("registry-state.schema.json"),
);
const registryTrustPolicyValidator = ajv.compile<CapabilityRegistryTrustPolicy>(
  loadProtocolSchema("registry-trust-policy.schema.json"),
);
const ancestryValidator = ajv.compile<CapabilityAncestry>(
  loadProtocolSchema("ancestry.schema.json"),
);
const migrationValidator = ajv.compile<CapabilityMigration>(
  loadProtocolSchema("migration.schema.json"),
);
const projectValidator = ajv.compile<ProjectManifest>(
  loadProtocolSchema("project.schema.json"),
);
const lockValidator = ajv.compile<ProjectLock>(
  loadProtocolSchema("lock.schema.json"),
);
const receiptValidator = ajv.compile<CapabilityReceipt>(
  loadProtocolSchema("receipt.schema.json"),
);
const recipeValidator = ajv.compile<CapabilityRecipe>(
  loadProtocolSchema("recipe.schema.json"),
);
const operationPlanValidator = ajv.compile<OperationPlan>(
  loadProtocolSchema("operation-plan.schema.json"),
);
const upgradePlanValidator = ajv.compile<UpgradePlan>(
  loadProtocolSchema("upgrade-plan.schema.json"),
);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "is invalid"}`;
  });
}

function assertValid<T>(
  validator: ValidateFunction<T>,
  value: unknown,
  documentType: string,
): asserts value is T {
  if (!validator(value)) {
    throw new ProtocolValidationError(documentType, formatErrors(validator.errors));
  }
}

export function validateCapabilityManifest(value: unknown): CapabilityManifest {
  assertValid(capabilityValidator, value, "capability manifest");
  return value as CapabilityManifest;
}

export function validateCapabilityCatalog(value: unknown): CapabilityCatalog {
  assertValid(capabilityCatalogValidator, value, "capability catalog");
  return value as CapabilityCatalog;
}

export function validateCapabilitySolution(value: unknown): CapabilitySolution {
  assertValid(capabilitySolutionValidator, value, "capability solution");
  return value as CapabilitySolution;
}

export function validateCapabilityBundle(value: unknown): CapabilityBundle {
  assertValid(bundleValidator, value, "capability bundle");
  return value as CapabilityBundle;
}

export function validateCapabilityBundleSignature(
  value: unknown,
): CapabilityBundleSignature {
  assertValid(bundleSignatureValidator, value, "capability bundle signature");
  return value as CapabilityBundleSignature;
}

export function validatePublisherTrustPolicy(value: unknown): PublisherTrustPolicy {
  assertValid(trustPolicyValidator, value, "publisher trust policy");
  return value as PublisherTrustPolicy;
}

export function validateTeamGovernancePolicy(value: unknown): TeamGovernancePolicy {
  assertValid(governancePolicyValidator, value, "team governance policy");
  return value as TeamGovernancePolicy;
}

export function validateCapabilityApproval(value: unknown): CapabilityApproval {
  assertValid(capabilityApprovalValidator, value, "capability approval");
  return value as CapabilityApproval;
}

export function validateCapabilityRegistryIndex(value: unknown): CapabilityRegistryIndex {
  assertValid(registryIndexValidator, value, "capability registry index");
  return value as CapabilityRegistryIndex;
}

export function validateCapabilityRegistryIndexSignature(
  value: unknown,
): CapabilityRegistryIndexSignature {
  assertValid(
    registryIndexSignatureValidator,
    value,
    "capability registry index signature",
  );
  return value as CapabilityRegistryIndexSignature;
}

export function validateCapabilityRegistryState(value: unknown): CapabilityRegistryState {
  assertValid(registryStateValidator, value, "capability registry state");
  return value as CapabilityRegistryState;
}

export function validateCapabilityRegistryTrustPolicy(
  value: unknown,
): CapabilityRegistryTrustPolicy {
  assertValid(registryTrustPolicyValidator, value, "capability registry trust policy");
  return value as CapabilityRegistryTrustPolicy;
}

export function validatePrincipal(value: unknown): Principal {
  assertValid(principalValidator, value, "principal interface");
  return value as Principal;
}

export function validateAuthorizationDecision(value: unknown): AuthorizationDecision {
  assertValid(authorizationDecisionValidator, value, "authorization decision interface");
  return value as AuthorizationDecision;
}

export function validateAuditEvent(value: unknown): AuditEvent {
  assertValid(auditEventValidator, value, "audit event interface");
  return value as AuditEvent;
}

export function validateNotificationCommand(value: unknown): NotificationCommand {
  assertValid(notificationCommandValidator, value, "notification command interface");
  return value as NotificationCommand;
}

export function validateNotificationReceipt(value: unknown): NotificationReceipt {
  assertValid(notificationReceiptValidator, value, "notification receipt interface");
  return value as NotificationReceipt;
}

export function validateFileAssetUploadCommand(value: unknown): FileAssetUploadCommand {
  assertValid(fileAssetUploadCommandValidator, value, "file asset upload command interface");
  return value as FileAssetUploadCommand;
}

export function validateFileAssetRecord(value: unknown): FileAssetRecord {
  assertValid(fileAssetRecordValidator, value, "file asset record interface");
  return value as FileAssetRecord;
}

export function validateDataImportCommand(value: unknown): DataImportCommand {
  assertValid(dataImportCommandValidator, value, "data import command interface");
  return value as DataImportCommand;
}

export function validateDataExportCommand(value: unknown): DataExportCommand {
  assertValid(dataExportCommandValidator, value, "data export command interface");
  return value as DataExportCommand;
}

export function validateImportExportJobRecord(value: unknown): ImportExportJobRecord {
  assertValid(importExportJobRecordValidator, value, "import export job record interface");
  return value as ImportExportJobRecord;
}

export function validateVehicleCreateCommand(value: unknown): VehicleCreateCommand {
  assertValid(vehicleCreateCommandValidator, value, "vehicle create command interface");
  return value as VehicleCreateCommand;
}

export function validateVehicleUpdateCommand(value: unknown): VehicleUpdateCommand {
  assertValid(vehicleUpdateCommandValidator, value, "vehicle update command interface");
  return value as VehicleUpdateCommand;
}

export function validateVehicleRecord(value: unknown): VehicleRecord {
  assertValid(vehicleRecordValidator, value, "vehicle record interface");
  return value as VehicleRecord;
}

export function validateWechatMiniProgramLoginCommand(
  value: unknown,
): WechatMiniProgramLoginCommand {
  assertValid(
    wechatMiniProgramLoginCommandValidator,
    value,
    "WeChat Mini Program login command interface",
  );
  return value as WechatMiniProgramLoginCommand;
}

export function validateWechatMiniProgramLoginResult(
  value: unknown,
): WechatMiniProgramLoginResult {
  assertValid(
    wechatMiniProgramLoginResultValidator,
    value,
    "WeChat Mini Program login result interface",
  );
  return value as WechatMiniProgramLoginResult;
}

export function validateCapabilityAncestry(value: unknown): CapabilityAncestry {
  assertValid(ancestryValidator, value, "capability ancestry");
  return value as CapabilityAncestry;
}

export function validateCapabilityMigration(value: unknown): CapabilityMigration {
  assertValid(migrationValidator, value, "capability migration");
  return value as CapabilityMigration;
}

export function validateProjectManifest(value: unknown): ProjectManifest {
  assertValid(projectValidator, value, "project manifest");
  return value as ProjectManifest;
}

export function validateProjectLock(value: unknown): ProjectLock {
  assertValid(lockValidator, value, "project lock");
  return value as ProjectLock;
}

export function validateCapabilityReceipt(value: unknown): CapabilityReceipt {
  assertValid(receiptValidator, value, "capability receipt");
  return value as CapabilityReceipt;
}

export function validateCapabilityRecipe(value: unknown): CapabilityRecipe {
  assertValid(recipeValidator, value, "capability recipe");
  return value as CapabilityRecipe;
}

export function validateOperationPlan(value: unknown): OperationPlan {
  assertValid(operationPlanValidator, value, "operation plan");
  return value as OperationPlan;
}

export function validateUpgradePlan(value: unknown): UpgradePlan {
  assertValid(upgradePlanValidator, value, "upgrade plan");
  return value as UpgradePlan;
}
