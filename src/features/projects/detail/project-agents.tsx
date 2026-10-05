import { ArrowRight, MessageSquare, Send } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectDetail } from "@shared/agentos-types";
import {
  CommandButton,
  EmptyState,
  HairlineCard,
  Section,
  StatusPill,
  SystemIndicator,
} from "@/components/os";
import { statusLabel, statusPill } from "@/features/workers/workers-model";
import { useAgentStatus, useWorkerJobs, useWorkers } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * The agents, as part of the project.
 *
 * Hermes and the workers are infrastructure, and the infrastructure screens
 * are where they are *managed*. This tab is where they are *used*: who is
 * ready, what this project has asked them to do, and the three ways to ask for
 * more. It shows the project's defaults so the operator can see why a
 * delegation will suggest what it suggests.
 */
export function ProjectAgents({
  project,
  onAsk,
  onDelegate,
  onStartSession,
}: {
  project: ProjectDetail;
  onAsk: () => void;
  onDelegate: () => void;
  onStartSession: () => void;
}) {
  const hermes = useAgentStatus();
  const workers = useWorkers();
  const jobs = useWorkerJobs();

  const mine = (jobs.data?.jobs ?? []).filter((job) => job.project === project.slug);
  const { configuration } = project;

  return (
    <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-x-16">
      <div className="space-y-10">
        <Section label="Orchestrator">
          <HairlineCard className="p-5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[16px] leading-6 text-foreground">Hermes</span>
              <SystemIndicator
                state={hermes.isPending ? "syncing" : hermes.data?.configured ? "online" : "offline"}
                label={hermes.isPending ? "Checking" : hermes.data?.configured ? "Ready" : "Not configured"}
              />
            </div>
            {hermes.data?.model ? (
              <p className="mt-3 font-mono text-[12px] tracking-[0.04em] text-os-subtle">{hermes.data.model}</p>
            ) : null}
          </HairlineCard>
        </Section>

        <Section label="Workers">
          {workers.isPending ? (
            <p className="text-[15px] leading-6 text-os-muted">Checking who is available…</p>
          ) : workers.error || !workers.data ? (
            <EmptyState variant="inline" description="Workers could not be read." />
          ) : (
            <HairlineCard className="overflow-hidden">
              <ul className="divide-y divide-os-border">
                {workers.data.workers.map((worker) => {
                  const preferred = configuration.workerPreference === worker.id;
                  return (
                    <li key={worker.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[15px] leading-6 text-foreground">{worker.name}</span>
                          {preferred ? <span className="os-meta text-os-amber">Preferred</span> : null}
                        </div>
                        <p className="mt-0.5 truncate text-[13px] leading-5 text-os-subtle">
                          {worker.available ? worker.role : worker.unavailableReason ?? worker.role}
                        </p>
                      </div>
                      <SystemIndicator
                        state={worker.available ? "online" : "offline"}
                        label={worker.available ? "Ready" : "Unavailable"}
                      />
                    </li>
                  );
                })}
              </ul>
            </HairlineCard>
          )}
        </Section>

        <Section label="Defaults">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-[13px] leading-5">
            <dt className="os-meta text-os-subtle">Worker</dt>
            <dd className="text-os-muted">{configuration.workerPreference}</dd>
            <dt className="os-meta text-os-subtle">Visual</dt>
            <dd className="text-os-muted">{configuration.visualVerification}</dd>
            <dt className="os-meta text-os-subtle">Branch</dt>
            <dd className="font-mono text-os-muted">{configuration.defaultBranch ?? "checkout"}</dd>
            <dt className="os-meta text-os-subtle">Validation</dt>
            <dd className="font-mono text-os-muted">
              {configuration.validationCommands.length > 0
                ? configuration.validationCommands.join(" · ")
                : "none configured"}
            </dd>
          </dl>
        </Section>

        <div className="flex flex-col items-start gap-2">
          <CommandButton variant="secondary" icon={MessageSquare} iconPosition="start" onClick={onAsk}>
            Ask Hermes
          </CommandButton>
          <CommandButton variant="secondary" icon={Send} iconPosition="start" onClick={onDelegate}>
            Delegate task
          </CommandButton>
          <CommandButton variant="primary" icon={ArrowRight} onClick={onStartSession}>
            Start work session
          </CommandButton>
        </div>
      </div>

      <Section
        label="Worker jobs"
        action={
          <Link
            to="/workers"
            className="os-focus-ring os-meta -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            All workers →
          </Link>
        }
      >
        {jobs.isPending ? (
          <p className="text-[15px] leading-6 text-os-muted">Reading jobs…</p>
        ) : mine.length === 0 ? (
          <EmptyState
            variant="inline"
            description="No worker has been given work on this project yet. Delegate a task to start one."
          />
        ) : (
          <HairlineCard className="overflow-hidden">
            <ul className="divide-y divide-os-border">
              {mine.map((job) => (
                <li key={job.id}>
                  <Link
                    to={`/workers/jobs/${job.id}`}
                    className={cn(
                      "os-focus-ring flex cursor-pointer items-start gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-os-surface-raised",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] leading-6 text-foreground">{job.objective}</p>
                      <p className="mt-0.5 os-meta text-os-subtle">
                        {job.resolvedWorker ?? job.worker} · {new Date(job.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusPill status={statusPill(job.status)} label={statusLabel(job.status)} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </HairlineCard>
        )}
      </Section>
    </div>
  );
}
