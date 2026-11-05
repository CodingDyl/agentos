import { ArrowLeft, ChevronRight, Maximize, RotateCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  StructureGraph,
  StructureNodeSummary,
  StructureRebuild,
  StructureState,
  StructureSubsystem,
} from "@shared/structure-types";
import { PageLoader } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperEmpty, PaperError, PaperNotice, Tag } from "@/components/paper";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StructureCanvas, type CanvasLink, type CanvasNode, type StructureCanvasHandle } from "./structure-canvas";
import { areaPalette, formatCount, groupConnections, placeOf, plural, radiusFor } from "./structure-model";
import { useRebuildStructure, useStructure, useStructureNode, useStructureSearch, useStructureSubsystem } from "./use-structure";

const INSTALL_COMMAND = "pipx install graphifyy";
const LIST_LIMIT = 60;

/**
 * A workspace's components and how they interact, from the Graphify map in its
 * repository. The map answers "what are the big parts and who talks to whom";
 * opening a subsystem answers "what is inside"; choosing a component answers
 * "what touches this, exactly, and where".
 *
 * Rebuilding only parses code on this machine. Reading documents with a model
 * stays a deliberate `/graphify` run, so this tab can never send client work
 * anywhere.
 */
export function StructureTab({ slug }: { slug: string }) {
  const query = useStructure(slug);
  const rebuild = useRebuildStructure(slug);

  if (query.isPending) return <PageLoader variant="compact" />;

  if (query.isError) {
    return (
      <PaperError
        headingLevel="h2"
        title="The project structure could not be read."
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }

  const state = query.data;
  const startRebuild = (force = false) => rebuild.mutate(force);
  const failure = rebuild.error?.message;

  if (state.status === "ready" && state.graph) {
    return (
      <div className="flex flex-col gap-4">
        {state.graph.counts.components === 0 ? (
          <PaperEmpty title="Graphify found nothing to map." description="This repository has no code Graphify can read yet. Rebuild once there is some." />
        ) : (
          <StructureExplorer key={state.graph.builtAt} slug={slug} graph={state.graph} rebuild={state.rebuild} cliInstalled={state.cliInstalled} onRebuild={startRebuild} failure={failure} />
        )}
      </div>
    );
  }

  return <StructurePlaceholder state={state} onRebuild={startRebuild} failure={failure} />;
}

function StructurePlaceholder({ state, onRebuild, failure }: { state: StructureState; onRebuild: (force?: boolean) => void; failure?: string }) {
  if (state.status === "no-repository" || state.status === "missing-folder") {
    return <PaperEmpty title="There is no repository to map." description={state.problem} />;
  }

  if (state.status === "unsupported") {
    return <PaperError headingLevel="h2" title="This map was written in a newer format." detail={state.problem} />;
  }

  const running = state.rebuild.status === "running";

  return (
    <div className="flex flex-col gap-3">
      {state.status === "unreadable" ? <PaperError headingLevel="h2" title="This map could not be read." detail={state.problem} /> : null}
      <PaperEmpty
        title={running ? "Mapping this repository…" : "This repository has not been mapped yet."}
        description={
          state.cliInstalled ? (
            <>
              Graphify parses the code in <code className="font-mono text-[12px]">{state.folder}</code> on this machine and works out its subsystems and how they connect. No AI model is involved, and the
              result stays out of your commits. A large project takes under a minute.
            </>
          ) : (
            <>
              Mapping needs the Graphify command, which is not installed on this machine. Install it with <code className="font-mono text-[12px]">{INSTALL_COMMAND}</code>, then come back here.
            </>
          )
        }
        action={
          state.cliInstalled ? (
            <PaperButton variant="amber" disabled={running} onClick={() => onRebuild()}>
              <RotateCw className={cn("size-3.5", running && "animate-spin motion-reduce:animate-none")} strokeWidth={2} aria-hidden="true" />
              {running ? "Mapping…" : "Map this repository"}
            </PaperButton>
          ) : undefined
        }
      />
      <RebuildProblem rebuild={state.rebuild} failure={failure} onRebuild={onRebuild} />
    </div>
  );
}

function RebuildProblem({ rebuild, failure, onRebuild }: { rebuild: StructureRebuild; failure?: string; onRebuild: (force?: boolean) => void }) {
  const message = rebuild.status === "failed" ? rebuild.error : failure;
  if (!message) return null;

  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-paper-mist bg-paper-cream px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-paper-flame">The rebuild did not finish.</p>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-5 break-words whitespace-pre-wrap text-paper-char">{message}</p>
      </div>
      {rebuild.canForce ? <PaperButton onClick={() => onRebuild(true)}>Replace the map anyway</PaperButton> : null}
    </div>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return reduced;
}

function StructureExplorer({
  slug,
  graph,
  rebuild,
  cliInstalled,
  onRebuild,
  failure,
}: {
  slug: string;
  graph: StructureGraph;
  rebuild: StructureRebuild;
  cliInstalled: boolean;
  onRebuild: (force?: boolean) => void;
  failure?: string;
}) {
  const canvas = useRef<StructureCanvasHandle>(null);
  const reducedMotion = useReducedMotion();

  /** The subsystem drawn on the canvas; undefined is the whole-project map. */
  const [openId, setOpenId] = useState<number>();
  /** Selected on the map, or the subsystem being read. */
  const [subsystemId, setSubsystemId] = useState<number>();
  const [nodeId, setNodeId] = useState<string>();

  const palette = useMemo(() => areaPalette(graph.subsystems), [graph.subsystems]);
  const byId = useMemo(() => new Map(graph.subsystems.map((entry) => [entry.id, entry])), [graph.subsystems]);

  const opened = useStructureSubsystem(slug, openId, graph.builtAt);
  const reading = useStructureSubsystem(slug, subsystemId, graph.builtAt);
  const node = useStructureNode(slug, nodeId, graph.builtAt);

  const mapNodes = useMemo<CanvasNode[]>(() => {
    const onMap = graph.subsystems.filter((entry) => entry.onMap);
    const largest = onMap.reduce((max, entry) => Math.max(max, entry.size), 1);
    return onMap.map((entry) => ({ id: String(entry.id), label: entry.name, radius: radiusFor(entry.size, largest), color: palette.colorOf(entry.area) }));
  }, [graph.subsystems, palette]);

  const mapLinks = useMemo<CanvasLink[]>(() => graph.links.map((link) => ({ source: String(link.source), target: String(link.target), weight: link.weight })), [graph.links]);

  const openedNodes = useMemo<CanvasNode[]>(() => {
    if (!opened.data) return [];
    const largest = opened.data.members.reduce((max, member) => Math.max(max, member.degree), 1);
    const color = palette.colorOf(opened.data.subsystem.area);
    return opened.data.members.map((member) => ({
      id: member.id,
      label: member.label,
      radius: radiusFor(member.degree, largest),
      color: member.external ? "#65717D" : color,
    }));
  }, [opened.data, palette]);

  const openedLinks = useMemo<CanvasLink[]>(
    () => (opened.data ? opened.data.links.map((link) => ({ source: link.source, target: link.target, weight: 1, inferred: link.inferred })) : []),
    [opened.data],
  );

  const inside = openId !== undefined;
  const openSubsystem = (id: number) => {
    setOpenId(id);
    setSubsystemId(id);
    setNodeId(undefined);
  };
  const backToMap = () => {
    setSubsystemId(openId);
    setOpenId(undefined);
    setNodeId(undefined);
  };
  const showNode = (target: StructureNodeSummary) => {
    setOpenId(target.subsystem);
    setSubsystemId(target.subsystem);
    setNodeId(target.id);
  };
  const clearSelection = () => {
    if (nodeId) setNodeId(undefined);
    else if (!inside) setSubsystemId(undefined);
  };

  const openName = openId === undefined ? undefined : byId.get(openId)?.name;
  const running = rebuild.status === "running";
  const hidden = opened.data ? opened.data.subsystem.size - opened.data.members.length : 0;

  return (
    <section
      aria-label="Project structure"
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && (event.target as HTMLElement).tagName !== "INPUT") clearSelection();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Where you are" className="flex min-h-6 items-center gap-1.5 text-[16px] font-semibold text-paper-moss">
            {inside ? (
              <>
                <button type="button" onClick={backToMap} className={cn("cursor-pointer rounded-sm text-paper-sage transition-colors duration-150 hover:text-paper-moss", PAPER_FOCUS)}>
                  All subsystems
                </button>
                <ChevronRight className="size-4 shrink-0 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
                <span className="truncate" aria-current="page">
                  {openName}
                </span>
              </>
            ) : (
              <span aria-current="page">All subsystems</span>
            )}
          </nav>
          <p className="mt-0.5 text-[13px] leading-5 text-paper-sage">
            <span className="tabular-nums">
              {plural(graph.counts.components, "component")} · {plural(graph.counts.links, "link")} · {plural(graph.counts.subsystems, "subsystem")}
            </span>{" "}
            · mapped {formatRelativeTime(graph.builtAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StructureSearch slug={slug} builtAt={graph.builtAt} byId={byId} onChoose={showNode} />
          {cliInstalled ? (
            <PaperButton disabled={running} onClick={() => onRebuild()}>
              <RotateCw className={cn("size-3.5", running && "animate-spin motion-reduce:animate-none")} strokeWidth={2} aria-hidden="true" />
              {running ? "Rebuilding…" : "Rebuild"}
            </PaperButton>
          ) : null}
        </div>
      </div>

      {graph.stale && !running ? <PaperNotice>The code has changed since this map was built. Rebuild to bring it up to date.</PaperNotice> : null}
      <RebuildProblem rebuild={rebuild} failure={failure} onRebuild={onRebuild} />

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[clamp(420px,calc(100vh-340px),900px)] overflow-hidden rounded-[10px] border border-paper-mist bg-[var(--bg-canvas)]">
          {inside && opened.isPending ? (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-paper-sage" role="status">
              Opening {openName}…
            </div>
          ) : inside && opened.isError ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-paper-char" role="alert">
              {opened.error.message}
            </div>
          ) : (
            <div role="img" aria-label={inside ? `Graph of the most connected components in ${openName}. Every component is also listed beside it.` : `Map of ${mapNodes.length} subsystems and the links between them. Every subsystem is also listed beside it.`}>
              <StructureCanvas
                ref={canvas}
                nodes={inside ? openedNodes : mapNodes}
                links={inside ? openedLinks : mapLinks}
                selectedId={inside ? nodeId : subsystemId === undefined ? undefined : String(subsystemId)}
                directed={inside}
                reducedMotion={reducedMotion}
                labelFrom={inside ? 6 : 7}
                onSelect={(id) => {
                  if (inside) setNodeId(id);
                  else setSubsystemId(Number(id));
                }}
                onBackground={clearSelection}
              />
            </div>
          )}

          <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-start justify-between gap-2">
            {inside ? (
              <button type="button" onClick={backToMap} className={cn("pointer-events-auto inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md bg-paper-cream px-2.5 text-[13px] font-medium text-paper-moss transition-colors duration-150 hover:bg-paper-stone", PAPER_FOCUS)}>
                <ArrowLeft className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                Back to map
              </button>
            ) : (
              <span />
            )}
            <button type="button" aria-label="Fit the graph to this view" title="Fit to view" onClick={() => canvas.current?.fit()} className={cn("pointer-events-auto inline-grid size-9 cursor-pointer place-items-center rounded-md bg-paper-cream text-paper-char transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}>
              <Maximize className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[18px] text-paper-char">
            {inside ? (
              <>
                <span>Arrows point from caller to callee</span>
                <span>Dashed links are inferred</span>
                {hidden > 0 ? <span className="tabular-nums">Showing the {opened.data?.members.length} most connected of {formatCount(opened.data?.subsystem.size ?? 0)}</span> : null}
              </>
            ) : (
              <>
                {palette.legend.map((entry) => (
                  <span key={entry.area} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                    {entry.area}
                  </span>
                ))}
                <span className="text-paper-sage">Thicker links carry more interaction</span>
              </>
            )}
          </div>
        </div>

        <aside aria-label="Details" className="h-[clamp(420px,calc(100vh-340px),900px)] overflow-y-auto rounded-[10px] border border-paper-mist bg-paper-cream">
          {nodeId ? (
            <NodePanel query={node} onClose={() => setNodeId(undefined)} onChoose={showNode} onOpenSubsystem={openSubsystem} />
          ) : subsystemId !== undefined ? (
            <SubsystemPanel
              query={reading}
              inside={inside}
              colorOf={palette.colorOf}
              onClose={inside ? undefined : () => setSubsystemId(undefined)}
              onOpen={openSubsystem}
              onSelectSubsystem={(id) => (inside ? openSubsystem(id) : setSubsystemId(id))}
              onChooseMember={showNode}
            />
          ) : (
            <OverviewPanel graph={graph} colorOf={palette.colorOf} onSelect={setSubsystemId} onChoose={showNode} />
          )}
        </aside>
      </div>
    </section>
  );
}

function StructureSearch({
  slug,
  builtAt,
  byId,
  onChoose,
}: {
  slug: string;
  builtAt: string;
  byId: ReadonlyMap<number, StructureSubsystem>;
  onChoose: (node: StructureNodeSummary) => void;
}) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 180);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useStructureSearch(slug, term, builtAt);
  const results = search.data?.results ?? [];
  const showing = open && term.length > 0;

  return (
    <div
      ref={box}
      className="relative"
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        } else if (event.key === "ArrowDown" && showing) {
          event.preventDefault();
          const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("li button") ?? [])];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[Math.min(index + 1, items.length - 1)]?.focus();
        } else if (event.key === "ArrowUp" && showing) {
          event.preventDefault();
          const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("li button") ?? [])];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (index <= 0) box.current?.querySelector("input")?.focus();
          else items[index - 1]?.focus();
        }
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
      <input
        type="search"
        value={text}
        aria-label="Find a component or file"
        placeholder="Find a component or file"
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className={cn(PAPER_INPUT, PAPER_FOCUS, "w-[280px] max-w-full pl-9")}
      />
      {showing ? (
        <div className="absolute top-full right-0 z-20 mt-1 max-h-[360px] w-[380px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-md border border-paper-mist bg-paper-linen py-1">
          {search.isError ? (
            <p role="alert" className="px-3 py-2 text-[13px] text-paper-flame">
              {search.error.message}
            </p>
          ) : results.length > 0 ? (
            <ul>
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChoose(result);
                      setOpen(false);
                      setText("");
                    }}
                    className={cn("flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-paper-stone focus:bg-paper-stone", PAPER_FOCUS)}
                  >
                    <span className="truncate text-[14px] text-paper-moss">{result.label}</span>
                    <span className="truncate font-mono text-[12px] leading-[18px] text-paper-sage">{result.file ?? byId.get(result.subsystem)?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-[13px] text-paper-sage" role="status">
              {search.isFetching || term !== text.trim() ? "Searching…" : `Nothing matches “${term}”.`}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PanelSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-paper-mist py-3 first:border-t-0">
      <h3 className="px-4 pb-1 text-[13px] leading-5 font-medium text-paper-sage">{title}</h3>
      {children}
    </section>
  );
}

function Row({ onClick, children, trailing }: { onClick: () => void; children: ReactNode; trailing?: ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 px-4 py-1.5 text-left transition-colors duration-150 hover:bg-paper-stone", PAPER_FOCUS)}>
        <span className="min-w-0 flex-1">{children}</span>
        {trailing ? <span className="shrink-0 text-[12px] leading-[18px] text-paper-sage tabular-nums">{trailing}</span> : null}
      </button>
    </li>
  );
}

function SubsystemName({ subsystem, colorOf }: { subsystem: StructureSubsystem; colorOf: (area: string) => string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(subsystem.area) }} aria-hidden="true" />
      <span className="truncate text-[14px] text-paper-moss">{subsystem.name}</span>
    </span>
  );
}

