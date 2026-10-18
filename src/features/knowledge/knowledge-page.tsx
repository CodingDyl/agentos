import { FileText, GraduationCap, Microscope, Scale, Search } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ArtifactSource, KnowledgeItem } from "@shared/agentos-types";
import { AppShell, DedsecLoader, FilterToolbar, type FilterGroup } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { SOURCE_LABELS } from "@/features/projects/documents-model";
import { formatRelativeTime } from "@/lib/format";
import { useKnowledge } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { filterKnowledge, KNOWLEDGE_TYPE_LABEL, type KnowledgeFilters, type KnowledgeWhen } from "./knowledge-model";

/**
 * Knowledge: everything written down, across every workspace.
 *
 * Plans, research, specs, notes, agent reports, repository docs and the
 * decisions behind them — one list, newest first, filterable by where it
 * lives, what it is, who wrote it and when. Nothing here is a copy: each row
 * opens in its own workspace's viewer, which links back to the task that
 * produced it.
 *
 * A reading surface, so the list is the page. No cards, no counts dressed up
 * as metrics — the filters are the only chrome.
 */

const WHEN = [
  { value: "any" as const, label: "Any time" },
  { value: "7d" as const, label: "7 days" },
  { value: "30d" as const, label: "30 days" },
];

export function KnowledgePage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useKnowledge();

  // Filters live in the URL so a filtered view can be linked to and survives a reload.
  const [params, setParams] = useSearchParams();
  const filters = useMemo<KnowledgeFilters>(
    () => ({
      query: params.get("q") ?? "",
      workspace: params.get("workspace") ?? "all",
      type: params.get("type") ?? "all",
      creator: params.get("creator") ?? "all",
      when: (["7d", "30d"].includes(params.get("when") ?? "") ? params.get("when") : "any") as KnowledgeWhen,
    }),
    [params],
  );

  const setFilter = (key: "q" | "workspace" | "type" | "creator" | "when", value: string, fallback: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === fallback || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => filterKnowledge(items, filters, new Date()), [items, filters]);

  const workspaces = useMemo(
    () => [...new Map(items.map((item) => [item.project, item.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [items],
  );
  const types = useMemo(() => [...new Set(items.map((item) => item.type))], [items]);
  const creators = useMemo(
    () => [...new Set(items.flatMap((item) => (item.source ? [item.source] : [])))] as ArtifactSource[],
    [items],
  );

  const documents = items.filter((item) => item.kind === "document").length;
  const decisions = items.filter((item) => item.kind === "decision").length;
  const learnings = items.filter((item) => item.kind === "learning").length;
  const filtered =
    filters.query !== "" || filters.workspace !== "all" || filters.type !== "all" || filters.creator !== "all" || filters.when !== "any";

  return (
    <AppShell navigationItems={navigationItems} pageId="knowledge" activeHref="/knowledge" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <header>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="font-paper-display text-[34px] leading-[1.1] font-extrabold tracking-[-0.015em] text-paper-moss">Knowledge</h1>
            <Link to="/knowledge/library" className={cn("inline-flex min-h-11 items-center gap-2 border border-paper-mist px-4 text-[13px] font-medium text-paper-moss transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}>
              <Microscope className="size-3.5" aria-hidden="true" />
              Library: take a site apart
            </Link>
          </div>
          <p className="mt-1 text-[14px] text-paper-sage tabular-nums">
            {data
              ? `${documents} ${documents === 1 ? "document" : "documents"} · ${decisions} ${decisions === 1 ? "decision" : "decisions"}${learnings ? ` · ${learnings} ${learnings === 1 ? "learning" : "learnings"}` : ""} · ${workspaces.filter(([slug]) => slug !== "learning").length} workspaces`
              : "Reading every workspace…"}
          </p>
        </header>

        <div className="mt-7 max-w-3xl">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
            <input
              type="search"
              value={filters.query}
              onChange={(event) => setFilter("q", event.target.value, "")}
              placeholder="Search everything…"
              aria-label="Search knowledge"
              className={cn(PAPER_INPUT, "min-h-11 w-full pl-10 text-[15.5px]")}
            />
          </label>
        </div>

        <div className="mt-4">
          <KnowledgeFilterBar
            filters={filters}
            workspaces={workspaces}
            types={types}
            creators={creators}
            onFilter={setFilter}
          />
        </div>

        <div className="mt-8">
          {isPending ? (
            <DedsecLoader variant="page" />
          ) : !data ? (
            <div>
              <h2 className="font-paper-display text-[21px] font-bold">Knowledge could not be read.</h2>
              <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "The data adapter did not answer."}</p>
              <PaperButton variant="ghost" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? "Trying again…" : "Try again"}
              </PaperButton>
            </div>
          ) : items.length === 0 ? (
            <p className="max-w-[60ch] text-[15px] leading-6 text-paper-char">
              Nothing written down yet. Documents appear here as soon as a workspace has a <span className="font-mono text-[13px]">docs/</span> file,
              an agent writes an artifact, or a decision is recorded.
            </p>
          ) : visible.length === 0 ? (
            <p className="text-[15px] text-paper-sage">Nothing matches those filters.</p>
          ) : (
            <>
              <h2 className="mb-2 font-paper-display text-[15px] font-bold">{filtered ? `${visible.length} found` : "Recent"}</h2>
              <ul className="divide-y divide-paper-stone border-y border-paper-mist">
                {visible.map((item) => (
                  <KnowledgeRow key={item.id} item={item} />
                ))}
              </ul>
            </>
          )}

          {data && data.unavailable.length > 0 ? (
            <p className="mt-6 text-[13px] leading-5 text-paper-sage">
              Repository docs could not be read for {data.unavailable.map((entry) => entry.project).join(", ")}.
            </p>
          ) : null}
        </div>
      </PaperStage>
    </AppShell>
  );
}

function KnowledgeFilterBar({
  filters,
  workspaces,
  types,
  creators,
  onFilter,
}: {
  filters: KnowledgeFilters;
  workspaces: [string, string][];
  types: string[];
  creators: ArtifactSource[];
  onFilter: (key: "workspace" | "type" | "creator" | "when", value: string, fallback: string) => void;
}) {
  const groups: FilterGroup[] = [
    {
      id: "workspace",
      label: "Workspace",
      value: filters.workspace,
      emptyValue: "all",
      searchable: true,
      onChange: (value) => onFilter("workspace", value, "all"),
      options: [
        { value: "all", label: "All workspaces" },
        ...workspaces.map(([slug, name]) => ({ value: slug, label: name })),
      ],
    },
    {
      id: "type",
      label: "Type",
      value: filters.type,
      emptyValue: "all",
      onChange: (value) => onFilter("type", value, "all"),
      options: [
        { value: "all", label: "All types" },
        ...types.map((type) => ({ value: type, label: KNOWLEDGE_TYPE_LABEL(type as KnowledgeItem["type"]) })),
      ],
    },
    {
      id: "creator",
      label: "Creator",
      value: filters.creator,
      emptyValue: "all",
      onChange: (value) => onFilter("creator", value, "all"),
      options: [
        { value: "all", label: "Anyone" },
        ...creators.map((source) => ({ value: source, label: SOURCE_LABELS[source] })),
      ],
    },
    {
      id: "when",
      label: "Updated",
      value: filters.when,
      emptyValue: "any",
      onChange: (value) => onFilter("when", value, "any"),
      options: WHEN,
    },
  ];

  return <FilterToolbar groups={groups} />;
}

function KnowledgeRow({ item }: { item: KnowledgeItem }) {
  const Icon = item.kind === "decision" ? Scale : item.kind === "learning" ? GraduationCap : FileText;

  return (
    <li>
      <Link
        to={item.href}
        className={cn("group flex items-start gap-3.5 px-2 py-3.5 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}
      >
        <Icon className="mt-1 size-4 shrink-0 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-[15.5px] leading-6 font-medium text-paper-moss group-hover:text-paper-blue">{item.title}</span>
            {item.origin === "repo" ? <Tag tone="muted">Repo</Tag> : null}
          </span>
          {item.kind === "decision" && item.detail ? (
            <span className="mt-0.5 line-clamp-1 block max-w-[80ch] text-[13.5px] leading-5 text-paper-char">{item.detail}</span>
          ) : null}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-paper-sage">
            <span className="font-medium text-paper-char">{item.projectName}</span>
            <span aria-hidden="true">·</span>
            <span>{KNOWLEDGE_TYPE_LABEL(item.type)}</span>
            {item.source ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{SOURCE_LABELS[item.source]}</span>
              </>
            ) : null}
            {item.taskId ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[12px]">{item.taskId}</span>
              </>
            ) : null}
            {item.updatedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatRelativeTime(item.updatedAt)}</span>
              </>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
