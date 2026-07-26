import { randomUUID, sign, verify } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  AIBA_API_VERSION,
  type CapabilityApproval,
  type CapabilityReceipt,
  type GovernanceOperation,
  type OperationPlan,
  type TeamGovernancePolicy,
  type UpgradePlan,
} from "@aiba/spec";
import { satisfies, validRange } from "semver";
import { AibaError } from "./errors.js";
import { sha256File } from "./hash.js";
import { loadOperationPlan, loadUpgradePlan } from "./loaders.js";
import { resolveExistingProjectPath } from "./paths.js";
import {
  canonicalDocument,
  loadEd25519PrivateKey,
  loadEd25519PublicKey,
} from "./signing.js";
import {
  validateCapabilityApproval,
  validateTeamGovernancePolicy,
} from "./validation.js";

const POLICY_PROJECT_PATH = ".aiba/governance-policy.json";
const APPROVAL_DOMAIN = "AIBA-CAPABILITY-APPROVAL-V1\n";
const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const CAPABILITY_ID = /^[a-z][a-z0-9-]{1,62}$/;
const IDENTIFIER = /^[a-z][a-z0-9-]{1,95}$/;

export interface InitializeGovernancePolicyOptions {
  projectRoot: string;
  policyId: string;
  approverId: string;
  keyId: string;
  publicKeyPath: string;
  capabilities: string[];
  installApprovals?: number;
  upgradeApprovals?: number;
  conflictUpgradeApprovals?: number;
  approvalTtlSeconds?: number;
  prohibitSelfApproval?: boolean;
}

export interface InitializeGovernancePolicyResult {
  policyPath: string;
  policy: TeamGovernancePolicy;
}

export interface CreateCapabilityApprovalOptions {
  projectRoot: string;
  capabilityId: string;
  operation: GovernanceOperation;
  approverId: string;
  keyId: string;
  privateKeyPath: string;
  now?: () => Date;
}

export interface CreateCapabilityApprovalResult {
  approvalPath: string;
  approval: CapabilityApproval;
}

export interface GovernanceIssue {
  code: string;
  message: string;
  path?: string;
}

export interface EvaluateGovernanceOptions {
  projectRoot: string;
  capabilityId: string;
  operation: GovernanceOperation;
  agent?: string;
  now?: () => Date;
}

export interface GovernanceEvaluation {
  enabled: boolean;
  ok: boolean;
  operation: GovernanceOperation;
  requiredApprovals: number;
  validApprovals: number;
  issues: GovernanceIssue[];
  provenance?: NonNullable<CapabilityReceipt["installation"]["governance"]>;
}

interface LoadedPolicy {
  policy: TeamGovernancePolicy;
  absolutePath: string;
  projectPath: string;
  sha256: string;
}

interface OperationContext {
  project: string;
  plan: OperationPlan | UpgradePlan;
  planPath: string;
  planSha256: string;
  evidence: Array<{ path: string; sha256: string }>;
  fromVersion?: string;
  toVersion: string;
  conflicts: number;
}

function normalizeProjectPath(path: string): string {
  return path.split(sep).join("/");
}

