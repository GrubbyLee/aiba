import type { ScheduledJobCommand, ScheduledJobRecord } from "aiba-spec";

export interface ScheduledJobContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
}

export interface ScheduledJobDefinition {
  id: string;
  enabled: boolean;
  maximumAttempts: number;
  leaseMs: number;
}

interface StoredJob extends ScheduledJobRecord {
  tenantId: string;
  commandFingerprint: string;
  leaseOwner?: string;
}

export interface ScheduledJobDependencies {
  loadDefinition: (definitionId: string) => Promise<ScheduledJobDefinition | undefined>;
  authorize: (context: ScheduledJobContext, definitionId: string) => Promise<boolean>;
  execute: (input: { tenantId: string; definitionId: string; jobId: string }) => Promise<void>;
  audit: (event: { action: string; outcome: string; reasonCode?: string; correlationId: string }) => void;
  now: () => Date;
  jobId: () => string;
}

function publicRecord(job: StoredJob): ScheduledJobRecord {
  const { tenantId: _tenantId, commandFingerprint: _fingerprint, leaseOwner: _owner, ...record } = job;
  return record;
}

export function createScheduledJobsService(dependencies: ScheduledJobDependencies) {
  const jobs = new Map<string, StoredJob>();
  const idempotency = new Map<string, string>();

  async function schedule(
    context: ScheduledJobContext,
    command: ScheduledJobCommand,
  ): Promise<ScheduledJobRecord> {
    const definition = await dependencies.loadDefinition(command.definitionId);
    if (!definition?.enabled || definition.maximumAttempts < 1 || definition.maximumAttempts > 100
      || definition.leaseMs < 1_000 || !await dependencies.authorize(context, command.definitionId)) {
      throw new Error("job-unavailable");
    }
    const key = `${context.tenantId}:${command.idempotencyKey}`;
    const commandFingerprint = JSON.stringify(command);
    const existingId = idempotency.get(key);
    if (existingId) {
      const existing = jobs.get(existingId)!;
      if (existing.commandFingerprint !== commandFingerprint) throw new Error("idempotency-conflict");
      return publicRecord(existing);
    }
    const now = dependencies.now();
    const job: StoredJob = {
      jobId: dependencies.jobId(),
      definitionId: definition.id,
      status: "queued",
      attempt: 0,
      maximumAttempts: definition.maximumAttempts,
      scheduledFor: command.scheduledFor,
      createdAt: now.toISOString(),
      tenantId: context.tenantId,
      commandFingerprint,
    };
    jobs.set(job.jobId, job);
    idempotency.set(key, job.jobId);
    dependencies.audit({ action: "scheduled-jobs:schedule", outcome: "succeeded", correlationId: context.correlationId });
    return publicRecord(job);
  }

  async function run(jobId: string, workerId: string): Promise<ScheduledJobRecord> {
    const job = jobs.get(jobId);
    const now = dependencies.now();
    if (!job || Date.parse(job.scheduledFor) > now.getTime()) throw new Error("job-not-runnable");
    if (job.status === "running" && Date.parse(job.leaseExpiresAt ?? "") > now.getTime()) {
      throw new Error("job-leased");
    }
    if (!["queued", "retrying", "running"].includes(job.status)) throw new Error("job-not-runnable");
    const definition = await dependencies.loadDefinition(job.definitionId);
    if (!definition?.enabled) throw new Error("job-not-runnable");
    const leaseNow = dependencies.now();
    if (job.status === "running" && Date.parse(job.leaseExpiresAt ?? "") > leaseNow.getTime()) {
      throw new Error("job-leased");
    }
    if (!["queued", "retrying", "running"].includes(job.status)) throw new Error("job-not-runnable");
    job.status = "running";
    job.attempt += 1;
    job.leaseOwner = workerId;
    job.leaseExpiresAt = new Date(leaseNow.getTime() + definition.leaseMs).toISOString();
    delete job.errorCode;
    try {
      await dependencies.execute({ tenantId: job.tenantId, definitionId: job.definitionId, jobId: job.jobId });
      job.status = "succeeded";
      job.completedAt = dependencies.now().toISOString();
      delete job.leaseExpiresAt;
      delete job.leaseOwner;
    } catch {
      job.errorCode = "execution-failed";
      job.status = job.attempt >= job.maximumAttempts ? "failed" : "retrying";
      if (job.status === "failed") job.completedAt = dependencies.now().toISOString();
      delete job.leaseExpiresAt;
      delete job.leaseOwner;
    }
    return publicRecord(job);
  }

  return { run, schedule };
}