function OverviewPanel({
  graph,
  colorOf,
  onSelect,
  onChoose,
}: {
  graph: StructureGraph;
  colorOf: (area: string) => string;
  onSelect: (id: number) => void;
  onChoose: (node: StructureNodeSummary) => void;
}) {
  const [all, setAll] = useState(false);
  const code = useMemo(() => graph.subsystems.filter((entry) => entry.kind === "code"), [graph.subsystems]);
  const listed = all ? graph.subsystems : code.slice(0, LIST_LIMIT);
  const remaining = graph.subsystems.length - listed.length;

  return (
    <>
      <PanelSection title="Most connected components">
        <ul>
          {graph.hubs.map((hub) => (
            <Row key={hub.id} onClick={() => onChoose(hub)} trailing={formatCount(hub.degree)}>
              <span className="block truncate text-[14px] text-paper-moss">{hub.label}</span>
              {hub.file ? <span className="block truncate font-mono text-[12px] leading-[18px] text-paper-sage">{hub.file}</span> : null}
            </Row>
          ))}
        </ul>
      </PanelSection>
      <PanelSection title="Subsystems, largest first">
        <ul>
          {listed.map((entry) => (
            <Row key={entry.id} onClick={() => onSelect(entry.id)} trailing={formatCount(entry.size)}>
              <SubsystemName subsystem={entry} colorOf={colorOf} />
            </Row>
          ))}
        </ul>
        {remaining > 0 ? (
          <div className="px-4 pt-2">
            <PaperButton className="w-full" onClick={() => setAll(true)}>
              Show {formatCount(remaining)} more, including docs and config
            </PaperButton>
          </div>
        ) : null}
      </PanelSection>
    </>
  );
}

