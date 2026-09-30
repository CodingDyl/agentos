import "@/styles/memory.css";
import { CircleAlert, FilePlus2, FolderTree, Maximize, Minus, Plus, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { VaultStatus } from "@shared/memory-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperIndicator } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import {
  useMemoryFacets,
  useMemoryGraph,
  useMemoryNote,
  useMemoryStatus,
  useMemoryTree,
  useReindexMemory,
} from "@/lib/agentos/memory";
import { cn } from "@/lib/utils";
import { FileTree } from "./file-tree";
import { MemoryGraphCanvas, type MemoryGraphHandle } from "./memory-graph";
import { buildLegend, groupLabel, groupOf, noteColor, OTHER_COLOR, type ColorBy } from "./memory-model";
import { NewNoteDialog } from "./new-note-dialog";
import { NotePreview } from "./note-preview";

/**
 * Memory: the Obsidian vault, as AgentOS reads it.
 *
 * Obsidian stays the editor. Here the vault's folders sit on the left, the way
 * Obsidian shows them, and everything else is the graph. Opening a note — from
 * a node, from the tree, or from a link inside another note — slides it in
 * over the graph, which steps back behind it.
 *
 * The graph is never the only way in: every note is in the tree, and the tree
 * works from the keyboard. Everything that describes the view lives in the
 * URL, so a view can be linked to and survives a reload.
 */

type Scope = "global" | "local";

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
  { value: "random" as const, label: "Random" },
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

