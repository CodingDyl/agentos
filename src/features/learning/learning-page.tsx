import { Archive, ArchiveRestore, BookmarkPlus, Check, Clock, ExternalLink, Link2, NotebookText, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatTimestamp, LEARNING_SOURCE_LABELS, type LearningSource } from "@shared/learning-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperStage, PaperTabs, SegmentedControl, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import { useDeleteSource, useImportSource, useLearningLibrary, useUpdateSource } from "@/lib/agentos/learning";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { LearningCapture, type CaptureContext } from "./learning-capture";
import { groupLibrary, isLearningTab, progressShare, resumeAt, tagsFromText, type LearningTab } from "./learning-model";
import { NotebookLibrary } from "./notebook-library";
import { SavedLearning } from "./saved-learning";
import { useOptionalSpotify } from "./spotify-context-value";
import { SpotifyPanel } from "./spotify-player";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player";

/**
 * Learning: watch, listen and research — and capture what was learned.
 *
 * Media-first and quiet. A pasted address is saved to the library and plays
 * through the service's own player; the one action that matters while it
 * plays is Capture learning, which stamps the moment. Captured learnings go
 * to Knowledge and search straight away, and to memory only when promoted.
 *
 * The video player sits above the tabs and stays mounted while this page is
 * open, so moving between Discover and the library doesn't restart it.
 */

const TABS: ReadonlyArray<{ value: LearningTab; label: string }> = [
  { value: "discover", label: "Discover" },
  { value: "youtube", label: "YouTube" },
  { value: "spotify", label: "Spotify" },
  { value: "notebooks", label: "Notebooks" },
  { value: "saved", label: "Saved" },
];

type VideoFilter = "all" | "later" | "progress" | "finished" | "archived";

const VIDEO_FILTERS: ReadonlyArray<{ value: VideoFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "later", label: "Watch later" },
  { value: "progress", label: "In progress" },
  { value: "finished", label: "Finished" },
  { value: "archived", label: "Archived" },
];

export function LearningPage() {
  const navigationItems = useNavigationItems();
  const [params, setParams] = useSearchParams();
  const library = useLearningLibrary();

  const tab: LearningTab = isLearningTab(params.get("tab")) ? (params.get("tab") as LearningTab) : "discover";
  const videoId = params.get("video") ?? undefined;
  const requestedT = params.get("t");
  const noteId = params.get("note") ?? undefined;

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
        { replace: false },
      ),
    [setParams],
  );

  const sources = useMemo(() => library.data?.sources ?? [], [library.data]);
  const notes = useMemo(() => library.data?.notes ?? [], [library.data]);
  const notebooks = library.data?.notebooks ?? [];
  const selected = sources.find((source) => source.id === videoId && source.kind === "youtube");

  const openVideo = (source: LearningSource, at?: number) =>
    update({ tab: tab === "discover" ? "discover" : "youtube", video: source.id, t: at !== undefined ? String(Math.floor(at)) : undefined });

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="learning"
      activeHref="/learning"
      agentState="idle"
      agentLabel="Learning"
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-paper-display text-[34px] leading-none font-extrabold tracking-[-0.015em] text-paper-moss">Learning</h1>
            <p className="mt-2 text-[13.5px] text-paper-sage">
              {sources.length} saved · {notes.filter((note) => !note.archived).length} learnings · {notebooks.length} notebooks
            </p>
          </div>
          <ImportBar onOpened={(source, at) => update({ tab: "youtube", video: source.id, t: at !== undefined ? String(at) : undefined })} />
        </header>

        {library.error ? (
          <p role="alert" className="mt-6 text-[14px] text-paper-flame-deep">
            {library.error.message}
          </p>
        ) : null}

        {selected && (tab === "discover" || tab === "youtube") ? (
          <VideoStage
            key="stage"
            source={selected}
            requestedT={requestedT !== null ? Number(requestedT) : undefined}
            onClose={() => update({ video: undefined, t: undefined })}
            onSaved={(id) => update({ tab: "saved", note: id, video: undefined, t: undefined })}
          />
        ) : null}

        <div className="mt-8">
          <PaperTabs<LearningTab> options={TABS} value={tab} onChange={(next) => update({ tab: next === "discover" ? undefined : next })} label="Learning sections" />
        </div>

        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-7">
          {library.isPending ? <p className="text-[14px] text-paper-sage">Reading the library…</p> : null}
          {library.data && tab === "discover" ? (
            <Discover sources={sources} onOpen={openVideo} onTab={(next) => update({ tab: next })} onNote={(id) => update({ tab: "saved", note: id })} />
          ) : null}
          {library.data && tab === "youtube" ? <VideoLibrary sources={sources} selectedId={selected?.id} onOpen={openVideo} /> : null}
          {tab === "spotify" ? <SpotifyPanel connectResult={params.get("spotify") ?? undefined} /> : null}
          {library.data && tab === "notebooks" ? <NotebookLibrary notebooks={notebooks} sources={sources} notes={notes} /> : null}
          {library.data && tab === "saved" ? <SavedLearning notes={notes} sources={sources} selectedId={noteId} onSelect={(id) => update({ note: id })} /> : null}
        </div>
      </PaperStage>
    </AppShell>
  );
}

