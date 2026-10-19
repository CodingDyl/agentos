import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { AgentJobSummary } from "@shared/agent-types";
import { AppShell, DedsecLoader } from "@/components/os";
import { Meter, PAPER_FOCUS, PaperButton, PaperCard, PaperSection, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useAgent, usePatchAgent } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { AgentForm } from "./agent-form";
import { spendLabel, spendRatio, spendTone } from "./agents-model";

export function AgentProfilePage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const { data, isPending, isFetching, error, refetch } = useAgent(id);
  const save = usePatchAgent(id);

  return (
    <AppShell navigationItems={navigationItems} pageId="agent-profile" activeHref="/agents" modelLabel="Model / AgentOS V1">
      <PaperStage full>
        {isPending ? (
          <DedsecLoader variant="page" />
        ) : !data ? (
          <div className="py-4">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">That agent has no record.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "Nothing was returned for this agent."}</p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <div>
            <Link
              to="/agents"
              className={cn("-mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-none px-1 text-[13px] text-paper-sage transition-colors duration-150 hover:text-paper-moss", PAPER_FOCUS)}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Agents
            </Link>

            <header className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-paper-mist pb-6">
              <div className="min-w-0">
                <h1 className="font-paper-display text-[30px] leading-9 font-extrabold tracking-[-0.015em] text-paper-moss">
                  <span className="mr-2" aria-hidden="true">
                    {data.agent.avatar}
                  </span>
                  {data.agent.name}
                </h1>
                <p className="mt-2 text-[14px] text-paper-sage">{data.agent.role}</p>
                <p className="mt-2 max-w-[72ch] text-[14px] leading-6 text-paper-char">{data.agent.mission}</p>
              </div>
              <div className="w-full max-w-[16rem]">
                <p className="text-[12.5px] text-paper-sage tabular-nums">{spendLabel(data.spend)} · {data.spend.windowLabel}</p>
                <div className="mt-2">
                  <Meter value={spendRatio(data.spend)} label="Spend versus ceiling" tone={spendTone(data.spend)} size="md" />
                </div>
              </div>
            </header>

            <div className="mt-8 grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
              <div className="min-w-0 space-y-10">
                <PaperSection label="Jobs" count={data.jobs.length}>
                  {data.jobs.length === 0 ? (
                    <p className="text-[14px] leading-6 text-paper-sage">No jobs on this agent yet.</p>
                  ) : (
                    <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
                      {data.jobs.map((job) => (
                        <li key={job.id}>
                          <JobLine job={job} />
                        </li>
                      ))}
                    </ul>
                  )}
                </PaperSection>

                <PaperSection label="Schedules" count={data.agent.schedules.length}>
                  {data.agent.schedules.length === 0 ? (
                    <p className="text-[14px] leading-6 text-paper-sage">None linked. Add a cadence note or a Hermes automation id.</p>
                  ) : (
                    <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
                      {data.agent.schedules.map((row) => (
                        <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                          <span>
                            <span className="block text-[14px] text-paper-moss">{row.label}</span>
                            <span className="mt-0.5 block text-[12.5px] text-paper-sage">{row.cadence}</span>
                          </span>
                          {row.automationId ? (
                            <Link to={`/automations/${row.automationId}`} className={cn("text-[13px] text-paper-moss underline decoration-paper-mist underline-offset-[3px]", PAPER_FOCUS)}>
                              Automation
                            </Link>
                          ) : (
                            <span className="text-[12.5px] text-paper-sage">Note</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </PaperSection>

                {data.agent.memoryNotes ? (
                  <PaperCard>
                    <h2 className="text-[12.5px] font-medium tracking-[0.08em] text-paper-char uppercase">Memory</h2>
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-paper-moss">{data.agent.memoryNotes}</p>
                  </PaperCard>
                ) : null}
              </div>

              <div className="min-w-0">
                <PaperSection label="Edit">
                  <AgentForm
                    key={`${data.agent.id}:${data.agent.updatedAt}`}
                    agent={data.agent}
                    pending={save.isPending}
                    error={save.error?.message}
                    onSave={(patch) => save.mutate(patch)}
                  />
                </PaperSection>
              </div>
            </div>
          </div>
        )}
      </PaperStage>
    </AppShell>
  );
}

function JobLine({ job }: { job: AgentJobSummary }) {
  return (
    <Link to={job.href} className={cn("flex items-start justify-between gap-4 px-4 py-3 hover:bg-paper-cream", PAPER_FOCUS)}>
      <span className="min-w-0">
        <span className="block truncate text-[14px] text-paper-moss">{job.objective}</span>
        <span className="mt-0.5 block text-[12.5px] text-paper-sage">
          {job.worker.toUpperCase()} · {job.project}
        </span>
      </span>
      <Tag tone={job.status === "failed" ? "flame" : job.status === "completed" ? "green" : "muted"}>{job.status.replace(/_/g, " ")}</Tag>
    </Link>
  );
}