export function MemoryPage() {
  const navigationItems = useNavigationItems();
  const [params, setParams] = useSearchParams();

  const noteId = params.get("note") ?? undefined;
  const folder = params.get("folder") ?? "";
  const tag = params.get("tag") ?? "";
  const scope: Scope = params.get("scope") === "local" ? "local" : "global";
  const depth = (["1", "2", "3"].includes(params.get("depth") ?? "") ? params.get("depth") : "1") as "1" | "2" | "3";
  const colorBy: ColorBy = params.get("color") === "tag" ? "tag" : params.get("color") === "folder" ? "folder" : "random";
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
  const [adding, setAdding] = useState(false);

  const status = useMemoryStatus();
  const reindex = useReindexMemory();
  const facets = useMemoryFacets();
  const tree = useMemoryTree(query || undefined);
  // Unfiltered, for the new-note dialog: duplicates and links look at the whole vault.
  const everything = useMemoryTree();
  const note = useMemoryNote(noteId);

  const localFocus = scope === "local" ? noteId : undefined;
  const graph = useMemoryGraph(
    scope === "local"
      ? { focus: localFocus, depth: Number(depth), unresolved: ghosts }
      : { folder: folder || undefined, tag: tag || undefined, q: query || undefined, orphans, unresolved: ghosts },
  );
  const graphData = scope === "local" && !localFocus ? undefined : graph.data;
  const legend = useMemo(() => buildLegend(graphData?.nodes ?? [], colorBy === "random" ? "folder" : colorBy), [graphData?.nodes, colorBy]);

  // The tree's dots and the note's header use the same colour as its node.
  const colorOf = useCallback(
    (id: string) => {
      if (colorBy === "random") return noteColor(id);
      const node = graphData?.nodes.find((entry) => entry.id === id);
      return node ? legend.colors.get(groupOf(node, colorBy)) : undefined;
    },
    [colorBy, graphData?.nodes, legend],
  );

  const graphRef = useRef<MemoryGraphHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const open = useCallback(
    (id: string) => {
      update({ note: id });
      setDrawerOpen(false);
    },
    [update],
  );
  const close = useCallback(() => update({ note: undefined }), [update]);

  // `/` searches; Escape backs out of whatever is on top.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (adding) return;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "n" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setAdding(true);
      } else if (event.key === "Escape" && !typing) {
        if (drawerOpen) setDrawerOpen(false);
        else if (noteId) close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, drawerOpen, noteId, close]);

  const vault = status.data;
  const filtered = Boolean(query || folder || tag);
  const fitKey = `${scope}|${localFocus ?? ""}|${depth}|${folder}|${tag}|${query}|${orphans}|${ghosts}`;
  const tags = facets.data?.tags ?? [];
  // Overlays on the field stay clear of the open note.
  const clearOfPanel = { right: noteId ? "min(560px, 100%)" : "0px" };

  return (
    <AppShell navigationItems={navigationItems} pageId="memory" activeHref="/memory" modelLabel="Model / AgentOS V1">
      <div
        data-still={reducedMotion}
        className="@container/memory flex h-full min-h-0 flex-col bg-paper-white font-paper-ui text-paper-moss"
      >
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
            <kbd
              className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 border border-paper-mist px-1.5 font-mono text-[11px] text-paper-sage sm:block"
              aria-hidden="true"
            >
              /
            </kbd>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <PaperButton
              variant="ghost"
              className="@min-[900px]/memory:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="memory-files"
            >
              <FolderTree className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Files
            </PaperButton>
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

        <div className="relative grid min-h-0 flex-1 @min-[900px]/memory:grid-cols-[280px_minmax(0,1fr)]">
          {/* Left: the vault's folders. A drawer when there is no room. */}
          {drawerOpen ? (
            <button
              type="button"
              aria-label="Close files"
              className="fixed inset-0 z-30 bg-[#04051a]/50 @min-[900px]/memory:hidden"
              onClick={() => setDrawerOpen(false)}
            />
          ) : null}
          <nav
            id="memory-files"
            aria-label="Vault files"
            className={cn(
              "flex min-h-0 flex-col border-r border-paper-mist bg-paper-white",
              "@max-[899px]/memory:fixed @max-[899px]/memory:inset-y-0 @max-[899px]/memory:left-0 @max-[899px]/memory:z-40 @max-[899px]/memory:w-[min(320px,88vw)] @max-[899px]/memory:shadow-[0_12px_40px_rgb(4_5_26/0.35)] @max-[899px]/memory:transition-transform @max-[899px]/memory:duration-300 @max-[899px]/memory:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
              drawerOpen ? "@max-[899px]/memory:translate-x-0" : "@max-[899px]/memory:-translate-x-full @max-[899px]/memory:invisible",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-paper-mist px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <FolderTree className="size-4 shrink-0 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">
                  {vault?.root?.split("/").pop() ?? "Vault"}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-[12px] text-paper-sage tabular-nums">
                  {tree.data ? (query ? `${tree.data.total} of ${tree.data.vaultTotal}` : tree.data.total) : "…"}
                </span>
                <button
                  type="button"
                  className={cn("inline-flex size-8 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-stone @min-[900px]/memory:hidden", PAPER_FOCUS)}
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close files"
                >
                  <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tree.data && tree.data.notes.length === 0 ? (
                <p className="px-4 py-4 text-[13.5px] leading-6 text-paper-sage">{query ? `No notes match “${query}”.` : "The vault has no notes."}</p>
              ) : (
                <FileTree
                  notes={tree.data?.notes ?? []}
                  selectedId={noteId}
                  folderFilter={folder || undefined}
                  searching={Boolean(query)}
                  colorOf={colorOf}
                  onOpen={open}
                  onFilterFolder={(value) => update({ folder: value })}
                />
              )}
              {tree.data && tree.data.omitted > 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-paper-sage">
                  {tree.data.omitted} more notes are not listed. Search to find them.
                </p>
              ) : null}
            </div>

            {/* Adding to the vault, pinned under the tree so it never scrolls away. */}
            <div className="border-t border-paper-mist p-3">
              <PaperButton
                variant="amber"
                className="min-h-10 w-full"
                onClick={() => {
                  setDrawerOpen(false);
                  setAdding(true);
                }}
                disabled={vault?.state !== "connected"}
                aria-keyshortcuts="n"
                title={vault?.state === "connected" ? "Add a note to the vault (N)" : "The vault must be connected to add notes."}
              >
                <FilePlus2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                New note
                <kbd className="ml-auto hidden border border-paper-white/40 px-1.5 font-mono text-[11px] tracking-normal normal-case @min-[900px]/memory:inline" aria-hidden="true">
                  N
                </kbd>
              </PaperButton>
            </div>
          </nav>

          {/* Everything else is the graph. */}
          <section aria-label="Graph" className="relative isolate min-h-[420px] min-w-0 overflow-hidden bg-[#020210]">
            <div
              className="memory-field absolute inset-0"
              data-note-open={Boolean(noteId)}
              style={{ ["--memory-panel-shift" as string]: "min(240px, 22%)" }}
              role="group"
              aria-label={
                graphData
                  ? `Graph showing ${graphData.nodes.length} of ${graphData.totalNotes} notes and ${graphData.edges.length} links. Every note is also in the file tree.`
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
            </div>

            {/* Floating controls, over the field. */}
            <div
              className="pointer-events-none absolute top-0 left-0 z-10 flex flex-wrap items-start gap-2 p-3 transition-[right] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
              style={clearOfPanel}
            >
              <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 bg-[#04051a]/70 p-1.5 backdrop-blur-md">
                <FieldSegment label="Graph scope" options={SCOPES} value={scope} onChange={(value) => update({ scope: value === "global" ? undefined : value })} />
                {scope === "local" ? (
                  <FieldSegment label="Depth" options={DEPTHS} value={depth} onChange={(value) => update({ depth: value === "1" ? undefined : value })} />
                ) : null}
                <FieldSegment label="Colour" options={COLORS} value={colorBy} onChange={(value) => update({ color: value === "random" ? undefined : value })} />
                {tags.length > 0 && scope === "global" ? (
                  <select
                    aria-label="Show notes with tag"
                    value={tag}
                    onChange={(event) => update({ tag: event.target.value || undefined })}
                    className={cn("min-h-7 cursor-pointer border border-white/20 bg-transparent px-2 text-[12.5px] text-[#eef0ff] [&>option]:text-paper-moss", PAPER_FOCUS)}
                  >
                    <option value="">Any tag</option>
                    {tags.slice(0, 60).map((entry) => (
                      <option key={entry.tag} value={entry.tag}>
                        #{entry.tag} ({entry.count})
                      </option>
                    ))}
                  </select>
                ) : null}
                <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden="true" />
                {scope === "global" ? (
                  <FieldToggle pressed={orphans} onClick={() => update({ orphans: orphans ? "0" : undefined })}>Orphans</FieldToggle>
                ) : null}
                <FieldToggle pressed={ghosts} onClick={() => update({ ghosts: ghosts ? undefined : "1" })}>Unresolved</FieldToggle>
                <FieldToggle pressed={arrows} onClick={() => update({ arrows: arrows ? undefined : "1" })}>Arrows</FieldToggle>
                <FieldToggle pressed={reducedMotion} onClick={toggleMotion}>Still</FieldToggle>
              </div>
              <div className="pointer-events-auto ml-auto flex items-center bg-[#04051a]/70 p-1 backdrop-blur-md">
                <FieldIcon label="Zoom out" onClick={() => graphRef.current?.zoomBy(1 / 1.4)}><Minus /></FieldIcon>
                <FieldIcon label="Zoom in" onClick={() => graphRef.current?.zoomBy(1.4)}><Plus /></FieldIcon>
                <FieldIcon label="Fit to view" onClick={() => graphRef.current?.fit()}><Maximize /></FieldIcon>
                <FieldIcon label="Reset layout" onClick={() => graphRef.current?.reset()}><RotateCcw /></FieldIcon>
              </div>
            </div>

            {folder || tag ? (
              <div className="absolute top-[72px] left-3 z-10 flex flex-wrap gap-1.5 @max-[640px]/memory:top-[112px]">
                {folder ? <FilterChip onClear={() => update({ folder: undefined })}>{folder}/</FilterChip> : null}
                {tag ? <FilterChip onClear={() => update({ tag: undefined })}>#{tag}</FilterChip> : null}
              </div>
            ) : null}

            <GraphMessage
              scope={scope}
              hasFocus={Boolean(localFocus)}
              loading={graph.isPending}
              error={graph.error?.message}
              nodes={graphData?.nodes.length ?? 0}
              edges={graphData?.edges.length ?? 0}
              filtered={filtered}
              style={clearOfPanel}
            />

            {graphData && graphData.nodes.length > 0 ? (
              <div
                className="pointer-events-none absolute bottom-0 left-0 z-10 flex flex-wrap items-end justify-between gap-3 p-3 text-[12px] text-[#c9ccf5]"
                style={clearOfPanel}
              >
                {colorBy !== "random" ? (
                  <ul className="pointer-events-auto flex max-w-[70%] flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
                    {legend.entries.map((entry) => (
                      <li key={entry.group} className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: entry.color, boxShadow: `0 0 8px ${entry.color}` }} aria-hidden="true" />
                        {groupLabel(entry.group, colorBy)} <span className="tabular-nums opacity-70">{entry.count}</span>
                      </li>
                    ))}
                    {legend.other > 0 ? (
                      <li className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: OTHER_COLOR }} aria-hidden="true" />
                        Other <span className="tabular-nums opacity-70">{legend.other}</span>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <span />
                )}
                <p className="tabular-nums">
                  {graphData.nodes.filter((node) => !node.unresolved).length} of {graphData.totalNotes} notes ·{" "}
                  {graphData.edges.filter((edge) => !edge.unresolved).length} of {graphData.totalEdges} links
                  {graphData.capped ? ` · largest ${graphData.capped.limit} shown, ${graphData.capped.omitted} hidden — filter to see them` : ""}
                </p>
              </div>
            ) : null}

            {/* The open note, sliding in over the graph. */}
            {noteId ? (
              <NotePreview
                note={note.data}
                isLoading={note.isFetching}
                error={note.error}
                onOpen={open}
                onClose={close}
                closeLabel="Close note"
                accent={colorOf(noteId) ?? noteColor(noteId)}
                className="absolute inset-y-0 right-0 z-20 w-[min(560px,100%)] bg-paper-white shadow-[-24px_0_60px_rgb(2_2_16/0.55)]"
              />
            ) : null}
          </section>
        </div>

        {adding ? (
          <NewNoteDialog
            folders={facets.data?.folders ?? []}
            notes={everything.data?.notes ?? []}
            tags={tags}
            defaultFolder={folder || (noteId?.includes("/") ? noteId.slice(0, noteId.lastIndexOf("/")) : "")}
            onClose={() => setAdding(false)}
            onCreated={(id) => {
              setAdding(false);
              open(id);
            }}
          />
        ) : null}
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

const FIELD_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** A segmented control drawn for the dark field. */
function FieldSegment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex border border-white/15">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-7 cursor-pointer px-2.5 text-[12.5px] font-medium transition-colors duration-150",
              FIELD_FOCUS,
              selected ? "bg-[#eef0ff] text-[#04051a]" : "text-[#c9ccf5] hover:bg-white/10 hover:text-white",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-7 cursor-pointer border px-2.5 text-[12.5px] font-medium transition-colors duration-150",
        FIELD_FOCUS,
        pressed ? "border-[#eef0ff] bg-[#eef0ff] text-[#04051a]" : "border-white/15 text-[#c9ccf5] hover:border-white/40 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function FieldIcon({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 cursor-pointer items-center justify-center text-[#c9ccf5] transition-colors duration-150 hover:bg-white/10 hover:text-white [&>svg]:size-4 [&>svg]:stroke-[1.75]",
        FIELD_FOCUS,
      )}
    >
      {children}
    </button>
  );
}

function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[#eef0ff] py-0.5 pr-0.5 pl-2 text-[12.5px] font-medium text-[#04051a]">
      Only {children}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Stop filtering by ${String(children)}`}
        className={cn("inline-flex size-6 cursor-pointer items-center justify-center hover:bg-[#04051a]/10", PAPER_FOCUS)}
      >
        <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
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
  style,
}: {
  scope: Scope;
  hasFocus: boolean;
  loading: boolean;
  error?: string;
  nodes: number;
  edges: number;
  filtered: boolean;
  style?: CSSProperties;
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
        {nodes} notes, no links between them yet. Link notes in Obsidian with <span className="font-mono">[[Note name]]</span> and the beams
        appear here within a second or two.
      </>
    );
  }

  if (!message) return null;
  return (
    <div className="pointer-events-none absolute bottom-12 left-0 z-10 flex justify-center p-4" style={style}>
      <p role="status" className="max-w-[52ch] border border-white/15 bg-[#04051a]/80 px-4 py-2.5 text-center text-[13.5px] leading-6 text-[#eef0ff] backdrop-blur-md">
        {message}
      </p>
    </div>
  );
}
