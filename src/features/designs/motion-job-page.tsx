import { ExternalLink, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DesignAsset } from "@shared/agentos-types";
import type { MotionJobDetail, MotionLogEntry, MotionRound } from "@shared/motion-types";
import { AppShell } from "@/components/os";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperBackLink,
  PaperButton,
  PaperError,
  PaperLoading,
  PaperNotice,
  PaperPageHeader,
  PaperSection,
  PaperStage,
} from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useCancelMotionJob, useMotionJob, useResumeMotionJob } from "@/lib/agentos/motion";
import { useDesignLibrary } from "@/lib/agentos/queries";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sourceLabel } from "./designs-model";
import { MotionStatus, PromptBlock } from "./motion-status";

/**
 * One film, as it is made.
 *
 * The page follows the studio loop: each round's contact sheet and the scores
 * Claude gave it, newest first, beside the running log. When the film is done
 * it moves to the top, and the one thing left to do is say what to change.
 */

const CRITERIA: Record<string, string> = {
  hook: "Hook",
  readability: "Readability",
  motion: "Motion",
  variety: "Variety",
  brand: "Brand",
  sync: "Sound sync",
};

const criterionLabel = (key: string) =>
  CRITERIA[key] ?? key.replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

/** The bar every score has to clear, from the studio rules. */
const PASS = 8;

export function MotionJobPage() {
  const { id } = useParams<{ id: string }>();
  const navigationItems = useNavigationItems();
  const { data: job, isPending, error, refetch, isFetching } = useMotionJob(id);
  const { data: library } = useDesignLibrary();

  const films = useMemo(() => {
    const byId = new Map((library?.assets ?? []).map((asset) => [asset.id, asset]));
    return (job?.assetIds ?? []).map((assetId) => byId.get(assetId)).filter((asset): asset is DesignAsset => Boolean(asset));
  }, [library, job?.assetIds]);

  return (
    <AppShell navigationItems={navigationItems} pageId="designs" activeHref="/designs" modelLabel="Model / Claude Code">
      <PaperStage>
        <PaperBackLink to="/designs/motion">Motion</PaperBackLink>
        {isPending ? (
          <PaperLoading className="mt-10" title="Motion" message="Opening the studio…" />
        ) : !job ? (
          <PaperError title="This film could not be read." detail={error?.message} onRetry={() => void refetch()} isRetrying={isFetching} />
        ) : (
          <Film job={job} films={films} />
        )}
      </PaperStage>
    </AppShell>
  );
}