function ImportBar({ onOpened }: { onOpened: (source: LearningSource, at?: number) => void }) {
  const importSource = useImportSource();
  const [url, setUrl] = useState("");
  const [later, setLater] = useState(false);
  const [message, setMessage] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || importSource.isPending) return;
    setMessage(undefined);
    importSource.mutate(
      { url: url.trim(), watchLater: later || undefined },
      {
        onSuccess: (result) => {
          setUrl("");
          if (result.source.kind === "youtube" && !later) onOpened(result.source, result.startSeconds);
          else setMessage(`${result.created ? "Saved" : "Already saved"}: ${result.source.title}${later ? " · Watch later" : ""}`);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="w-full max-w-[560px]" aria-label="Save a video or track">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a YouTube or Spotify link"
            aria-label="YouTube or Spotify link"
            className={cn(PAPER_INPUT, "min-h-10 w-full pl-9")}
          />
        </label>
        <PaperButton type="submit" variant="amber" disabled={!url.trim() || importSource.isPending}>
          {importSource.isPending ? "Saving…" : later ? "Save" : "Open"}
        </PaperButton>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[12.5px]">
        <label className="flex items-center gap-1.5 text-paper-char">
          <input type="checkbox" checked={later} onChange={(event) => setLater(event.target.checked)} /> Watch later
        </label>
        {importSource.error ? <span role="alert" className="text-paper-flame-deep">{importSource.error.message}</span> : null}
        {message ? <span role="status" className="truncate text-paper-sage">{message}</span> : null}
      </div>
    </form>
  );
}

function VideoStage({ source, requestedT, onClose, onSaved }: { source: LearningSource; requestedT?: number; onClose: () => void; onSaved: (noteId: string) => void }) {
  const player = useRef<YouTubePlayerHandle>(null);
  const updateSource = useUpdateSource();
  const projects = useProjects();
  const [capture, setCapture] = useState<CaptureContext>();
  // The start position is fixed per (video, requested time); progress saves must not move it.
  const start = useMemo(() => resumeAt(source, requestedT), [source.id, requestedT]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCapture = () => {
    const at = player.current?.currentTime();
    // Writing is easier with the video still.
    player.current?.pause();
    setCapture({
      sourceType: "youtube",
      sourceId: source.id,
      sourceTitle: source.title,
      timestampSeconds: at,
      workspaceId: source.workspaceId,
    });
  };

  return (
    <section aria-label="Now playing" className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <YouTubePlayer ref={player} sourceId={source.id} videoId={source.externalId} startSeconds={start} title={source.title} seekKey={`${source.id}:${requestedT ?? ""}`} />
        <div className="mt-4 flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-paper-display text-[22px] leading-tight font-bold">{source.title}</h2>
            <p className="mt-1 text-[13px] text-paper-sage">
              {source.author ? `${source.author} · ` : ""}
              {source.durationSeconds ? formatTimestamp(source.durationSeconds) : "YouTube"}
              {source.finished ? " · finished" : ""}
            </p>
          </div>
          <PaperButton variant="amber" onClick={openCapture} className="min-h-10 px-5">
            <BookmarkPlus className="size-4" strokeWidth={2} aria-hidden="true" /> Capture learning
          </PaperButton>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <select
            value={source.workspaceId ?? ""}
            onChange={(event) => updateSource.mutate({ id: source.id, workspaceId: event.target.value || null })}
            aria-label="Workspace"
            className={cn(PAPER_INPUT, "min-h-8 cursor-pointer text-[13px]")}
          >
            <option value="">No workspace</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
          <TagsInput key={`${source.id}:${source.tags.join(",")}`} tags={source.tags} onSave={(tags) => updateSource.mutate({ id: source.id, tags })} />
          <PaperButton variant="quiet" onClick={() => updateSource.mutate({ id: source.id, watchLater: !source.watchLater })}>
            <Clock className="size-3.5" strokeWidth={2} aria-hidden="true" /> {source.watchLater ? "In Watch later" : "Watch later"}
          </PaperButton>
          <PaperButton variant="quiet" onClick={() => updateSource.mutate({ id: source.id, finished: !source.finished })}>
            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> {source.finished ? "Finished" : "Mark finished"}
          </PaperButton>
          <a href={source.url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-8 items-center gap-1.5 px-3 text-[13px] text-paper-sage hover:text-paper-moss", PAPER_FOCUS)}>
            <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" /> YouTube
          </a>
          <PaperButton variant="quiet" onClick={onClose}>
            Close
          </PaperButton>
        </div>
      </div>
      <div className="min-w-0">
        {capture ? (
          <LearningCapture
            key={`${capture.sourceId}-${capture.timestampSeconds ?? ""}`}
            context={capture}
            onDone={(id) => {
              setCapture(undefined);
              if (id) {
                // Back to watching; the note is in Saved.
                player.current?.play();
                setTimeout(() => onSaved(id), 0);
              }
            }}
          />
        ) : (
          <div className="border border-dashed border-paper-mist p-5 text-[14px] leading-6 text-paper-sage">
            Press <span className="font-medium text-paper-moss">Capture learning</span> at the moment something is worth keeping. The note is stamped with the time, so opening it later returns here.
          </div>
        )}
      </div>
    </section>
  );
}

/** Edited freely, saved on blur. Keyed by the saved tags, so it resets when they change. */
function TagsInput({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(", "));
  return (
    <input
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text !== tags.join(", ") && onSave(tagsFromText(text))}
      placeholder="tags, comma separated"
      aria-label="Tags"
      className={cn(PAPER_INPUT, "min-h-8 w-48 text-[13px]")}
    />
  );
}

function VideoCard({ source, active, onOpen }: { source: LearningSource; active?: boolean; onOpen: () => void }) {
  const share = progressShare(source);
  return (
    <button type="button" onClick={onOpen} className={cn("group block w-full cursor-pointer text-left", PAPER_FOCUS)} aria-current={active ? "true" : undefined}>
      <span className={cn("relative block aspect-video overflow-hidden bg-paper-linen", active && "ring-2 ring-paper-blue")}>
        {source.thumbnailUrl ? (
          <img src={source.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
        ) : null}
        {share !== undefined ? (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
            <span className="block h-full bg-paper-flame-deep" style={{ width: `${share * 100}%` }} />
          </span>
        ) : null}
      </span>
      <span className="mt-2 line-clamp-2 block text-[14px] leading-5 font-medium group-hover:text-paper-blue">{source.title}</span>
      <span className="block truncate text-[12px] text-paper-sage">
        {source.author ?? "YouTube"}
        {source.positionSeconds > 5 && !source.finished ? ` · ${formatTimestamp(source.positionSeconds)}` : ""}
      </span>
    </button>
  );
}

function Discover({
  sources,
  onOpen,
  onTab,
  onNote,
}: {
  sources: LearningSource[];
  onOpen: (source: LearningSource) => void;
  onTab: (tab: LearningTab) => void;
  onNote: (id: string) => void;
}) {
  const library = useLearningLibrary();
  const spotify = useOptionalSpotify();
  const groups = groupLibrary(sources);
  const notes = (library.data?.notes ?? []).filter((note) => !note.archived).slice(0, 6);
  const notebooks = (library.data?.notebooks ?? []).slice(0, 4);
  const track = spotify?.ready ? spotify.playback?.track : undefined;

  return (
    <div className="space-y-10">
      {track ? (
        <section aria-label="Listening" className="flex items-center gap-4 border border-paper-mist bg-paper-white p-4">
          {track.imageUrl ? <img src={track.imageUrl} alt="" className="size-14 object-cover" referrerPolicy="no-referrer" /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-paper-utility text-[12px] tracking-[0.1em] text-paper-sage uppercase">{spotify?.playback?.isPlaying ? "Listening" : "Paused"}</p>
            <p className="truncate text-[16px] font-medium">{track.name}</p>
            <p className="truncate text-[13px] text-paper-sage">{track.artists.join(", ")}</p>
          </div>
          <PaperButton variant="ghost" onClick={() => onTab("spotify")}>
            Open player
          </PaperButton>
        </section>
      ) : null}

      <section aria-label="Continue">
        <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Continue</h2>
        {groups.continueWatching.length === 0 ? (
          <p className="mt-2 text-[14px] text-paper-sage">Nothing in progress. Paste a YouTube link above to start.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {groups.continueWatching.slice(0, 8).map((source) => (
              <li key={source.id}>
                <VideoCard source={source} onOpen={() => onOpen(source)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Saved" className="grid gap-8 lg:grid-cols-3">
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Recent learnings</h2>
            <button type="button" onClick={() => onTab("saved")} className="cursor-pointer text-[12.5px] text-paper-blue hover:underline">
              All
            </button>
          </div>
          {notes.length === 0 ? <p className="mt-2 text-[14px] text-paper-sage">Nothing captured yet.</p> : null}
          <ul className="mt-2 divide-y divide-paper-mist">
            {notes.map((note) => (
              <li key={note.id}>
                <button type="button" onClick={() => onNote(note.id)} className={cn("block w-full cursor-pointer py-2.5 text-left hover:bg-paper-linen", PAPER_FOCUS)}>
                  <span className="block truncate text-[14.5px] font-medium">{note.title}</span>
                  <span className="block text-[12.5px] text-paper-sage">
                    {LEARNING_SOURCE_LABELS[note.sourceType]}
                    {note.timestampSeconds !== undefined ? ` · ${formatTimestamp(note.timestampSeconds)}` : ""} · {formatRelativeTime(note.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Research notebooks</h2>
            <button type="button" onClick={() => onTab("notebooks")} className="cursor-pointer text-[12.5px] text-paper-blue hover:underline">
              All
            </button>
          </div>
          {notebooks.length === 0 ? <p className="mt-2 text-[14px] text-paper-sage">No notebooks linked.</p> : null}
          <ul className="mt-2 divide-y divide-paper-mist">
            {notebooks.map((notebook) => (
              <li key={notebook.id} className="flex items-center gap-2 py-2.5">
                <NotebookText className="size-4 shrink-0 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[14.5px]">{notebook.name}</span>
                {notebook.externalUrl ? (
                  <a href={notebook.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${notebook.name}`} className="text-paper-sage hover:text-paper-moss">
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Watch later</h2>
            <button type="button" onClick={() => onTab("youtube")} className="cursor-pointer text-[12.5px] text-paper-blue hover:underline">
              Library
            </button>
          </div>
          {groups.watchLater.length === 0 ? <p className="mt-2 text-[14px] text-paper-sage">Nothing queued.</p> : null}
          <ul className="mt-2 divide-y divide-paper-mist">
            {groups.watchLater.slice(0, 6).map((source) => (
              <li key={source.id}>
                {source.kind === "youtube" ? (
                  <button type="button" onClick={() => onOpen(source)} className={cn("flex w-full cursor-pointer items-center gap-3 py-2 text-left hover:bg-paper-linen", PAPER_FOCUS)}>
                    {source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-16 shrink-0 object-cover" /> : null}
                    <span className="min-w-0 flex-1 truncate text-[14px]">{source.title}</span>
                  </button>
                ) : (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2 text-[14px] hover:bg-paper-linen">
                    <span className="truncate">{source.title}</span>
                    <Tag>Spotify</Tag>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function VideoLibrary({ sources, selectedId, onOpen }: { sources: LearningSource[]; selectedId?: string; onOpen: (source: LearningSource) => void }) {
  const [filter, setFilter] = useState<VideoFilter>("all");
  const update = useUpdateSource();
  const remove = useDeleteSource();
  const groups = groupLibrary(sources);

  const shown =
    filter === "archived"
      ? groups.archived
      : filter === "later"
        ? groups.watchLater
        : filter === "progress"
          ? groups.continueWatching
          : filter === "finished"
            ? [...groups.videos, ...groups.tracks].filter((source) => source.finished)
            : [...groups.videos, ...groups.tracks];

  return (
    <div>
      <SegmentedControl label="Show" options={VIDEO_FILTERS} value={filter} onChange={setFilter} />
      {shown.length === 0 ? <p className="mt-5 text-[14px] text-paper-sage">Nothing here.</p> : null}
      <ul className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((source) => (
          <li key={source.id} className="group/card">
            {source.kind === "youtube" ? (
              <VideoCard source={source} active={source.id === selectedId} onOpen={() => onOpen(source)} />
            ) : (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="block">
                <span className="block aspect-video overflow-hidden bg-paper-linen">
                  {source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" /> : null}
                </span>
                <span className="mt-2 block truncate text-[14px] font-medium">{source.title}</span>
                <span className="block text-[12px] text-paper-sage">Spotify</span>
              </a>
            )}
            <div className="mt-1 flex gap-1 opacity-70 group-hover/card:opacity-100">
              <button
                type="button"
                title={source.watchLater ? "Remove from Watch later" : "Watch later"}
                aria-label={source.watchLater ? "Remove from Watch later" : "Watch later"}
                onClick={() => update.mutate({ id: source.id, watchLater: !source.watchLater })}
                className={cn("inline-flex size-7 cursor-pointer items-center justify-center hover:bg-paper-linen", source.watchLater ? "text-paper-blue" : "text-paper-sage")}
              >
                <Clock className="size-3.5" />
              </button>
              <button
                type="button"
                title={source.archived ? "Restore" : "Archive"}
                aria-label={source.archived ? "Restore" : "Archive"}
                onClick={() => update.mutate({ id: source.id, archived: !source.archived })}
                className="inline-flex size-7 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-linen"
              >
                {source.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
              </button>
              {source.archived ? (
                <button
                  type="button"
                  title="Remove from the library (learnings stay)"
                  aria-label="Remove from the library"
                  onClick={() => remove.mutate(source.id)}
                  className="inline-flex size-7 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-linen"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
              {source.workspaceId ? (
                <Link to={`/workspaces/${encodeURIComponent(source.workspaceId)}`} className="ml-auto self-center truncate text-[12px] text-paper-sage hover:text-paper-moss">
                  {source.workspaceId}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
