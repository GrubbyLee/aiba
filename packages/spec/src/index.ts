import { readFileSync } from "node:fs";

export const AIBA_API_VERSION = "aiba.dev/v0alpha1" as const;

export type InvariantSeverity = "critical" | "error" | "warning";
export type EvidenceType = "source" | "test" | "config" | "document";

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

export type ProtocolSchemaName =
  | "capability.schema.json"
  | "lock.schema.json"
  | "operation-plan.schema.json"
  | "project.schema.json"
  | "recipe.schema.json"
  | "receipt.schema.json";

export function loadProtocolSchema(name: ProtocolSchemaName): object {
  const url = new URL(`../schema/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}
