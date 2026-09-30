import {
  ArrowDownUp,
  CircleAlert,
  Folder,
  Hash,
  ListFilter,
  Maximize,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { MemoryNoteSummary, VaultStatus } from "@shared/memory-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperIndicator, SegmentedControl } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import {
  useMemoryFacets,
  useMemoryGraph,
  useMemoryNote,
  useMemoryNotes,
  useMemoryStatus,
  useReindexMemory,
} from "@/lib/agentos/memory";
import { cn } from "@/lib/utils";
import { MemoryGraphCanvas, type MemoryGraphHandle } from "./memory-graph";
import { buildLegend, groupLabel, OTHER_COLOR, type ColorBy } from "./memory-model";
import { NotePreview } from "./note-preview";

/**
 * Memory: the Obsidian vault, as AgentOS reads it.
 *
 * Obsidian stays the editor. This screen is for finding and following: search
 * and filters on the left, the graph (or a plain list) in the middle, and the
 * open note on the right with everything that links in and out of it. The
 * graph is never the only way in — every note is in the list, and the list
 * works from the keyboard.
 *
 * Everything that describes the view lives in the URL, so a view can be linked
 * to and survives a reload.
 */

type View = "graph" | "notes";
type Scope = "global" | "local";

const VIEWS = [
  { value: "graph" as const, label: "Graph" },
  { value: "notes" as const, label: "Notes" },
];
const SCOPES = [
  { value: "global" as const, label: "Whole vault" },
  { value: "local" as const, label: "Around note" },
];
const DEPTHS = [
  { value: "1" as const, label: "1 hop" },
  { value: "2" as const, label: "2" },
  { value: "3" as const, label: "3" },
];
const COLORS = [
  { value: "folder" as const, label: "Folder" },
  { value: "tag" as const, label: "Tag" },
];

const MOTION_KEY = "agentos.memory.reduceMotion";

function readReducedMotion(): boolean {
  try {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Storage unavailable: fall back to the system setting.
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Arrow keys move between rows marked `data-note-row` inside the list. */
function onListKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-note-row]")];
  if (rows.length === 0) return;
  event.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
  rows[next]?.focus();
}