function assertIdentifier(value: string, label: string, pattern = IDENTIFIER): void {
  if (!pattern.test(value)) {
    throw new AibaError(`Invalid ${label}: ${value}`, "INVALID_GOVERNANCE_IDENTIFIER");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path: string, label: string): Promise<unknown> {
  const info = await lstat(path).catch((error: unknown) => {
    throw new AibaError(`Cannot read ${label}: ${path}`, "DOCUMENT_NOT_FOUND", {
      cause: error,
    });
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AibaError(`${label} must be a regular file`, "INVALID_GOVERNANCE_PATH");
  }
  if (info.size > MAX_DOCUMENT_SIZE) {
    throw new AibaError(`${label} exceeds size limit`, "DOCUMENT_TOO_LARGE");
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new AibaError(`Cannot parse ${label}: ${path}`, "INVALID_JSON", { cause: error });
  }
}

function assertPolicySemantics(policy: TeamGovernancePolicy): void {
  const capabilityIds = policy.spec.capabilities.map((item) => item.id);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new AibaError("Governance policy repeats a capability", "DUPLICATE_POLICY_CAPABILITY");
  }
  for (const capability of policy.spec.capabilities) {
    if (!validRange(capability.versions)) {
      throw new AibaError(
        `Invalid governed version range for ${capability.id}: ${capability.versions}`,
        "INVALID_GOVERNANCE_VERSION_RANGE",
      );
    }
  }
  const approverKeys = policy.spec.approvers.map((item) => `${item.id}\0${item.keyId}`);
  if (new Set(approverKeys).size !== approverKeys.length) {
    throw new AibaError("Governance policy repeats an approver key", "DUPLICATE_POLICY_APPROVER_KEY");
  }
  for (const approver of policy.spec.approvers) {
    loadEd25519PublicKey(approver.publicKey);
  }
  if (policy.spec.requirements.upgradeWithConflicts < policy.spec.requirements.upgrade) {
    throw new AibaError(
      "Conflict upgrade threshold cannot be lower than upgrade threshold",
      "INVALID_GOVERNANCE_THRESHOLD",
    );
  }
  for (const operation of ["install", "upgrade"] as const) {
    const eligible = new Set(
      policy.spec.approvers
        .filter((approver) => approver.permissions.includes(operation))
        .map((approver) => approver.id),
    ).size;
    const required = operation === "install"
      ? policy.spec.requirements.install
      : policy.spec.requirements.upgradeWithConflicts;
    if (required > eligible) {
      throw new AibaError(
        `Governance policy requires ${required} ${operation} approvals but has ${eligible} eligible approvers`,
        "UNSATISFIABLE_GOVERNANCE_POLICY",
      );
    }
  }
}

async function loadPolicy(root: string): Promise<LoadedPolicy | undefined> {
  const absolutePath = join(resolve(root), ...POLICY_PROJECT_PATH.split("/"));
  if (!(await pathExists(absolutePath))) return undefined;
  const policy = validateTeamGovernancePolicy(
    await readJson(absolutePath, "governance policy"),
  );
  assertPolicySemantics(policy);
  return {
    policy,
    absolutePath,
    projectPath: POLICY_PROJECT_PATH,
    sha256: await sha256File(absolutePath),
  };
}

async function operationContext(
  root: string,
  capabilityId: string,
  operation: GovernanceOperation,
): Promise<OperationContext> {
  const projectRoot = resolve(root);
  if (operation === "install") {
    const plan = await loadOperationPlan(projectRoot, capabilityId);
    const planPath = join(projectRoot, ".aiba", "plans", `${capabilityId}.yaml`);
    return {
      project: plan.project.name,
      plan,
      planPath: normalizeProjectPath(relative(projectRoot, planPath)),
      planSha256: await sha256File(planPath),
      evidence: await evidenceDigests(projectRoot, plan),
      toVersion: plan.capability.version,
      conflicts: 0,
    };
  }
  const plan = await loadUpgradePlan(projectRoot, capabilityId);
  const planPath = join(projectRoot, ".aiba", "plans", `${capabilityId}.upgrade.yaml`);
  return {
    project: plan.project.name,
    plan,
    planPath: normalizeProjectPath(relative(projectRoot, planPath)),
    planSha256: await sha256File(planPath),
    evidence: await evidenceDigests(projectRoot, plan),
    fromVersion: plan.capability.fromVersion,
    toVersion: plan.capability.toVersion,
    conflicts: plan.drift.filter((item) => item.conflict !== "none").length,
  };
}

async function evidenceDigests(
  root: string,
  plan: Pick<OperationPlan, "evidence"> | Pick<UpgradePlan, "evidence">,
): Promise<Array<{ path: string; sha256: string }>> {
  const paths = new Set<string>();
  for (const attestation of plan.evidence) {
    for (const item of attestation.items) {
      paths.add(normalizeProjectPath(item.path));
    }
  }
  if (paths.size === 0) {
    throw new AibaError(
      "Approval requires final implementation evidence",
      "APPROVAL_EVIDENCE_REQUIRED",
    );
  }
  const result: Array<{ path: string; sha256: string }> = [];
  for (const path of [...paths].sort()) {
    if (path === ".aiba" || path.startsWith(".aiba/")) {
      throw new AibaError(
        `AIBA state cannot be approval evidence: ${path}`,
        "AIBA_STATE_AS_EVIDENCE",
      );
    }
    const absolutePath = await resolveExistingProjectPath(root, path);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw new AibaError(`Approval evidence is not a file: ${path}`, "EVIDENCE_NOT_FILE");
    }
    result.push({ path, sha256: await sha256File(absolutePath) });
  }
  return result;
}

