import { Check, RotateCcw, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ANIMATE_STAGES, ANIMATE_STAGE_LABEL, type AnimateCheckpoint, type AnimateJob, type AnimateStage } from "@shared/animate-types";
import type { DesignAsset } from "@shared/agentos-types";
import { AppShell, Markdown } from "@/components/os";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperBackLink,
  PaperButton,
  PaperError,
  PaperLoading,
  PaperPageHeader,
  PaperSection,
  PaperStage,
} from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useCancelAnimateJob, useAnimateJob, useDecideAnimateJob, useResumeAnimateJob } from "@/lib/agentos/animate";
import { useDesignLibrary } from "@/lib/agentos/queries";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimateStatus } from "./animate-status";
import { Films, StudioLog } from "./motion-job-page";

/**
 * One Claude Motion video, stage by stage.
 *
 * The stepper shows where Animate is. At a review gate the page is the review:
 * Claude's notes and frames, then Approve or Request changes. Nothing moves on
 * until a person answers. Once delivered, the video and its measured checks
 * sit at the top and the one thing left is to say what to change.
 */

export function AnimateJobPage() {
  const { id } = useParams<{ id: string }>();
  const navigationItems = useNavigationItems();
  const { data: job, isPending, error, refetch, isFetching } = useAnimateJob(id);
  const { data: library } = useDesignLibrary();

  const films = useMemo(() => {
    const byId = new Map((library?.assets ?? []).map((asset) => [asset.id, asset]));
    return (job?.assetIds ?? []).map((assetId) => byId.get(assetId)).filter((asset): asset is DesignAsset => Boolean(asset));
  }, [library, job?.assetIds]);

  return (
    <AppShell navigationItems={navigationItems} pageId="designs" activeHref="/designs" modelLabel="Model / Claude Code">
      <PaperStage>
        <PaperBackLink to="/designs/animate">Claude Motion</PaperBackLink>
        {isPending ? (
          <PaperLoading className="mt-10" title="Claude Motion" message="Opening the studio…" />
        ) : !job ? (
          <PaperError title="This video could not be read." detail={error?.message} onRetry={() => void refetch()} isRetrying={isFetching} />
        ) : (
          <Video job={job} films={films} />
        )}
      </PaperStage>
    </AppShell>
  );
}

type StepState = "done" | "current" | "review" | "upcoming";

function stepState(job: AnimateJob, stage: AnimateStage): StepState {
  const at = ANIMATE_STAGES.indexOf(job.stage);
  const index = ANIMATE_STAGES.indexOf(stage);
  if (job.status === "completed") return "done";
  if (index < at) return "done";
  if (index > at) return "upcoming";
  return job.status === "awaiting_review" ? "review" : "current";
}

function Stepper({ job }: { job: AnimateJob }) {
  return (
    <ol aria-label="Stages" className="grid grid-cols-2 gap-px border border-paper-mist bg-paper-mist sm:grid-cols-4">
      {ANIMATE_STAGES.map((stage, index) => {
        const state = stepState(job, stage);
        return (
          <li key={stage} aria-current={state === "current" || state === "review" ? "step" : undefined} className={cn("px-3 py-2.5", state === "review" ? "bg-paper-linen" : "bg-paper-white")}>
            <p className="flex items-center gap-1.5 font-paper-utility text-[11.5px] tracking-[0.08em] text-paper-sage uppercase tabular-nums">
              {state === "done" ? <Check className="size-3 text-paper-green" strokeWidth={2.5} aria-hidden="true" /> : <span>{String(index + 1).padStart(2, "0")}</span>}
              <span className={cn(state === "review" && "text-paper-blue")}>
                {state === "done" ? "Done" : state === "review" ? "Your review" : state === "current" ? "Claude is on it" : "Next"}
              </span>
            </p>
            <p className={cn("mt-0.5 text-[13.5px] font-semibold", state === "upcoming" ? "text-paper-sage" : "text-paper-moss")}>{ANIMATE_STAGE_LABEL[stage]}</p>
          </li>
        );
      })}
    </ol>
  );
}

