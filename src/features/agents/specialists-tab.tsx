import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AgentSummary } from "@shared/agent-types";
import { PageLoader, FilterToolbar, type FilterGroup } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import { useAgents } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { filterAgents, jobsLabel, type AgentStatusFilter } from "./agents-model";

/**
 * The specialists every job is assigned to, on Operations: who is on the team
 * and what each is doing. Open one to change its brief, model and tools.
 * Runtime workers (Claude, Grok) stay on the Agents tab and Worker jobs.
 */
export function SpecialistsTab() {
  const { data, isPending, isFetching, error, refetch } = useAgents();
  const [status, setStatus] = useState<AgentStatusFilter>("all");
  const [workspace, setWorkspace] = useState("all");
  const [query, setQuery] = useState("");

  const agents = useMemo(() => data?.agents ?? [], [data?.agents]);
  const workspaces = useMemo(
    () => [...new Set(agents.flatMap((agent) => agent.linkedWorkspaces))].sort(),
    [agents],
  );
  const visible = useMemo(
    () => filterAgents(agents, { status, workspace, query }),
    [agents, status, workspace, query],
  );
  const busy = agents.filter((agent) => agent.openJobs > 0).length;

  const groups: FilterGroup[] = [
    {
      id: "status",
      label: "Show",
      value: status,
      emptyValue: "all",
      onChange: (value) => setStatus(value as AgentStatusFilter),
      options: [
        { value: "all", label: "Everyone" },
        { value: "busy", label: "Busy" },
        { value: "idle", label: "Idle" },
      ],
    },
  ];
  if (workspaces.length > 0) {
    groups.push({
      id: "workspace",
      label: "Workspace",
      value: workspace,
      emptyValue: "all",
      onChange: setWorkspace,
      options: [{ value: "all", label: "All workspaces" }, ...workspaces.map((slug) => ({ value: slug, label: slug }))],
    });
  }

  if (isPending) return <PageLoader variant="page" />;
  if (!data) {
    return (
      <div>
        <h2 className="text-[16px] font-semibold">The roster could not be read.</h2>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
          {error?.message ?? "The data adapter did not answer."}
        </p>
        <PaperButton variant="ghost" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? "Trying again…" : "Try again"}
        </PaperButton>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[14px] text-paper-sage tabular-nums">
        {busy} busy · {agents.length} on the team
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a specialist…"
            aria-label="Find a specialist"
            className={cn(PAPER_INPUT, "w-full pl-8")}
          />
        </label>
        <FilterToolbar groups={groups} />
      </div>

      {visible.length === 0 ? (
        <p className="mt-12 text-[14px] text-paper-sage">Nothing matches.</p>
      ) : (
        <ul className="mt-6 divide-y divide-paper-stone border-y border-paper-mist">
          {visible.map((agent) => (
            <li key={agent.id}>
              <AgentRow agent={agent} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      to={`/agents/${agent.id}`}
      className={cn(
        "grid min-w-0 items-center gap-x-8 gap-y-2 py-3.5 transition-colors duration-150 hover:bg-paper-cream md:grid-cols-[minmax(12rem,1.1fr)_minmax(0,1.6fr)_minmax(11rem,0.9fr)]",
        PAPER_FOCUS,
      )}
    >
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span aria-hidden="true" className="text-[16px] leading-none">
            {agent.avatar}
          </span>
          <span className="truncate text-[16px] leading-6 font-semibold tracking-[-0.01em] text-paper-moss">{agent.name}</span>
        </span>
        <span className="mt-1 block truncate text-[13px] text-paper-sage">{agent.role}</span>
      </span>

      <span className="min-w-0 text-[14px] leading-6 text-paper-char">
        {agent.currentJob ? (
          <>
            <span className="line-clamp-1">{agent.currentJob.objective}</span>
            <span className="mt-0.5 block truncate text-[13px] text-paper-sage">
              {agent.currentJob.project} · {agent.currentJob.status.replace(/_/g, " ")}
            </span>
          </>
        ) : (
          <span className="text-paper-sage">Idle</span>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-2">
        <Tag tone={agent.openJobs > 0 ? "blue" : "muted"}>{agent.openJobs > 0 ? `${agent.openJobs} open` : jobsLabel(agent.spend.jobs)}</Tag>
        {agent.linkedWorkspaces.slice(0, 2).map((slug) => (
          <span key={slug} className="truncate text-[13px] text-paper-sage">
            {slug}
          </span>
        ))}
      </span>
    </Link>
  );
}