function capabilityAllowed(
  policy: TeamGovernancePolicy,
  capabilityId: string,
  version: string,
): boolean {
  const rule = policy.spec.capabilities.find((item) => item.id === capabilityId);
  return Boolean(rule && satisfies(version, rule.versions));
}

function requiredApprovals(
  policy: TeamGovernancePolicy,
  operation: GovernanceOperation,
  conflicts: number,
): number {
  if (operation === "install") return policy.spec.requirements.install;
  return conflicts > 0
    ? policy.spec.requirements.upgradeWithConflicts
    : policy.spec.requirements.upgrade;
}

function signedApprovalBytes(approval: Pick<CapabilityApproval, "apiVersion" | "kind" | "statement">): Buffer {
  return Buffer.from(`${APPROVAL_DOMAIN}${canonicalDocument(approval)}`);
}

async function writeJsonReplacing(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (await pathExists(path)) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new AibaError("Approval output must be a regular file", "INVALID_APPROVAL_OUTPUT");
    }
  }
  const temporary = join(dirname(path), `.${randomUUID()}.approval.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function initializeGovernancePolicy(
  options: InitializeGovernancePolicyOptions,
): Promise<InitializeGovernancePolicyResult> {
  assertIdentifier(options.policyId, "policy identifier");
  assertIdentifier(options.approverId, "approver identifier");
  assertIdentifier(options.keyId, "approver key identifier");
  if (options.capabilities.length === 0) {
    throw new AibaError("Governance policy requires capabilities", "GOVERNANCE_CAPABILITIES_REQUIRED");
  }
  for (const capability of options.capabilities) {
    assertIdentifier(capability, "capability identifier", CAPABILITY_ID);
  }
  const root = resolve(options.projectRoot);
  const stateDirectory = join(root, ".aiba");
  const stateInfo = await lstat(stateDirectory).catch((error: unknown) => {
    throw new AibaError("Initialize AIBA before governance policy", "AIBA_NOT_INITIALIZED", {
      cause: error,
    });
  });
  if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()) {
    throw new AibaError("AIBA state must be a regular directory", "INVALID_AIBA_STATE");
  }
  const publicKeyInfo = await lstat(resolve(options.publicKeyPath));
  if (!publicKeyInfo.isFile() || publicKeyInfo.isSymbolicLink()) {
    throw new AibaError("Approver public key must be a regular file", "INVALID_APPROVER_KEY_PATH");
  }
  const publicKey = await readFile(resolve(options.publicKeyPath), "utf8");
  loadEd25519PublicKey(publicKey);
  const policy: TeamGovernancePolicy = {
    apiVersion: AIBA_API_VERSION,
    kind: "TeamGovernancePolicy",
    metadata: { id: options.policyId, version: "0.1.0" },
    spec: {
      capabilities: [...new Set(options.capabilities)].sort().map((id) => ({
        id,
        versions: "*",
      })),
      approvers: [{
        id: options.approverId,
        keyId: options.keyId,
        algorithm: "Ed25519",
        publicKey,
        permissions: ["install", "upgrade"],
      }],
      requirements: {
        install: options.installApprovals ?? 1,
        upgrade: options.upgradeApprovals ?? 1,
        upgradeWithConflicts: options.conflictUpgradeApprovals
          ?? options.upgradeApprovals
          ?? 1,
      },
      approvalTtlSeconds: options.approvalTtlSeconds ?? 259200,
      prohibitSelfApproval: options.prohibitSelfApproval ?? true,
    },
  };
  validateTeamGovernancePolicy(policy);
  assertPolicySemantics(policy);
  const absolutePath = join(stateDirectory, "governance-policy.json");
  try {
    await writeFile(absolutePath, `${JSON.stringify(policy, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AibaError("Governance policy already exists", "GOVERNANCE_POLICY_EXISTS");
    }
    throw error;
  }
  return { policyPath: POLICY_PROJECT_PATH, policy };
}

