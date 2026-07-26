import { readFileSync } from "node:fs";

export const AIBA_API_VERSION = "aiba.dev/v0alpha1" as const;

export type InvariantSeverity = "critical" | "error" | "warning";
export type EvidenceType = "source" | "test" | "config" | "document";
export type SemanticOwnership = "generated" | "shared" | "project";

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
  parameters: Record<string, string>;
  idempotencyKey: string;
}

export interface NotificationReceipt {
  notificationId: string;
  status: "sent" | "suppressed";
  channel: NotificationChannel;
  templateId: string;
  createdAt: string;
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

export type ProtocolSchemaName =
  | "ancestry.schema.json"
  | "capability.schema.json"
  | "lock.schema.json"
  | "migration.schema.json"
  | "operation-plan.schema.json"
  | "project.schema.json"
  | "recipe.schema.json"
  | "receipt.schema.json"
  | "upgrade-plan.schema.json";

export type InterfaceSchemaName =
  | "audit-event.schema.json"
  | "authorization-decision.schema.json"
  | "notification-command.schema.json"
  | "notification-receipt.schema.json"
  | "principal.schema.json";

export function loadProtocolSchema(name: ProtocolSchemaName): object {
  const url = new URL(`../schema/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}

export function loadInterfaceSchema(name: InterfaceSchemaName): object {
  const url = new URL(`../schema/interfaces/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}