function Film({ job, films }: { job: MotionJobDetail; films: DesignAsset[] }) {
  const cancel = useCancelMotionJob();
  const resume = useResumeMotionJob();
  const live = job.status === "queued" || job.status === "running";
  const stopped = job.status === "failed" || job.status === "cancelled" || job.status === "interrupted";
  const rounds = [...job.rounds].reverse();

  return (
    <>
      <PaperPageHeader
        className="mt-3"
        title={job.title}
        description={[
          `${job.request.durationSec}s`,
          job.request.formats.join(" + "),
          job.model ?? "Claude Code",
          `effort ${job.request.effort}`,
          `started ${formatRelativeTime(job.createdAt)}`,
        ].join(" · ")}
        actions={
          <>
            <MotionStatus job={job} rounds={job.rounds.length} className="mr-2" />
            {live ? (
              <PaperButton variant="danger" onClick={() => cancel.mutate(job.id)} disabled={cancel.isPending}>
                <Square className="size-3 fill-current" aria-hidden="true" />
                Stop
              </PaperButton>
            ) : null}
            {stopped ? (
              <PaperButton variant="amber" onClick={() => resume.mutate({ id: job.id })} disabled={resume.isPending}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {resume.isPending ? "Resuming…" : "Resume"}
              </PaperButton>
            ) : null}
          </>
        }
      />

      {job.error ? (
        <p role="alert" className="mt-6 max-w-[80ch] border border-paper-flame-deep px-4 py-3 text-[13.5px] leading-6 text-paper-flame-deep">
          {job.error}
          {stopped ? " Resume carries on in the same session, with everything it has made so far." : ""}
        </p>
      ) : null}

      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-14">
          {films.length > 0 ? <Films films={films} /> : null}
          {job.status === "completed" ? <Revise job={job} /> : null}

          <PaperSection label="Review rounds" count={job.rounds.length || undefined}>
            {rounds.length > 0 ? (
              <ol className="space-y-12">
                {rounds.map((round) => (
                  <Round key={round.round} round={round} latest={round.round === job.rounds.length} />
                ))}
              </ol>
            ) : job.sheets.length > 0 ? (
              <div className="space-y-6">
                {job.sheets.map((sheet) => (
                  <Sheet key={sheet.name} url={sheet.url} label={sheet.name} />
                ))}
              </div>
            ) : (
              <p className="max-w-[60ch] text-[13.5px] leading-6 text-paper-sage">
                {live
                  ? "Claude is building the film. The first contact sheet, one frame per beat, appears here as soon as it is rendered, with the scores Claude gives it."
                  : "No contact sheets were saved for this film."}
              </p>
            )}
          </PaperSection>

          {job.summary ? (
            <PaperSection label="Claude's summary">
              <p className="max-w-[72ch] text-[14px] leading-7 whitespace-pre-wrap text-paper-moss">{job.summary}</p>
            </PaperSection>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-12">
          <StudioLog entries={job.log} live={live} />
          <details className="border-t border-paper-mist pt-4">
            <summary className={cn("cursor-pointer text-[13px] font-medium text-paper-char hover:text-paper-moss", PAPER_FOCUS)}>
              What Claude was told
            </summary>
            <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">
              Template: {sourceLabel(job.promptSources.template)} · Rules: {sourceLabel(job.promptSources.rules)}
            </p>
            <div className="mt-3">
              <PromptBlock label="Prompt" text={job.prompt} />
            </div>
          </details>
        </aside>
      </div>
    </>
  );
}

function Films({ films }: { films: DesignAsset[] }) {
  const [active, setActive] = useState(0);
  const film = films[Math.min(active, films.length - 1)];
  const format = (asset: DesignAsset) =>
    asset.tags.find((tag) => /^\d+:\d+$/.test(tag)) ?? (asset.width && asset.height ? `${asset.width}×${asset.height}` : asset.filename);

  return (
    <PaperSection
      label={films.length > 1 ? "Films" : "Film"}
      action={
        <Link
          to={`/designs?asset=${film.id}`}
          className={cn("inline-flex min-h-8 items-center gap-1.5 px-2 text-[13px] font-medium text-paper-sage hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
        >
          Open in Creative
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {films.length > 1 ? (
        <div role="tablist" aria-label="Formats" className="mb-4 flex gap-1">
          {films.map((asset, index) => (
            <button
              key={asset.id}
              role="tab"
              type="button"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "min-h-8 cursor-pointer px-3 text-[13px] font-medium tabular-nums transition-colors duration-150",
                PAPER_FOCUS,
                index === active ? "bg-paper-blue text-paper-white" : "text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
              )}
            >
              {format(asset)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex justify-center bg-paper-moss p-4 sm:p-6">
        <video
          key={film.id}
          src={film.url}
          poster={film.thumbnailUrl.includes("size=thumbnail") ? film.thumbnailUrl : undefined}
          controls
          playsInline
          aria-label={film.filename}
          className="max-h-[72vh] max-w-full"
        />
      </div>
    </PaperSection>
  );
}

function Revise({ job }: { job: MotionJobDetail }) {
  const resume = useResumeMotionJob();
  const [note, setNote] = useState("");

  return (
    <PaperSection label="Changes">
      {job.revisions.length > 0 ? (
        <ol className="mb-5 space-y-2">
          {job.revisions.map((revision) => (
            <li key={revision.at} className="text-[13.5px] leading-6 text-paper-char">
              <span className="text-paper-sage tabular-nums">{formatRelativeTime(revision.at)} · </span>
              {revision.note}
            </li>
          ))}
        </ol>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (note.trim()) resume.mutate({ id: job.id, note }, { onSuccess: () => setNote("") });
        }}
      >
        <label className="block">
          <FieldLabel>What should change?</FieldLabel>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="The hook is too slow. Hold the logo a beat longer at the end."
            className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <PaperButton type="submit" variant="ghost" disabled={!note.trim() || resume.isPending}>
            {resume.isPending ? "Sending…" : "Revise the film"}
          </PaperButton>
          <span className="text-[12.5px] text-paper-sage">
            Claude picks up the same session, runs the review loop again and re-renders. The new cut is filed beside this one.
          </span>
        </div>
      </form>
    </PaperSection>
  );
}

function Round({ round, latest }: { round: MotionRound; latest: boolean }) {
  const entries = Object.entries(round.scores);
  const passed = entries.length > 0 && entries.every(([, score]) => score >= PASS);

  return (
    <li>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-paper-display text-[15px] font-bold tracking-[-0.01em] text-paper-moss">Round {round.round}</h3>
        <span className="text-[12.5px] text-paper-sage">
          {passed ? "Every score 8 or better" : latest ? "Latest" : `${entries.filter(([, score]) => score < PASS).length} below 8`}
        </span>
      </div>

      {entries.length > 0 ? (
        <dl className="mb-4 grid grid-cols-3 border-t border-l border-paper-mist sm:grid-cols-6">
          {entries.map(([key, score]) => (
            <div key={key} className="border-r border-b border-paper-mist px-3 py-2.5">
              <dt className="text-[12px] text-paper-sage">{criterionLabel(key)}</dt>
              <dd
                className={cn(
                  "font-paper-display text-[26px] leading-8 font-extrabold tabular-nums",
                  score >= PASS ? "text-paper-moss" : "text-paper-flame-deep",
                )}
              >
                {score}
                <span className="sr-only">{score >= PASS ? " (passes)" : " (below 8)"}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {round.sheetUrl ? <Sheet url={round.sheetUrl} label={`Round ${round.round} contact sheet`} /> : null}

      {round.fixes.length > 0 ? (
        <div className="mt-4">
          <p className="text-[12.5px] font-medium text-paper-char">Fixed next</p>
          <ul className="mt-1.5 space-y-1">
            {round.fixes.map((fix) => (
              <li key={fix} className="max-w-[72ch] text-[13.5px] leading-6 text-paper-moss">
                {fix}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function Sheet({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("block cursor-zoom-in bg-paper-moss", PAPER_FOCUS)} aria-label={`Open ${label} full size`}>
      <img src={url} alt={label} className="w-full" loading="lazy" />
    </a>
  );
}

function StudioLog({ entries, live }: { entries: MotionLogEntry[]; live: boolean }) {
  const scroller = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);

  // Follows the newest line, unless the reader has scrolled back to read.
  useEffect(() => {
    const element = scroller.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
  }, [entries.length]);

  return (
    <PaperSection label="Studio log" action={live ? <span className="text-[12.5px] text-paper-sage">Live</span> : undefined}>
      <ol
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="max-h-[36rem] space-y-2.5 overflow-y-auto border-y border-paper-mist py-3 pr-1"
        aria-live="off"
      >
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 text-[12.5px] leading-5">
            <time className="text-paper-sage tabular-nums" dateTime={entry.at}>
              {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
            </time>
            <span
              className={cn(
                "break-words",
                entry.kind === "tool" && "font-mono text-[11.5px] text-paper-char",
                entry.kind === "text" && "text-paper-moss",
                entry.kind === "system" && "font-medium text-paper-blue",
              )}
            >
              {entry.message}
            </span>
          </li>
        ))}
      </ol>
      {!live && entries.length === 0 ? <PaperNotice className="mt-3">Nothing logged.</PaperNotice> : null}
    </PaperSection>
  );
}