export async function createCapabilityApproval(
  options: CreateCapabilityApprovalOptions,
): Promise<CreateCapabilityApprovalResult> {
  assertIdentifier(options.capabilityId, "capability identifier", CAPABILITY_ID);
  assertIdentifier(options.approverId, "approver identifier");
  assertIdentifier(options.keyId, "approver key identifier");
  const root = resolve(options.projectRoot);
  const loaded = await loadPolicy(root);
  if (!loaded) {
    throw new AibaError("Project has no governance policy", "GOVERNANCE_POLICY_NOT_FOUND");
  }
  const context = await operationContext(root, options.capabilityId, options.operation);
  if (!capabilityAllowed(loaded.policy, options.capabilityId, context.toVersion)) {
    throw new AibaError(
      `Policy does not allow ${options.capabilityId}@${context.toVersion}`,
      "GOVERNANCE_CAPABILITY_DENIED",
    );
  }
  const trusted = loaded.policy.spec.approvers.find(
    (item) => item.id === options.approverId && item.keyId === options.keyId,
  );
  if (!trusted || !trusted.permissions.includes(options.operation)) {
    throw new AibaError(
      `Approver ${options.approverId}/${options.keyId} cannot approve ${options.operation}`,
      "GOVERNANCE_APPROVER_UNAUTHORIZED",
    );
  }
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new AibaError("Approval time must be a valid date", "INVALID_APPROVAL_TIME");
  }
  const privateKey = await loadEd25519PrivateKey(options.privateKeyPath);
  const unsigned: Pick<CapabilityApproval, "apiVersion" | "kind" | "statement"> = {
    apiVersion: AIBA_API_VERSION,
    kind: "CapabilityApproval",
    statement: {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + loaded.policy.spec.approvalTtlSeconds * 1000,
      ).toISOString(),
      project: context.project,
      operation: {
        type: options.operation,
        capability: options.capabilityId,
        ...(context.fromVersion ? { fromVersion: context.fromVersion } : {}),
        toVersion: context.toVersion,
        conflicts: context.conflicts,
      },
      plan: { path: context.planPath, sha256: context.planSha256 },
      evidence: context.evidence,
      policy: {
        id: loaded.policy.metadata.id,
        version: loaded.policy.metadata.version,
        path: loaded.projectPath,
        sha256: loaded.sha256,
      },
      approver: { id: options.approverId, keyId: options.keyId },
    },
  };
  const signatureBytes = sign(null, signedApprovalBytes(unsigned), privateKey);
  if (!verify(
    null,
    signedApprovalBytes(unsigned),
    loadEd25519PublicKey(trusted.publicKey),
    signatureBytes,
  )) {
    throw new AibaError(
      "Private key does not match the approver policy key",
      "APPROVER_PRIVATE_KEY_MISMATCH",
    );
  }
  const approval: CapabilityApproval = {
    ...unsigned,
    signature: {
      algorithm: "Ed25519",
      keyId: options.keyId,
      value: signatureBytes.toString("base64url"),
    },
  };
  validateCapabilityApproval(approval);
  const approvalPath = join(
    root,
    ".aiba",
    "approvals",
    options.capabilityId,
    options.operation,
    `${options.approverId}-${options.keyId}.json`,
  );
  await writeJsonReplacing(approvalPath, approval);
  return {
    approvalPath: normalizeProjectPath(relative(root, approvalPath)),
    approval,
  };
}

