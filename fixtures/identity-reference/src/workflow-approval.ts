import type { ApprovalDecisionCommand, ApprovalRequestCommand, ApprovalWorkflowRecord } from "aiba-spec";
export interface ApprovalContext { tenantId: string; principalId: string; correlationId: string }
export interface ApprovalDefinition { id: string; enabled: boolean; resourceType: string; requiredApprovals: number; allowSelfApproval: boolean }
interface StoredWorkflow extends ApprovalWorkflowRecord { tenantId: string; requestFingerprint: string }
export interface ApprovalDependencies {
  loadDefinition: (id: string) => Promise<ApprovalDefinition | undefined>;
  resourceExists: (tenantId: string, type: string, id: string) => Promise<boolean>;
  authorize: (context: ApprovalContext, action: string, resource: { type: string; id: string }) => Promise<boolean>;
  now: () => Date; workflowId: () => string; decisionId: () => string;
}
function publicRecord(workflow: StoredWorkflow): ApprovalWorkflowRecord { const { tenantId: _tenant, requestFingerprint: _fingerprint, ...record } = workflow; return { ...record, decisions: record.decisions.map((item) => ({ ...item })) }; }

export function createApprovalService(dependencies: ApprovalDependencies) {
  const workflows = new Map<string, StoredWorkflow>();
  const requestKeys = new Map<string, string>();
  const decisionKeys = new Map<string, { fingerprint: string; workflowId: string }>();
  async function request(context: ApprovalContext, command: ApprovalRequestCommand): Promise<ApprovalWorkflowRecord> {
    const definition = await dependencies.loadDefinition(command.definitionId);
    const resource = { type: command.resourceType, id: command.resourceId };
    if (!definition?.enabled || definition.resourceType !== resource.type || definition.requiredApprovals < 1 || definition.requiredApprovals > 20
      || !await dependencies.resourceExists(context.tenantId, resource.type, resource.id) || !await dependencies.authorize(context, "approval:request", resource)) throw new Error("workflow-unavailable");
    const key = `${context.tenantId}:${command.idempotencyKey}`; const fingerprint = JSON.stringify(command); const priorId = requestKeys.get(key);
    if (priorId) { const prior = workflows.get(priorId)!; if (prior.requestFingerprint !== fingerprint) throw new Error("idempotency-conflict"); return publicRecord(prior); }
    const now = dependencies.now().toISOString();
    const workflow: StoredWorkflow = { workflowId: dependencies.workflowId(), definitionId: definition.id, resourceType: resource.type, resourceId: resource.id, requesterId: context.principalId, status: "pending", requiredApprovals: definition.requiredApprovals, revision: 1, decisions: [], createdAt: now, updatedAt: now, tenantId: context.tenantId, requestFingerprint: fingerprint };
    workflows.set(workflow.workflowId, workflow); requestKeys.set(key, workflow.workflowId); return publicRecord(workflow);
  }
  async function decide(context: ApprovalContext, command: ApprovalDecisionCommand): Promise<ApprovalWorkflowRecord> {
    const workflow = workflows.get(command.workflowId);
    if (!workflow || workflow.tenantId !== context.tenantId) throw new Error("workflow-unavailable");
    const key = `${context.tenantId}:${command.idempotencyKey}`; const fingerprint = JSON.stringify(command); const prior = decisionKeys.get(key);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error("idempotency-conflict"); return publicRecord(workflows.get(prior.workflowId)!); }
    if (workflow.status !== "pending") throw new Error("workflow-unavailable");
    const definition = await dependencies.loadDefinition(workflow.definitionId); const resource = { type: workflow.resourceType, id: workflow.resourceId };
    if (!definition?.enabled || (!definition.allowSelfApproval && workflow.requesterId === context.principalId)
      || workflow.decisions.some((item) => item.actorId === context.principalId)
      || !await dependencies.authorize(context, "approval:decide", resource)) throw new Error("decision-unavailable");
    if (workflow.status !== "pending" || command.expectedRevision !== workflow.revision || workflow.decisions.some((item) => item.actorId === context.principalId)) throw new Error("workflow-conflict");
    const now = dependencies.now().toISOString();
    workflow.decisions.push({ decisionId: dependencies.decisionId(), actorId: context.principalId, decision: command.decision, ...(command.reason ? { reason: command.reason } : {}), decidedAt: now });
    workflow.revision += 1; workflow.updatedAt = now;
    if (command.decision === "reject") workflow.status = "rejected";
    else if (workflow.decisions.filter((item) => item.decision === "approve").length >= workflow.requiredApprovals) workflow.status = "approved";
    decisionKeys.set(key, { fingerprint, workflowId: workflow.workflowId }); return publicRecord(workflow);
  }
  return { decide, request };
}