export function MemoryPage() {
  const navigationItems = useNavigationItems();
  const [params, setParams] = useSearchParams();

  const view: View = params.get("view") === "notes" ? "notes" : "graph";
  const noteId = params.get("note") ?? undefined;
  const folder = params.get("folder") ?? "";
  const tag = params.get("tag") ?? "";
  const scope: Scope = params.get("scope") === "local" ? "local" : "global";
  const depth = (["1", "2", "3"].includes(params.get("depth") ?? "") ? params.get("depth") : "1") as "1" | "2" | "3";
  const colorBy: ColorBy = params.get("color") === "tag" ? "tag" : "folder";
  const orphans = params.get("orphans") !== "0";
  const ghosts = params.get("ghosts") === "1";
  const arrows = params.get("arrows") === "1";

  const update = useCallback(
    (changes: Record<string, string | undefined>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === "") next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // The search box is local state so typing stays instant; the URL follows.
  const [search, setSearch] = useState(params.get("q") ?? "");
  const query = useDebounced(search.trim(), 200);
  useEffect(() => {
    if ((params.get("q") ?? "") !== query) update({ q: query || undefined });
  }, [query, params, update]);

  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);
  const toggleMotion = () =>
    setReducedMotion((value) => {
      try {
        localStorage.setItem(MOTION_KEY, value ? "0" : "1");
      } catch {
        // Only a preference; the toggle still works for this visit.
      }
      return !value;
    });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [listLimit, setListLimit] = useState(200);
  const [sort, setSort] = useState<"title" | "modified" | "links">("title");

  const status = useMemoryStatus();
  const reindex = useReindexMemory();
  const facets = useMemoryFacets();
  const notes = useMemoryNotes({ q: query || undefined, folder: folder || undefined, tag: tag || undefined, sort, limit: listLimit });
  const note = useMemoryNote(noteId);

  const localFocus = scope === "local" ? noteId : undefined;
  const graph = useMemoryGraph(
    scope === "local"
      ? { focus: localFocus, depth: Number(depth), unresolved: ghosts }
      : { folder: folder || undefined, tag: tag || undefined, q: query || undefined, orphans, unresolved: ghosts },
  );
  const graphData = scope === "local" && !localFocus ? undefined : graph.data;
  const legend = useMemo(() => buildLegend(graphData?.nodes ?? [], colorBy), [graphData?.nodes, colorBy]);

  const graphRef = useRef<MemoryGraphHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const open = useCallback((id: string) => {
    update({ note: id });
    setDrawerOpen(false);
  }, [update]);
  const close = useCallback(() => update({ note: undefined }), [update]);

  // `/` searches; Escape backs out of whatever is on top.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        if (drawerOpen) setDrawerOpen(false);
        else if (!typing && noteId && (rootRef.current?.clientWidth ?? 0) < 760) close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, noteId, close]);

  const vault = status.data;
  const filtered = Boolean(query || folder || tag);
  const fitKey = `${scope}|${localFocus ?? ""}|${depth}|${folder}|${tag}|${query}|${orphans}|${ghosts}`;

  return (
    <AppShell navigationItems={navigationItems} pageId="memory" activeHref="/memory" modelLabel="Model / AgentOS V1">
      <div ref={rootRef} className="@container/memory flex h-full min-h-0 flex-col bg-paper-white font-paper-ui text-paper-moss">
        {/* Toolbar */}
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-paper-mist px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 data-heading="compact" className="font-paper-display text-[26px] leading-none font-extrabold tracking-[-0.015em] text-paper-moss">
              Memory
            </h1>
            <p className="hidden text-[13px] text-paper-sage tabular-nums sm:block">
              {vault ? `${vault.notes} notes · ${vault.links} links${vault.unresolved ? ` · ${vault.unresolved} unresolved` : ""}` : "Reading the vault…"}
            </p>
          </div>

          <VaultIndicator status={vault} failed={Boolean(status.error)} />

          <label className="relative order-last w-full sm:order-none sm:w-auto sm:min-w-[260px] sm:flex-1 lg:max-w-[440px]">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles, headings, tags, text…"
              aria-label="Search notes"
              aria-keyshortcuts="/"
              className={cn(PAPER_INPUT, "min-h-9 w-full pr-9 pl-9 text-[14px]")}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 border border-paper-mist px-1.5 font-mono text-[11px] text-paper-sage sm:block" aria-hidden="true">
              /
            </kbd>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <PaperButton variant="ghost" className="@min-[1180px]/memory:hidden" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} aria-controls="memory-sidebar">
              <ListFilter className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Notes
            </PaperButton>
            <SegmentedControl label="View" options={VIEWS} value={view} onChange={(value) => update({ view: value === "graph" ? undefined : value })} />
            <PaperButton
              variant="quiet"
              onClick={() => reindex.mutate()}
              disabled={reindex.isPending}
              title="Re-read the vault now. Edits are normally picked up on their own within a second or two."
            >
              <RefreshCw className={cn("size-4", reindex.isPending && "motion-safe:animate-spin")} strokeWidth={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">{reindex.isPending ? "Reindexing" : "Reindex"}</span>
            </PaperButton>
          </div>
        </header>

        {vault && (vault.state === "unavailable" || vault.state === "unconfigured") ? (
          <div role="alert" className="flex items-start gap-3 border-b border-paper-flame-deep bg-paper-cream px-4 py-3 text-[13.5px] leading-6 text-paper-char sm:px-6">
            <CircleAlert className="mt-1 size-4 shrink-0 text-paper-flame-deep" strokeWidth={2} aria-hidden="true" />
            <p className="max-w-[110ch]">
              <strong className="font-semibold text-paper-moss">{vault.reason ?? "The vault is not available."}</strong>{" "}
              {vault.notes > 0
                ? `What you see is the last index${vault.lastIndexedAt ? ` from ${formatRelativeTime(vault.lastIndexedAt)}` : ""}, marked stale. New jobs get no vault memory until it is back. `
                : "Nothing has been indexed yet. "}
              AgentOS checks every few seconds and re-indexes as soon as the drive returns — it never creates a replacement folder.
            </p>
          </div>
        ) : null}
        {reindex.error ? (
          <p role="alert" className="border-b border-paper-flame-deep px-4 py-2 text-[13px] text-paper-flame-deep sm:px-6">
            Reindex failed: {reindex.error.message}
          </p>
        ) : null}

        <div className="relative grid min-h-0 flex-1 @min-[760px]/memory:grid-cols-[minmax(0,1fr)_minmax(320px,42%)] @min-[1180px]/memory:grid-cols-[264px_minmax(0,1fr)_minmax(340px,30%)]">
          {/* Left: filters and the note list. A drawer below lg. */}
          {drawerOpen ? (
            <button type="button" aria-label="Close notes" className="fixed inset-0 z-30 bg-paper-moss/30 @min-[1180px]/memory:hidden" onClick={() => setDrawerOpen(false)} />
          ) : null}
          <nav
            id="memory-sidebar"
            aria-label="Filters and notes"
            className={cn(
              "flex min-h-0 flex-col border-r border-paper-mist bg-paper-white",
              "@max-[1179px]/memory:fixed @max-[1179px]/memory:inset-y-0 @max-[1179px]/memory:left-0 @max-[1179px]/memory:z-40 @max-[1179px]/memory:w-[min(320px,88vw)] @max-[1179px]/memory:shadow-[0_12px_40px_rgba(0,0,145,0.25)] @max-[1179px]/memory:transition-transform @max-[1179px]/memory:duration-200 @max-[1179px]/memory:ease-out motion-reduce:transition-none",
              drawerOpen ? "@max-[1179px]/memory:translate-x-0" : "@max-[1179px]/memory:-translate-x-full @max-[1179px]/memory:invisible",
            )}
          >
            <div className="flex items-center justify-between border-b border-paper-mist px-4 py-2.5 @min-[1180px]/memory:hidden">
              <span className="font-paper-display text-[16px] font-bold">Notes</span>
              <PaperButton variant="quiet" className="px-2" onClick={() => setDrawerOpen(false)} aria-label="Close notes">
                <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </PaperButton>
            </div>

            <div className="max-h-[42%] shrink-0 overflow-y-auto border-b border-paper-mist px-2 py-3">
              <FilterHeading icon={<Folder className="size-3.5" strokeWidth={2} aria-hidden="true" />}>Folders</FilterHeading>
              <ul>
                <li>
                  <FilterRow active={!folder} onClick={() => update({ folder: undefined })} label="All notes" count={vault?.notes} depth={0} />
                </li>
                {facets.data?.folders.map((entry) => (
                  <li key={entry.folder}>
                    <FilterRow
                      active={folder === entry.folder}
                      onClick={() => update({ folder: folder === entry.folder ? undefined : entry.folder })}
                      label={entry.folder.split("/").pop() ?? entry.folder}
                      title={entry.folder}
                      count={entry.count}
                      depth={entry.folder.split("/").length - 1}
                    />
                  </li>
                ))}
              </ul>

              <FilterHeading icon={<Hash className="size-3.5" strokeWidth={2} aria-hidden="true" />} className="mt-4">Tags</FilterHeading>
              {facets.data && facets.data.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 px-2 pt-1">
                  {facets.data.tags.slice(0, 40).map((entry) => (
                    <button
                      key={entry.tag}
                      type="button"
                      aria-pressed={tag === entry.tag}
                      onClick={() => update({ tag: tag === entry.tag ? undefined : entry.tag })}
                      className={cn(
                        "cursor-pointer border px-2 py-0.5 text-[12.5px] transition-colors duration-150",
                        PAPER_FOCUS,
                        tag === entry.tag ? "border-paper-blue bg-paper-blue text-paper-white" : "border-paper-mist text-paper-char hover:border-paper-blue",
                      )}
                    >
                      #{entry.tag} <span className="tabular-nums opacity-75">{entry.count}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-2 pt-1 text-[12.5px] leading-5 text-paper-sage">No tags yet. Add <span className="font-mono">#tag</span> or front-matter tags in Obsidian.</p>
              )}
            </div>

            <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
              <span className="font-paper-utility text-[12px] font-semibold tracking-[0.1em] text-paper-char uppercase">Notes</span>
              <span className="text-[12px] text-paper-sage tabular-nums">
                {notes.data ? (filtered ? `${notes.data.total} of ${notes.data.vaultTotal}` : notes.data.total) : "…"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeyDown}>
              {notes.data && notes.data.notes.length === 0 ? (
                <p className="px-4 py-2 text-[13.5px] text-paper-sage">{filtered ? "No notes match." : "The vault has no notes."}</p>
              ) : (
                <ul aria-label="Notes">
                  {notes.data?.notes.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        data-note-row
                        aria-current={entry.id === noteId ? "true" : undefined}
                        onClick={() => open(entry.id)}
                        className={cn(
                          "block w-full cursor-pointer border-l-2 px-4 py-1.5 text-left transition-colors duration-100",
                          PAPER_FOCUS,
                          "focus-visible:outline-offset-[-2px]",
                          entry.id === noteId ? "border-paper-blue bg-paper-linen" : "border-transparent hover:bg-paper-cream",
                        )}
                      >
                        <span className="block truncate text-[13.5px] font-medium text-paper-moss">{entry.title}</span>
                        <span className="block truncate font-mono text-[11px] text-paper-sage">{entry.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {notes.data && notes.data.total > notes.data.notes.length ? (
                <PaperButton variant="quiet" className="mx-3 mt-2" onClick={() => setListLimit((limit) => limit + 200)}>
                  Show more
                </PaperButton>
              ) : null}
            </div>
          </nav>

          {/* Centre: the graph or the list. */}
          <section aria-label={view === "graph" ? "Graph" : "Notes"} className="flex min-h-0 min-w-0 flex-col">
            {view === "graph" ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-paper-mist px-3 py-2">
                  <SegmentedControl label="Graph scope" options={SCOPES} value={scope} onChange={(value) => update({ scope: value === "global" ? undefined : value })} />
                  {scope === "local" ? (
                    <SegmentedControl label="Depth" options={DEPTHS} value={depth} onChange={(value) => update({ depth: value === "1" ? undefined : value })} />
                  ) : null}
                  <SegmentedControl label="Colour by" options={COLORS} value={colorBy} onChange={(value) => update({ color: value === "folder" ? undefined : value })} />
                  <div className="flex flex-wrap items-center gap-1">
                    {scope === "global" ? <Toggle pressed={orphans} onClick={() => update({ orphans: orphans ? "0" : undefined })}>Orphans</Toggle> : null}
                    <Toggle pressed={ghosts} onClick={() => update({ ghosts: ghosts ? undefined : "1" })}>Unresolved</Toggle>
                    <Toggle pressed={arrows} onClick={() => update({ arrows: arrows ? undefined : "1" })}>Arrows</Toggle>
                    <Toggle pressed={reducedMotion} onClick={toggleMotion}>Still</Toggle>
                  </div>
                  <div className="ml-auto flex items-center">
                    <IconButton label="Zoom out" onClick={() => graphRef.current?.zoomBy(1 / 1.4)}><Minus /></IconButton>
                    <IconButton label="Zoom in" onClick={() => graphRef.current?.zoomBy(1.4)}><Plus /></IconButton>
                    <IconButton label="Fit to view" onClick={() => graphRef.current?.fit()}><Maximize /></IconButton>
                    <IconButton label="Reset layout" onClick={() => graphRef.current?.reset()}><RotateCcw /></IconButton>
                  </div>
                </div>

                <div
                  className="relative min-h-[360px] flex-1 overflow-hidden bg-paper-blue"
                  role="group"
                  aria-label={
                    graphData
                      ? `Graph showing ${graphData.nodes.length} of ${graphData.totalNotes} notes and ${graphData.edges.length} links. Every note is also in the notes list.`
                      : "Graph"
                  }
                >
                  {graphData ? (
                    <MemoryGraphCanvas
                      ref={graphRef}
                      graph={graphData}
                      selectedId={noteId}
                      colorBy={colorBy}
                      legend={legend}
                      arrows={arrows}
                      reducedMotion={reducedMotion}
                      fitKey={fitKey}
                      onSelect={open}
                    />
                  ) : null}

                  <GraphMessage
                    scope={scope}
                    hasFocus={Boolean(localFocus)}
                    loading={graph.isPending}
                    error={graph.error?.message}
                    nodes={graphData?.nodes.length ?? 0}
                    edges={graphData?.edges.length ?? 0}
                    filtered={filtered}
                  />

                  {graphData && graphData.nodes.length > 0 ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-3 text-[12px] text-paper-white">
                      <ul className="pointer-events-auto flex max-w-[70%] flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
                        {legend.entries.map((entry) => (
                          <li key={entry.group} className="flex items-center gap-1.5">
                            <span className="size-2.5 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
                            {groupLabel(entry.group, colorBy)} <span className="tabular-nums opacity-70">{entry.count}</span>
                          </li>
                        ))}
                        {legend.other > 0 ? (
                          <li className="flex items-center gap-1.5">
                            <span className="size-2.5 rounded-full" style={{ background: OTHER_COLOR }} aria-hidden="true" />
                            Other <span className="tabular-nums opacity-70">{legend.other}</span>
                          </li>
                        ) : null}
                        {ghosts ? (
                          <li className="flex items-center gap-1.5">
                            <span className="size-2.5 rounded-full border border-dashed border-paper-white" aria-hidden="true" />
                            Unresolved
                          </li>
                        ) : null}
                      </ul>
                      <p className="tabular-nums">
                        {graphData.nodes.filter((node) => !node.unresolved).length} of {graphData.totalNotes} notes · {graphData.edges.filter((edge) => !edge.unresolved).length} of {graphData.totalEdges} links
                        {graphData.capped ? ` · largest ${graphData.capped.limit} shown, ${graphData.capped.omitted} hidden — filter to see them` : ""}
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <NotesTable
                notes={notes.data?.notes ?? []}
                total={notes.data?.total ?? 0}
                vaultTotal={notes.data?.vaultTotal ?? 0}
                filtered={filtered}
                selectedId={noteId}
                sort={sort}
                onSort={setSort}
                onOpen={open}
                onMore={notes.data && notes.data.total > notes.data.notes.length ? () => setListLimit((limit) => limit + 200) : undefined}
              />
            )}
          </section>

          {/* Right: the open note. Stacks over the centre below lg. */}
          <NotePreview
            note={noteId ? note.data : undefined}
            isLoading={Boolean(noteId) && note.isFetching}
            error={noteId ? note.error : null}
            onOpen={open}
            onClose={noteId ? close : undefined}
            closeLabel="Close note"
            className={cn(
              "min-h-0 border-l border-paper-mist bg-paper-white",
              noteId ? "@max-[759px]/memory:absolute @max-[759px]/memory:inset-0 @max-[759px]/memory:z-20 @max-[759px]/memory:border-l-0" : "@max-[759px]/memory:hidden",
            )}
          />
        </div>
      </div>
    </AppShell>
  );
}

function VaultIndicator({ status, failed }: { status?: VaultStatus; failed: boolean }) {
  if (failed && !status) return <PaperIndicator tone="flame" label="Adapter not responding" />;
  if (!status) return <PaperIndicator tone="muted" label="Checking vault" />;

  const detail = status.root?.split("/").slice(-2).join("/");
  switch (status.state) {
    case "connected":
      return <PaperIndicator tone="green" label="Vault connected" detail={detail} className="max-md:[&>span:last-child]:hidden" />;
    case "indexing":
      return <PaperIndicator tone="amber" label="Indexing" detail={detail} />;
    case "unconfigured":
      return <PaperIndicator tone="flame" label="Vault not configured" />;
    default:
      return <PaperIndicator tone="flame" label={status.stale && status.notes > 0 ? "Vault unavailable · stale" : "Vault unavailable"} />;
  }
}

function FilterHeading({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("flex items-center gap-1.5 px-2 pb-1 font-paper-utility text-[12px] font-semibold tracking-[0.1em] text-paper-char uppercase", className)}>
      {icon}
      {children}
    </h2>
  );
}

function FilterRow({ active, onClick, label, title, count, depth }: { active: boolean; onClick: () => void; label: string; title?: string; count?: number; depth: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-2 py-1 pr-2 text-left text-[13.5px] transition-colors duration-100",
        PAPER_FOCUS,
        active ? "bg-paper-blue text-paper-white" : "text-paper-moss hover:bg-paper-linen",
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined ? <span className={cn("text-[12px] tabular-nums", active ? "text-paper-white" : "text-paper-sage")}>{count}</span> : null}
    </button>
  );
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-7 cursor-pointer border px-2.5 text-[12.5px] font-medium transition-colors duration-150",
        PAPER_FOCUS,
        pressed ? "border-paper-blue bg-paper-blue text-paper-white" : "border-paper-mist text-paper-sage hover:border-paper-blue hover:text-paper-moss",
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("inline-flex size-8 cursor-pointer items-center justify-center text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss [&>svg]:size-4 [&>svg]:stroke-[1.75]", PAPER_FOCUS)}
    >
      {children}
    </button>
  );
}

function GraphMessage({
  scope,
  hasFocus,
  loading,
  error,
  nodes,
  edges,
  filtered,
}: {
  scope: Scope;
  hasFocus: boolean;
  loading: boolean;
  error?: string;
  nodes: number;
  edges: number;
  filtered: boolean;
}) {
  let message: ReactNode = null;
  if (scope === "local" && !hasFocus) {
    message = "Open a note to see the notes around it.";
  } else if (error) {
    message = `The graph could not be built: ${error}`;
  } else if (loading) {
    message = "Drawing the graph…";
  } else if (nodes === 0) {
    message = filtered ? "No notes match these filters." : "The vault has no notes to draw.";
  } else if (edges === 0 && scope === "global" && !filtered) {
    message = (
      <>
        {nodes} notes, no links between them yet. Link notes in Obsidian with <span className="font-mono">[[Note name]]</span> and they connect here
        within a second or two.
      </>
    );
  }

  if (!message) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
      <p role="status" className="max-w-[52ch] bg-paper-white px-4 py-2.5 text-center text-[13.5px] leading-6 text-paper-moss">
        {message}
      </p>
    </div>
  );
}