function exactOperation(
  approval: CapabilityApproval,
  context: OperationContext,
  capabilityId: string,
  operation: GovernanceOperation,
): boolean {
  const actual = approval.statement.operation;
  return actual.type === operation
    && actual.capability === capabilityId
    && actual.toVersion === context.toVersion
    && actual.conflicts === context.conflicts
    && actual.fromVersion === context.fromVersion;
}

async function approvalFiles(root: string, capabilityId: string, operation: GovernanceOperation) {
  const directory = join(root, ".aiba", "approvals", capabilityId, operation);
  if (!(await pathExists(directory))) return [];
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AibaError("Approval directory must be a regular directory", "INVALID_APPROVAL_DIRECTORY");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.sort((left, right) => left.name < right.name ? -1 : 1).map((entry) => ({
    entry,
    absolutePath: join(directory, entry.name),
    projectPath: normalizeProjectPath(relative(root, join(directory, entry.name))),
  }));
}

export async function evaluateGovernance(
  options: EvaluateGovernanceOptions,
): Promise<GovernanceEvaluation> {
  const root = resolve(options.projectRoot);
  const loaded = await loadPolicy(root);
  if (!loaded) {
    return {
      enabled: false,
      ok: true,
      operation: options.operation,
      requiredApprovals: 0,
      validApprovals: 0,
      issues: [],
    };
  }
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new AibaError("Governance evaluation time must be valid", "INVALID_APPROVAL_TIME");
  }
  const context = await operationContext(root, options.capabilityId, options.operation);
  const required = requiredApprovals(loaded.policy, options.operation, context.conflicts);
  const issues: GovernanceIssue[] = [];
  let policyAllows = true;
  if (!capabilityAllowed(loaded.policy, options.capabilityId, context.toVersion)) {
    policyAllows = false;
    issues.push({
      code: "GOVERNANCE_CAPABILITY_DENIED",
      message: `Policy does not allow ${options.capabilityId}@${context.toVersion}`,
    });
  }
  let agentAllowed = true;
  if (loaded.policy.spec.prohibitSelfApproval && !options.agent) {
    agentAllowed = false;
    issues.push({
      code: "GOVERNANCE_AGENT_REQUIRED",
      message: "Policy requires the implementing Agent identity for separation of duties",
    });
  }

  const accepted = new Map<string, {
    approval: CapabilityApproval;
    path: string;
    sha256: string;
  }>();
  for (const file of await approvalFiles(root, options.capabilityId, options.operation)) {
    if (!file.entry.isFile() || !file.entry.name.endsWith(".json")) {
      issues.push({
        code: "INVALID_APPROVAL_FILE",
        message: `Approval entry is not a JSON file: ${file.projectPath}`,
        path: file.projectPath,
      });
      continue;
    }
    try {
      const approval = validateCapabilityApproval(
        await readJson(file.absolutePath, "capability approval"),
      );
      const trusted = loaded.policy.spec.approvers.filter(
        (item) => item.id === approval.statement.approver.id
          && item.keyId === approval.statement.approver.keyId,
      );
      if (trusted.length !== 1 || !trusted[0]?.permissions.includes(options.operation)) {
        throw new AibaError("Approval signer is not authorized", "GOVERNANCE_APPROVER_UNAUTHORIZED");
      }
      if (
        approval.signature.keyId !== approval.statement.approver.keyId
        || approval.signature.keyId !== trusted[0].keyId
      ) {
        throw new AibaError("Approval key IDs differ", "APPROVAL_KEY_ID_MISMATCH");
      }
      if (
        approval.statement.project !== context.project
        || !exactOperation(approval, context, options.capabilityId, options.operation)
        || approval.statement.plan.path !== context.planPath
        || approval.statement.plan.sha256 !== context.planSha256
        || canonicalDocument(approval.statement.evidence) !== canonicalDocument(context.evidence)
        || approval.statement.policy.id !== loaded.policy.metadata.id
        || approval.statement.policy.version !== loaded.policy.metadata.version
        || approval.statement.policy.path !== loaded.projectPath
        || approval.statement.policy.sha256 !== loaded.sha256
      ) {
        throw new AibaError("Approval does not bind the current plan and policy", "STALE_CAPABILITY_APPROVAL");
      }
      const createdAt = Date.parse(approval.statement.createdAt);
      const expiresAt = Date.parse(approval.statement.expiresAt);
      if (createdAt > now.getTime() + MAX_CLOCK_SKEW_MS) {
        throw new AibaError("Approval was created in the future", "APPROVAL_FROM_FUTURE");
      }
      if (expiresAt <= now.getTime()) {
        throw new AibaError("Approval has expired", "APPROVAL_EXPIRED");
      }
      if (
        expiresAt <= createdAt
        || expiresAt - createdAt > loaded.policy.spec.approvalTtlSeconds * 1000
      ) {
        throw new AibaError("Approval lifetime violates policy", "INVALID_APPROVAL_LIFETIME");
      }
      if (
        loaded.policy.spec.prohibitSelfApproval
        && options.agent === approval.statement.approver.id
      ) {
        throw new AibaError("Implementing Agent cannot self-approve", "SELF_APPROVAL_PROHIBITED");
      }
      const signatureBytes = Buffer.from(approval.signature.value, "base64url");
      const unsigned = {
        apiVersion: approval.apiVersion,
        kind: approval.kind,
        statement: approval.statement,
      };
      if (
        signatureBytes.length !== 64
        || !verify(
          null,
          signedApprovalBytes(unsigned),
          loadEd25519PublicKey(trusted[0].publicKey),
          signatureBytes,
        )
      ) {
        throw new AibaError("Approval signature is invalid", "APPROVAL_SIGNATURE_INVALID");
      }
      const approverId = approval.statement.approver.id;
      if (accepted.has(approverId)) {
        issues.push({
          code: "DUPLICATE_APPROVER_VOTE",
          message: `Approver ${approverId} can contribute only one vote`,
          path: file.projectPath,
        });
        continue;
      }
      accepted.set(approverId, {
        approval,
        path: file.projectPath,
        sha256: await sha256File(file.absolutePath),
      });
    } catch (error) {
      issues.push({
        code: error instanceof AibaError ? error.code : "INVALID_CAPABILITY_APPROVAL",
        message: error instanceof Error ? error.message : String(error),
        path: file.projectPath,
      });
    }
  }
  const valid = [...accepted.values()];
  if (valid.length < required) {
    issues.push({
      code: "GOVERNANCE_APPROVAL_THRESHOLD_UNMET",
      message: `Governance requires ${required} approvals, found ${valid.length}`,
    });
  }
  const ok = policyAllows && agentAllowed && valid.length >= required;
  return {
    enabled: true,
    ok,
    operation: options.operation,
    requiredApprovals: required,
    validApprovals: valid.length,
    issues,
    ...(ok ? {
      provenance: {
        operation: options.operation,
        policy: loaded.projectPath,
        policySha256: loaded.sha256,
        approvals: valid.slice(0, required).map((item) => ({
          path: item.path,
          sha256: item.sha256,
          approver: item.approval.statement.approver.id,
          keyId: item.approval.statement.approver.keyId,
        })),
      },
    } : {}),
  };
}

export async function requireGovernance(
  options: EvaluateGovernanceOptions,
): Promise<NonNullable<CapabilityReceipt["installation"]["governance"]> | undefined> {
  const evaluation = await evaluateGovernance(options);
  if (!evaluation.ok) {
    throw new AibaError(
      `Governance denied ${options.operation}: ${evaluation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
      "GOVERNANCE_DENIED",
    );
  }
  return evaluation.provenance;
}
