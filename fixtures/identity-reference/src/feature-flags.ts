import { createHash } from "node:crypto";
import type { FeatureFlagEvaluationCommand, FeatureFlagEvaluationResult } from "aiba-spec";

export interface FeatureFlagContext {
  tenantId: string;
  subjectId: string;
  attributes: Readonly<Record<string, string>>;
}

export interface FeatureFlagDefinition {
  key: string;
  tenantId: string;
  enabled: boolean;
  revision: number;
  salt: string;
  defaultVariant: string;
  disabledVariant: string;
  targets: Array<{ attribute: string; equals: string; variant: string }>;
  rollout: Array<{ variant: string; basisPoints: number }>;
}

export interface FeatureFlagDependencies {
  loadDefinition: (tenantId: string, flagKey: string) => Promise<FeatureFlagDefinition | undefined>;
  now: () => Date;
}

function bucket(definition: FeatureFlagDefinition, subjectId: string): number {
  const digest = createHash("sha256").update(`${definition.salt}:${definition.key}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function createFeatureFlagService(dependencies: FeatureFlagDependencies) {
  async function evaluate(context: FeatureFlagContext, command: FeatureFlagEvaluationCommand): Promise<FeatureFlagEvaluationResult> {
    const definition = await dependencies.loadDefinition(context.tenantId, command.flagKey);
    if (!definition || definition.tenantId !== context.tenantId || definition.revision < 1) throw new Error("flag-unavailable");
    if (command.expectedRevision !== undefined && command.expectedRevision !== definition.revision) throw new Error("policy-revision-conflict");
    const base = { flagKey: definition.key, policyRevision: definition.revision, evaluatedAt: dependencies.now().toISOString() };
    if (!definition.enabled) return { ...base, enabled: false, variant: definition.disabledVariant, reason: "disabled" };
    for (const target of definition.targets) {
      if (context.attributes[target.attribute] === target.equals) return { ...base, enabled: true, variant: target.variant, reason: "target-match" };
    }
    const total = definition.rollout.reduce((sum, entry) => sum + entry.basisPoints, 0);
    if (total > 10_000 || definition.rollout.some((entry) => entry.basisPoints < 0)) throw new Error("flag-policy-invalid");
    const selected = bucket(definition, context.subjectId);
    let boundary = 0;
    for (const entry of definition.rollout) {
      boundary += entry.basisPoints;
      if (selected < boundary) return { ...base, enabled: true, variant: entry.variant, reason: "rollout" };
    }
    return { ...base, enabled: true, variant: definition.defaultVariant, reason: "default" };
  }
  return { evaluate };
}
