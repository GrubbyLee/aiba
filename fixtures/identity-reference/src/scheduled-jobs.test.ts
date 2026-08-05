import { describe, expect, it } from "vitest";
import { createScheduledJobsService } from "./scheduled-jobs.js";

function fixture(options: { authorized?: boolean; failures?: number } = {}) {
  let now = new Date("2026-08-05T01:00:00Z");
  let attempts = 0;
  const audit: unknown[] = [];
  const service = createScheduledJobsService({
    loadDefinition: async (id) => id === "daily-report"
      ? { id, enabled: true, maximumAttempts: 2, leaseMs: 30_000 }
      : undefined,
    authorize: async () => options.authorized !== false,
    execute: async () => {
      attempts += 1;
      if (attempts <= (options.failures ?? 0)) throw new Error("provider secret detail");
    },
    audit: (event) => audit.push(event),
    now: () => now,
    jobId: () => "job_daily_0001",
  });
  const context = { tenantId: "tenant-a", principalId: "user-1", correlationId: "request-1" };
  const command = { definitionId: "daily-report", scheduledFor: now.toISOString(), idempotencyKey: "schedule-0001" };
  return { service, context, command, audit, attempts: () => attempts, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe("scheduled jobs reference boundary", () => {
  it("schedules one authorized definition and executes it once", async () => {
    const f = fixture();
    const job = await f.service.schedule(f.context, f.command);
    expect(job).not.toHaveProperty("tenantId");
    expect(await f.service.run(job.jobId, "worker-1")).toMatchObject({ status: "succeeded", attempt: 1 });
    await expect(f.service.run(job.jobId, "worker-2")).rejects.toThrow("job-not-runnable");
  });

  it("deduplicates exact schedules and rejects changed commands", async () => {
    const f = fixture();
    expect(await f.service.schedule(f.context, f.command)).toEqual(await f.service.schedule(f.context, f.command));
    await expect(f.service.schedule(f.context, { ...f.command, definitionId: "other-job" }))
      .rejects.toThrow("job-unavailable");
    await expect(f.service.schedule(f.context, { ...f.command, scheduledFor: "2026-08-05T02:00:00Z" }))
      .rejects.toThrow("idempotency-conflict");
  });

  it("retries failures only to the trusted maximum and minimizes errors", async () => {
    const f = fixture({ failures: 2 });
    const job = await f.service.schedule(f.context, f.command);
    expect(await f.service.run(job.jobId, "worker-1")).toMatchObject({ status: "retrying", attempt: 1, errorCode: "execution-failed" });
    const failed = await f.service.run(job.jobId, "worker-2");
    expect(failed).toMatchObject({ status: "failed", attempt: 2, errorCode: "execution-failed" });
    expect(JSON.stringify(failed)).not.toContain("provider secret detail");
  });

  it("rejects a second worker while an execution lease is active", async () => {
    let release!: () => void;
    const execution = new Promise<void>((resolve) => { release = resolve; });
    const f = fixture();
    const service = createScheduledJobsService({
      loadDefinition: async () => ({ id: "daily-report", enabled: true, maximumAttempts: 2, leaseMs: 30_000 }),
      authorize: async () => true,
      execute: async () => execution,
      audit: () => undefined,
      now: () => new Date("2026-08-05T01:00:00Z"),
      jobId: () => "job_daily_0002",
    });
    const job = await service.schedule(f.context, f.command);
    const firstWorker = service.run(job.jobId, "worker-1");
    await expect(service.run(job.jobId, "worker-2")).rejects.toThrow("job-leased");
    release();
    await expect(firstWorker).resolves.toMatchObject({ status: "succeeded", attempt: 1 });
  });

  it("rejects unauthorized, unknown, and future jobs", async () => {
    const denied = fixture({ authorized: false });
    await expect(denied.service.schedule(denied.context, denied.command)).rejects.toThrow("job-unavailable");
    const future = fixture();
    const job = await future.service.schedule(future.context, { ...future.command, scheduledFor: "2026-08-05T02:00:00Z" });
    await expect(future.service.run(job.jobId, "worker-1")).rejects.toThrow("job-not-runnable");
  });
});
