import type { OrganizationMembershipCommand, OrganizationMembershipRecord } from "aiba-spec";

export interface OrganizationContext { tenantId: string; organizationId: string; principalId: string; correlationId: string }
interface StoredMembership extends OrganizationMembershipRecord { tenantId: string }

export interface OrganizationDependencies {
  authorize: (context: OrganizationContext, action: string, userId: string) => Promise<boolean>;
  roleExists: (tenantId: string, organizationId: string, roleId: string) => Promise<boolean>;
  userExists: (tenantId: string, userId: string) => Promise<boolean>;
  audit: (event: { action: string; outcome: string; reasonCode?: string; correlationId: string }) => void;
  now: () => Date;
  membershipId: () => string;
  initialMemberships?: OrganizationMembershipRecord[];
  initialTenantId?: string;
}

function publicRecord(membership: StoredMembership): OrganizationMembershipRecord {
  const { tenantId: _tenant, ...record } = membership;
  return record;
}

export function createOrganizationService(dependencies: OrganizationDependencies) {
  const memberships = new Map<string, StoredMembership>();
  const byUser = new Map<string, string>();
  const idempotency = new Map<string, { fingerprint: string; membershipId: string }>();
  for (const membership of dependencies.initialMemberships ?? []) {
    if (!dependencies.initialTenantId) throw new Error("initial-tenant-required");
    const stored = { ...membership, tenantId: dependencies.initialTenantId };
    memberships.set(stored.membershipId, stored);
    byUser.set(`${stored.tenantId}:${stored.organizationId}:${stored.userId}`, stored.membershipId);
  }

  async function mutate(context: OrganizationContext, command: OrganizationMembershipCommand): Promise<OrganizationMembershipRecord> {
    if (!await dependencies.authorize(context, `organization:${command.action}`, command.userId)) throw new Error("membership-unavailable");
    const key = `${context.tenantId}:${context.organizationId}:${command.idempotencyKey}`;
    const fingerprint = JSON.stringify(command);
    const prior = idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("idempotency-conflict");
      return publicRecord(memberships.get(prior.membershipId)!);
    }
    const userKey = `${context.tenantId}:${context.organizationId}:${command.userId}`;
    const existingId = byUser.get(userKey);
    const existing = existingId ? memberships.get(existingId) : undefined;
    const now = dependencies.now().toISOString();
    let result: StoredMembership;
    if (command.action === "add") {
      if (existing?.status === "active" || !command.roleId || !await dependencies.userExists(context.tenantId, command.userId)
        || !await dependencies.roleExists(context.tenantId, context.organizationId, command.roleId)) throw new Error("membership-unavailable");
      result = { membershipId: dependencies.membershipId(), organizationId: context.organizationId, userId: command.userId, roleId: command.roleId, status: "active", revision: 1, createdAt: now, updatedAt: now, tenantId: context.tenantId };
      memberships.set(result.membershipId, result);
      byUser.set(userKey, result.membershipId);
    } else {
      if (!existing || existing.tenantId !== context.tenantId || existing.status !== "active"
        || command.expectedRevision !== existing.revision) throw new Error("membership-conflict");
      if (command.action === "remove" || command.roleId !== "owner") {
        const owners = [...memberships.values()].filter((item) => item.tenantId === context.tenantId && item.organizationId === context.organizationId && item.status === "active" && item.roleId === "owner");
        if (existing.roleId === "owner" && owners.length === 1) throw new Error("last-owner-required");
      }
      if (command.action === "change-role") {
        if (!command.roleId || !await dependencies.roleExists(context.tenantId, context.organizationId, command.roleId)) throw new Error("membership-unavailable");
        existing.roleId = command.roleId;
      } else existing.status = "removed";
      existing.revision += 1;
      existing.updatedAt = now;
      result = existing;
    }
    idempotency.set(key, { fingerprint, membershipId: result.membershipId });
    dependencies.audit({ action: `organization:${command.action}`, outcome: "succeeded", correlationId: context.correlationId });
    return publicRecord(result);
  }
  return { mutate };
}
