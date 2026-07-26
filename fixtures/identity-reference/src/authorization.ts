import { randomUUID } from "node:crypto";
import type {
  AuthorizationDecision,
  AuthorizationResource,
  Principal,
} from "@aiba/spec";
import type { AuditContext } from "./audit.js";

const ACTION = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9-]*$/;

export interface PolicyGrant {
  id: string;
  effect: "allow" | "deny";
  principals: Array<{
    type: Principal["type"];
    subject?: string;
    tenantId?: string;
  }>;
  actions: string[];
  resourceTypes: string[];
  resourceIds?: string[];
}

export interface PolicySnapshot {
  version: string;
  grants: PolicyGrant[];
}

export interface AuthorizationAudit {
  record(
    context: AuditContext,
    input: {
      action: string;
      outcome: "allowed" | "denied";
      reasonCode: string;
      target: AuthorizationResource;
    },
  ): Promise<unknown>;
}

export interface AuthorizationDependencies {
  loadPolicy: () => Promise<Readonly<PolicySnapshot>>;
  audit: AuthorizationAudit;
  now?: () => Date;
  decisionId?: () => string;
}

export interface AuthorizationContext {
  principal: Principal;
  correlationId: string;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly code: "authorization-unavailable" | "invalid-authorization-context",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "AuthorizationError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function parseResource(value: unknown): AuthorizationResource | undefined {
  const resource = record(value);
  if (
    !resource
    || !hasExactKeys(resource, ["type"], ["id", "tenantId"])
    || typeof resource.type !== "string"
    || !RESOURCE_TYPE.test(resource.type)
    || (resource.id !== undefined && (typeof resource.id !== "string" || resource.id.length < 1))
    || (resource.tenantId !== undefined
      && (typeof resource.tenantId !== "string" || resource.tenantId.length < 1))
  ) return undefined;
  return {
    type: resource.type,
    ...(typeof resource.id === "string" ? { id: resource.id } : {}),
    ...(typeof resource.tenantId === "string" ? { tenantId: resource.tenantId } : {}),
  };
}

function validPrincipal(principal: Principal): boolean {
  return ["user", "service", "reviewer", "anonymous"].includes(principal.type)
    && Boolean(principal.subject);
}

function validPolicy(policy: Readonly<PolicySnapshot>): boolean {
  const ids = new Set<string>();
  if (!policy.version || !Array.isArray(policy.grants)) return false;
  for (const grant of policy.grants) {
    if (
      !grant.id
      || ids.has(grant.id)
      || !["allow", "deny"].includes(grant.effect)
      || grant.principals.length < 1
      || grant.actions.length < 1
      || grant.resourceTypes.length < 1
      || grant.actions.some((action) => !ACTION.test(action))
      || grant.resourceTypes.some((type) => !RESOURCE_TYPE.test(type))
    ) return false;
    ids.add(grant.id);
  }
  return true;
}

function principalMatches(
  expected: PolicyGrant["principals"][number],
  actual: Principal,
): boolean {
  return expected.type === actual.type
    && (!expected.subject || expected.subject === actual.subject)
    && (!expected.tenantId || expected.tenantId === actual.tenantId);
}

function grantMatches(
  grant: PolicyGrant,
  principal: Principal,
  action: string,
  resource: AuthorizationResource,
): boolean {
  return grant.principals.some((expected) => principalMatches(expected, principal))
    && grant.actions.includes(action)
    && grant.resourceTypes.includes(resource.type)
    && (!grant.resourceIds || (Boolean(resource.id) && grant.resourceIds.includes(resource.id as string)));
}

export function createAuthorizationService(dependencies: AuthorizationDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const decisionId = dependencies.decisionId ?? randomUUID;

  async function decide(
    context: AuthorizationContext,
    input: unknown,
  ): Promise<AuthorizationDecision> {
    if (
      !validPrincipal(context.principal)
      || !context.correlationId
      || context.correlationId.length < 8
    ) {
      throw new AuthorizationError(
        "Trusted authorization context is invalid",
        "invalid-authorization-context",
      );
    }
    const body = record(input);
    const resource = parseResource(body?.resource);
    const validRequest = Boolean(
      body
      && hasExactKeys(body, ["action", "resource"])
      && typeof body.action === "string"
      && ACTION.test(body.action)
      && resource,
    );
    let policy: Readonly<PolicySnapshot> | undefined;
    try {
      policy = await dependencies.loadPolicy();
    } catch {
      policy = undefined;
    }
    const policyValid = Boolean(policy && validPolicy(policy));
    const crossTenant = Boolean(
      validRequest
      && context.principal.tenantId
      && resource?.tenantId
      && context.principal.tenantId !== resource.tenantId,
    );
    const matches = validRequest && policyValid && !crossTenant
      ? policy?.grants.filter((grant) => grantMatches(
        grant,
        context.principal,
        body?.action as string,
        resource as AuthorizationResource,
      )) ?? []
      : [];
    const denied = matches.some((grant) => grant.effect === "deny");
    const allowed = !denied && matches.some((grant) => grant.effect === "allow");
    const reasonCode = !validRequest
      ? "invalid-request"
      : !policyValid
        ? "policy-unavailable"
        : crossTenant
          ? "cross-tenant"
          : denied
            ? "explicit-deny"
            : allowed
              ? "explicit-allow"
              : "default-deny";
    const target = resource ?? { type: "invalid-request" };
    const decision: AuthorizationDecision = {
      decisionId: decisionId(),
      principal: { ...context.principal },
      action: validRequest ? body?.action as string : "authorization:invalid-request",
      resource: target,
      allowed,
      reasonCode,
      policyVersion: policyValid ? policy?.version as string : "unavailable",
      evaluatedAt: now().toISOString(),
    };
    try {
      await dependencies.audit.record({
        actor: context.principal,
        correlationId: context.correlationId,
      }, {
        action: "authorization:evaluate",
        outcome: allowed ? "allowed" : "denied",
        reasonCode,
        target,
      });
    } catch (error) {
      throw new AuthorizationError(
        "Authorization auditing failed",
        "authorization-unavailable",
        { cause: error },
      );
    }
    return decision;
  }

  return Object.freeze({ decide });
}