function NotesTable({
  notes,
  total,
  vaultTotal,
  filtered,
  selectedId,
  sort,
  onSort,
  onOpen,
  onMore,
}: {
  notes: MemoryNoteSummary[];
  total: number;
  vaultTotal: number;
  filtered: boolean;
  selectedId?: string;
  sort: "title" | "modified" | "links";
  onSort: (sort: "title" | "modified" | "links") => void;
  onOpen: (id: string) => void;
  onMore?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-paper-mist px-4 py-2">
        <p className="text-[13px] text-paper-sage tabular-nums">{filtered ? `${total} of ${vaultTotal} notes` : `${total} notes`}</p>
        <label className="flex items-center gap-2 text-[13px] text-paper-sage">
          <ArrowDownUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select value={sort} onChange={(event) => onSort(event.target.value as typeof sort)} className={cn(PAPER_INPUT, "min-h-8 cursor-pointer py-0 text-[13px]")}>
            <option value="title">Title</option>
            <option value="modified">Recently edited</option>
            <option value="links">Most connected</option>
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onListKeyDown}>
        {notes.length === 0 ? (
          <p className="px-4 py-6 text-[14px] text-paper-sage">{filtered ? "No notes match." : "The vault has no notes."}</p>
        ) : (
          <ul className="divide-y divide-paper-stone" aria-label="All notes">
            {notes.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  data-note-row
                  aria-current={entry.id === selectedId ? "true" : undefined}
                  onClick={() => onOpen(entry.id)}
                  className={cn(
                    "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors duration-100 md:grid-cols-[minmax(0,1fr)_minmax(0,180px)_92px_110px]",
                    PAPER_FOCUS,
                    "focus-visible:outline-offset-[-2px]",
                    entry.id === selectedId ? "bg-paper-linen" : "hover:bg-paper-cream",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-paper-moss">
                      {entry.title}
                      {entry.hasErrors ? <CircleAlert className="ml-1.5 inline size-3.5 text-paper-flame-deep" strokeWidth={2} aria-label="Has a parse problem" /> : null}
                    </span>
                    <span className="block truncate font-mono text-[11.5px] text-paper-sage">{entry.id}</span>
                  </span>
                  <span className="hidden truncate text-[12.5px] text-paper-char md:block">{entry.tags.map((tag) => `#${tag}`).join(" ") || "—"}</span>
                  <span className="hidden text-[12.5px] text-paper-char tabular-nums md:block" title="Backlinks · outgoing links">
                    ← {entry.backlinkCount} · → {entry.outgoingCount}
                  </span>
                  <span className="text-right text-[12.5px] text-paper-sage tabular-nums">{formatRelativeTime(entry.modifiedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {onMore ? (
          <PaperButton variant="quiet" className="m-3" onClick={onMore}>
            Show more
          </PaperButton>
        ) : null}
      </div>
    </div>
  );
}
