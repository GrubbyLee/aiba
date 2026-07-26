import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import {
  loadInterfaceSchema,
  loadProtocolSchema,
  type AuditEvent,
  type AuthorizationDecision,
  type CapabilityAncestry,
  type CapabilityBundle,
  type CapabilityBundleSignature,
  type CapabilityManifest,
  type CapabilityMigration,
  type CapabilityRecipe,
  type CapabilityReceipt,
  type OperationPlan,
  type NotificationCommand,
  type NotificationReceipt,
  type Principal,
  type PublisherTrustPolicy,
  type ProjectLock,
  type ProjectManifest,
  type UpgradePlan,
} from "@aiba/spec";
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

const capabilityValidator = ajv.compile<CapabilityManifest>(
  loadProtocolSchema("capability.schema.json"),
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