function Video({ job, films }: { job: AnimateJob; films: DesignAsset[] }) {
  const cancel = useCancelAnimateJob();
  const resume = useResumeAnimateJob();
  const live = job.status === "queued" || job.status === "running";
  const stopped = job.status === "failed" || job.status === "cancelled" || job.status === "interrupted";
  const pending = job.status === "awaiting_review" ? [...job.checkpoints].reverse().find((entry) => entry.stage === job.stage && !entry.decision) : undefined;
  const earlier = job.checkpoints.filter((entry) => entry !== pending && entry.stage !== "build");
  const delivery = [...job.checkpoints].reverse().find((entry) => entry.stage === "build");

  return (
    <>
      <PaperPageHeader
        className="mt-3"
        title={job.title}
        description={[`${job.request.durationSec}s`, job.request.formats.join(" + "), job.request.style ?? "style chosen by Claude", job.skill.ref, `started ${formatRelativeTime(job.createdAt)}`].join(" · ")}
        actions={
          <>
            <AnimateStatus job={job} className="mr-2" />
            {live || job.status === "awaiting_review" ? (
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

      <div className="mt-6">
        <Stepper job={job} />
      </div>

      {job.error ? (
        <p role="alert" className="mt-6 max-w-[80ch] border border-paper-flame-deep px-4 py-3 text-[13.5px] leading-6 text-paper-flame-deep">
          {job.error}
          {stopped ? " Resume carries on in the same session, with everything it has made so far." : ""}
        </p>
      ) : null}

      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-14">
          {films.length > 0 ? <Films films={films} /> : null}
          {delivery ? (
            <PaperSection label="Delivery · measured checks">
              <Notes checkpoint={delivery} />
            </PaperSection>
          ) : null}
          {job.status === "completed" ? <Revise job={job} /> : null}

          {pending ? <Gate job={job} checkpoint={pending} /> : null}

          {live ? (
            <PaperSection label={ANIMATE_STAGE_LABEL[job.stage]}>
              <p className="max-w-[60ch] text-[13.5px] leading-6 text-paper-sage">
                {job.status === "queued"
                  ? "Waiting for the studio. One stage runs at a time."
                  : job.stage === "build"
                    ? "Claude is animating, scoring, rendering and running the review checks. This is the long part: often 20 to 40 minutes."
                    : `Claude is working on the ${ANIMATE_STAGE_LABEL[job.stage].toLowerCase()}. It stops here for your review when it's ready.`}
              </p>
            </PaperSection>
          ) : null}

          {earlier.length > 0 ? (
            <PaperSection label="Earlier reviews" count={earlier.length}>
              <ol className="space-y-8">
                {[...earlier].reverse().map((checkpoint) => (
                  <li key={`${checkpoint.stage}-${checkpoint.at}`}>
                    <details>
                      <summary className={cn("cursor-pointer text-[14px] font-semibold text-paper-moss hover:text-paper-blue", PAPER_FOCUS)}>
                        {ANIMATE_STAGE_LABEL[checkpoint.stage]} · {checkpoint.decision === "approved" ? "approved" : checkpoint.decision === "changes" ? "changes asked for" : "open"}
                        <span className="ml-2 text-[12.5px] font-normal text-paper-sage">{formatRelativeTime(checkpoint.at)}</span>
                      </summary>
                      <div className="mt-4">
                        {checkpoint.note ? <p className="mb-4 max-w-[72ch] border-l-2 border-paper-blue pl-3 text-[13.5px] leading-6 text-paper-char">You said: {checkpoint.note}</p> : null}
                        <Notes checkpoint={checkpoint} />
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </PaperSection>
          ) : null}

          {job.summary && job.status === "completed" ? (
            <PaperSection label="Claude's summary">
              <p className="max-w-[72ch] text-[14px] leading-7 whitespace-pre-wrap text-paper-moss">{job.summary}</p>
            </PaperSection>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-12">
          <StudioLog entries={job.log} live={live} />
          <details className="border-t border-paper-mist pt-4">
            <summary className={cn("cursor-pointer text-[13px] font-medium text-paper-char hover:text-paper-moss", PAPER_FOCUS)}>What Claude was told</summary>
            <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">
              Skill: {job.skill.ref} {job.skill.version}. Later stages add the stage's task to the same session.
            </p>
            <pre className="mt-3 max-h-72 overflow-auto border border-paper-mist bg-paper-linen p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-paper-moss">{job.prompt}</pre>
          </details>
        </aside>
      </div>
    </>
  );
}

/** Claude's notes for a checkpoint, then its frames. Frames open in a viewer on this page. */
function Notes({ checkpoint }: { checkpoint: AnimateCheckpoint }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-6">
      {checkpoint.images.length > 0 ? (
        <ul className={cn("grid gap-3", checkpoint.images.length === 1 ? "grid-cols-1" : "grid-cols-2 xl:grid-cols-3")}>
          {checkpoint.images.map((image, index) => (
            <li key={image.name}>
              <button type="button" onClick={() => setOpen(index)} aria-label={`Enlarge ${image.name}`} className={cn("block w-full cursor-zoom-in bg-paper-moss", PAPER_FOCUS)}>
                <img src={image.url} alt={image.name} loading="lazy" className="w-full" />
              </button>
              <p className="mt-1 text-[12px] text-paper-sage">{image.name.replace(/\.[a-z]+$/i, "")}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {checkpoint.notes ? <Markdown tone="paper" content={checkpoint.notes} className="max-w-[78ch] [&_h1]:text-[22px] [&_h1]:leading-7 [&_h2]:text-[17px]" /> : null}
      {open !== null ? <FrameViewer images={checkpoint.images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** A frame at full size, over the page. Arrow keys step through; Escape closes. */
function FrameViewer({ images, index, onIndex, onClose }: { images: AnimateCheckpoint["images"]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onIndex(Math.min(images.length - 1, index + 1));
      if (event.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, index, onClose, onIndex]);

  const image = images[index];
  return (
    <div role="dialog" aria-modal="true" aria-label={image.name} className="fixed inset-0 z-50 grid place-items-center bg-paper-moss/90 p-4" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close" className={cn("absolute top-4 right-4 grid size-11 cursor-pointer place-items-center bg-paper-white text-paper-moss", PAPER_FOCUS)}>
        <X className="size-4" aria-hidden="true" />
      </button>
      <img src={image.url} alt={image.name} className="max-h-[88vh] max-w-full" onClick={(event) => event.stopPropagation()} />
      {images.length > 1 ? <p className="absolute bottom-4 text-[13px] text-paper-white tabular-nums">{index + 1} of {images.length} · arrow keys to step</p> : null}
    </div>
  );
}

/** The decision at a review gate. */
function Gate({ job, checkpoint }: { job: AnimateJob; checkpoint: AnimateCheckpoint }) {
  const decide = useDecideAnimateJob();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  const next = ANIMATE_STAGES[ANIMATE_STAGES.indexOf(job.stage) + 1];
  const label = ANIMATE_STAGE_LABEL[job.stage];

  return (
    <PaperSection label={`${label} · your review`}>
      <Notes checkpoint={checkpoint} />

      <div className="sticky bottom-0 z-10 mt-8 border-t border-paper-mist bg-background py-4">
        {changing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim()) decide.mutate({ id: job.id, decision: "changes", note });
            }}
          >
            <label className="block">
              <FieldLabel>What should change?</FieldLabel>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                autoFocus
                placeholder={job.stage === "story" ? "Different angle: start from the audience's problem. Cut beat 4." : job.stage === "look" ? "Frame 2 is right. Frame 1 is too busy; warmer paper." : "Panels 3 and 7 are down: 3 needs the hero in frame."}
                className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <PaperButton type="submit" variant="amber" disabled={!note.trim() || decide.isPending}>
                {decide.isPending ? "Sending…" : "Send changes"}
              </PaperButton>
              <PaperButton type="button" variant="ghost" onClick={() => setChanging(false)} disabled={decide.isPending}>
                Back
              </PaperButton>
              <span className="text-[12.5px] text-paper-sage">Claude redoes the {label.toLowerCase()} and stops here again.</span>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <PaperButton variant="amber" className="min-h-11 px-5" onClick={() => decide.mutate({ id: job.id, decision: "approve" })} disabled={decide.isPending}>
              <Check className="size-3.5" aria-hidden="true" />
              {decide.isPending ? "Approving…" : `Approve ${label.toLowerCase()}`}
            </PaperButton>
            <PaperButton variant="ghost" className="min-h-11" onClick={() => setChanging(true)} disabled={decide.isPending}>
              Request changes
            </PaperButton>
            <span className="text-[12.5px] text-paper-sage">{next === "build" ? "Approving starts the build, which can take 20 to 40 minutes." : `Next: ${ANIMATE_STAGE_LABEL[next]}.`}</span>
          </div>
        )}
        {decide.isError ? (
          <p role="alert" className="mt-3 text-[13.5px] text-paper-flame-deep">
            {decide.error instanceof Error ? decide.error.message : "That could not be sent."}
          </p>
        ) : null}
      </div>
    </PaperSection>
  );
}

function Revise({ job }: { job: AnimateJob }) {
  const resume = useResumeAnimateJob();
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
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="The ending lands too late. Give the payoff hit more silence before it." className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")} />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <PaperButton type="submit" variant="ghost" disabled={!note.trim() || resume.isPending}>
            {resume.isPending ? "Sending…" : "Revise the video"}
          </PaperButton>
          <span className="text-[12.5px] text-paper-sage">Claude rebuilds in the same session and runs the review checks again. The new cut is filed beside this one.</span>
        </div>
      </form>
    </PaperSection>
  );
}
