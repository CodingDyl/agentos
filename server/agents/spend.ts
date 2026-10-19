import type { AgentJobSummary, AgentRecord, AgentSpend } from "../../shared/agent-types";
import type { WorkerJob } from "../../shared/worker-types";
import { readUsage } from "../usage/ledger";
import { listJobs } from "../workers/job-store";

const JOB_LOOKBACK = 200;

export function jobSummary(job: WorkerJob): AgentJobSummary {
  const line = job.objective.split("\n")[0]?.trim() || job.objective;
  return {
    id: job.id,
    objective: line.length > 90 ? `${line.slice(0, 89)}…` : line,
    status: job.status,
    project: job.project,
    worker: job.resolvedWorker ?? (job.worker === "auto" ? "auto" : job.worker),
    createdAt: job.createdAt,
    href: `/workers/jobs/${job.id}`,
  };
}

export function isOpenJob(job: WorkerJob): boolean {
  return !["completed", "rejected", "failed", "cancelled"].includes(job.status);
}

export async function jobsForAgent(agentId: string): Promise<WorkerJob[]> {
  const jobs = await listJobs(JOB_LOOKBACK);
  return jobs.filter((job) => job.agentId === agentId);
}

function monthWindow(now: Date): { label: string; from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return {
    label: from.toLocaleString("en-GB", { month: "long", timeZone: "UTC" }),
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export async function spendForAgent(agent: AgentRecord, jobs?: WorkerJob[], now = new Date()): Promise<AgentSpend> {
  const window = monthWindow(now);
  const mine = jobs ?? (await jobsForAgent(agent.id));
  const inWindow = mine.filter((job) => job.createdAt >= window.from && job.createdAt < window.to);
  const ids = new Set(inWindow.map((job) => job.id));
  const records = readUsage({ from: window.from, to: window.to });
  const usd = records
    .filter((record) => record.jobId && ids.has(record.jobId) && typeof record.costUsd === "number")
    .reduce((sum, record) => sum + (record.costUsd ?? 0), 0);

  return {
    usd,
    ceilingUsd: agent.creditCeilingUsd,
    windowLabel: window.label,
    from: window.from,
    to: window.to,
    jobs: inWindow.length,
  };
}