function PanelHeader({ title, meta, onClose, children }: { title: string; meta?: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <header className="px-4 pt-4 pb-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-[16px] leading-6 font-semibold break-words text-paper-moss">{title}</h2>
        {onClose ? (
          <button type="button" aria-label="Close details" onClick={onClose} className={cn("-mt-1 -mr-1 inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}>
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {meta ? <div className="mt-1 text-[13px] leading-5 break-words text-paper-sage">{meta}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </header>
  );
}

function PanelState({ pending, error }: { pending: boolean; error?: Error | null }) {
  if (error) {
    return (
      <p role="alert" className="p-4 text-[14px] leading-6 text-paper-char">
        {error.message}
      </p>
    );
  }
  return pending ? (
    <p role="status" className="p-4 text-[13px] text-paper-sage">
      Reading…
    </p>
  ) : null;
}

function SubsystemPanel({
  query,
  inside,
  colorOf,
  onClose,
  onOpen,
  onSelectSubsystem,
  onChooseMember,
}: {
  query: ReturnType<typeof useStructureSubsystem>;
  inside: boolean;
  colorOf: (area: string) => string;
  onClose?: () => void;
  onOpen: (id: number) => void;
  onSelectSubsystem: (id: number) => void;
  onChooseMember: (node: StructureNodeSummary) => void;
}) {
  if (!query.data) return <PanelState pending={query.isPending} error={query.error} />;
  const { subsystem, members, connections, files } = query.data;

  return (
    <>
      <PanelHeader
        title={subsystem.name}
        onClose={onClose}
        meta={
          <>
            <code className="font-mono text-[12px] leading-[18px]">{subsystem.folder}</code>
            <p className="tabular-nums">
              {plural(subsystem.size, "component")} · {plural(subsystem.fileCount, "file")} · {plural(subsystem.crossLinks, "outside link")}
            </p>
          </>
        }
      >
        {inside ? null : <PaperButton className="w-full" onClick={() => onOpen(subsystem.id)}>Open subsystem</PaperButton>}
      </PanelHeader>
      {connections.length > 0 ? (
        <PanelSection title="Interacts with">
          <ul>
            {connections.map((connection) => (
              <Row key={connection.subsystem.id} onClick={() => onSelectSubsystem(connection.subsystem.id)} trailing={`${formatCount(connection.outgoing)} out · ${formatCount(connection.incoming)} in`}>
                <SubsystemName subsystem={connection.subsystem} colorOf={colorOf} />
              </Row>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      <PanelSection title="Most connected inside">
        <ul>
          {members.slice(0, inside ? members.length : 8).map((member) => (
            <Row key={member.id} onClick={() => onChooseMember(member)} trailing={formatCount(member.degree)}>
              <span className="block truncate text-[14px] text-paper-moss">{member.label}</span>
            </Row>
          ))}
        </ul>
      </PanelSection>
      {files.length > 0 ? (
        <PanelSection title="Main files">
          <ul className="px-4">
            {files.map((file) => (
              <li key={file.path} className="flex justify-between gap-3 py-1 font-mono text-[12px] leading-[18px] text-paper-char">
                <span className="min-w-0 break-all">{file.path}</span>
                <span className="shrink-0 text-paper-sage tabular-nums">{formatCount(file.members)}</span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
    </>
  );
}

function NodePanel({
  query,
  onClose,
  onChoose,
  onOpenSubsystem,
}: {
  query: ReturnType<typeof useStructureNode>;
  onClose: () => void;
  onChoose: (node: StructureNodeSummary) => void;
  onOpenSubsystem: (id: number) => void;
}) {
  const groups = useMemo(() => groupConnections(query.data?.connections ?? []), [query.data]);

  if (!query.data) return <PanelState pending={query.isPending} error={query.error} />;
  const { node, subsystem, connections, totalConnections } = query.data;
  const place = placeOf(node.file, node.location);

  return (
    <>
      <PanelHeader
        title={node.label}
        onClose={onClose}
        meta={
          <>
            {place ? <code className="block font-mono text-[12px] leading-[18px] break-all">{place}</code> : null}
            {node.external ? <p>External package</p> : null}
            <p>
              In{" "}
              <button type="button" onClick={() => onOpenSubsystem(subsystem.id)} className={cn("cursor-pointer rounded-sm text-paper-moss underline underline-offset-2", PAPER_FOCUS)}>
                {subsystem.name}
              </button>
            </p>
          </>
        }
      />
      {groups.length === 0 ? <p className="border-t border-paper-mist p-4 text-[14px] text-paper-char">Nothing else in this map connects to it.</p> : null}
      {groups.map((group) => (
        <PanelSection key={group.key} title={<span className="tabular-nums">{group.label} ({formatCount(group.connections.length)})</span>}>
          <ul>
            {group.connections.map((connection) => (
              <Row key={`${group.key}:${connection.other.id}:${connection.location ?? ""}`} onClick={() => onChoose(connection.other)} trailing={connection.inferred ? <Tag tone="muted">Inferred</Tag> : undefined}>
                <span className="block truncate text-[14px] text-paper-moss">{connection.other.label}</span>
                {connection.other.file ? <span className="block truncate font-mono text-[12px] leading-[18px] text-paper-sage">{connection.other.file}</span> : null}
              </Row>
            ))}
          </ul>
        </PanelSection>
      ))}
      {totalConnections > connections.length ? (
        <p className="border-t border-paper-mist p-4 text-[13px] leading-5 text-paper-sage">
          Showing {formatCount(connections.length)} of {formatCount(totalConnections)} connections. Ask <code className="font-mono text-[12px]">/graphify</code> about this component for the rest.
        </p>
      ) : null}
    </>
  );
}
