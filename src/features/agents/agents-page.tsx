import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AgentSummary } from "@shared/agent-types";
import { AppShell, DedsecLoader, FilterToolbar, type FilterGroup } from "@/components/os";
import { Meter, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useAgents } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { filterAgents, spendLabel, spendRatio, spendTone, type AgentStatusFilter } from "./agents-model";

/**
 * The team.
 *
 * Who is on it, what each is doing, and what they have spent against their
 * ceiling. Runtime workers (Claude, Grok) stay on Worker jobs; this page is
 * the specialists those jobs are owned by.
 */
export function AgentsPage() {
  const navigationItems = useNavigationItems();
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

  return (
    <AppShell navigationItems={navigationItems} pageId="agents" activeHref="/agents" modelLabel="Model / AgentOS V1">
      <PaperStage full>
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="font-paper-display text-[34px] leading-[1.1] font-extrabold tracking-[-0.015em] text-paper-moss">Agents</h1>
            <p className="mt-1 text-[14px] text-paper-sage tabular-nums">
              {data ? `${busy} busy · ${agents.length} on the team` : "Reading the roster…"}
            </p>
          </div>
        </header>

        {isPending ? (
          <DedsecLoader variant="page" className="mt-10" />
        ) : !data ? (
          <div className="mt-10">
            <h2 className="font-paper-display text-[21px] font-bold">The roster could not be read.</h2>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
              {error?.message ?? "The data adapter did not answer."}
            </p>
            <PaperButton variant="ghost" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <label className="relative min-w-[14rem] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find an agent…"
                  aria-label="Find an agent"
                  className={cn(PAPER_INPUT, "w-full pl-8")}
                />
              </label>
              <FilterToolbar groups={groups} />
            </div>

            {visible.length === 0 ? (
              <p className="mt-12 text-[15px] text-paper-sage">Nothing matches.</p>
            ) : (
              <ul className="mt-6 divide-y divide-paper-stone border-y border-paper-mist">
                {visible.map((agent) => (
                  <li key={agent.id}>
                    <AgentRow agent={agent} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PaperStage>
    </AppShell>
  );
}

function AgentRow({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      to={`/agents/${agent.id}`}
      className={cn(
        "grid min-w-0 items-center gap-x-8 gap-y-2 py-3.5 transition-colors duration-150 hover:bg-paper-cream md:grid-cols-[minmax(12rem,1.1fr)_minmax(0,1.6fr)_minmax(11rem,0.8fr)_minmax(10rem,0.7fr)]",
        PAPER_FOCUS,
      )}
    >
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span aria-hidden="true" className="text-[18px] leading-none">
            {agent.avatar}
          </span>
          <span className="truncate font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">{agent.name}</span>
        </span>
        <span className="mt-1 block truncate text-[12.5px] text-paper-sage">{agent.role}</span>
      </span>

      <span className="min-w-0 text-[14px] leading-6 text-paper-char">
        {agent.currentJob ? (
          <>
            <span className="line-clamp-1">{agent.currentJob.objective}</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-paper-sage">
              {agent.currentJob.project} · {agent.currentJob.status.replace(/_/g, " ")}
            </span>
          </>
        ) : (
          <span className="text-paper-sage">Idle</span>
        )}
      </span>

      <span className="min-w-0">
        <span className="block text-[12.5px] text-paper-sage tabular-nums">{spendLabel(agent.spend)}</span>
        <span className="mt-1.5 block">
          <Meter value={spendRatio(agent.spend)} label={`${agent.name} spend versus ceiling`} tone={spendTone(agent.spend)} />
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-2">
        <Tag tone={agent.openJobs > 0 ? "blue" : "muted"}>{agent.openJobs > 0 ? `${agent.openJobs} open` : "Idle"}</Tag>
        {agent.linkedWorkspaces.slice(0, 2).map((slug) => (
          <span key={slug} className="truncate text-[12px] text-paper-sage">
            {slug}
          </span>
        ))}
      </span>
    </Link>
  );
}
