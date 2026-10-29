import { ExternalLink, FileDown, NotebookText } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "@/components/os";
import { Markdown } from "@/components/os/markdown";
import {
  FieldLabel,
  PAPER_INPUT,
  PaperBackLink,
  PaperButton,
  PaperError,
  PaperIndicator,
  PaperLoading,
  PaperNotice,
  PaperPageHeader,
  PaperSection,
  PaperStage,
  Tag,
} from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import {
  transcriptDownloadUrl,
  useDecideIdea,
  useIdeaAssessment,
  usePasteTranscript,
  useRetryIdea,
  useVideoIdea,
} from "@/lib/agentos/video-ideas";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS, type IdeaRun, type VideoIdea } from "@shared/video-ideas-types";
import { ideaStatus, noteHref, runLength } from "./idea-model";

/**
 * One video idea: its note, the assessment against AgentOS, the decision, and
 * — once approved — the build, one task at a time.
 */
export function IdeaPage() {
  const { id = "" } = useParams();
  const navigationItems = useNavigationItems();
  const idea = useVideoIdea(id);

  return (
    <AppShell navigationItems={navigationItems} pageId="learning" activeHref="/learning" agentState="idle" agentLabel="Learning" modelLabel="Model / Claude Code">
      <PaperStage>
        <PaperBackLink to="/learning">Learning</PaperBackLink>
        {idea.isPending ? <PaperLoading title="Loading" message="Reading the idea" /> : null}
        {idea.error ? <PaperError className="mt-4" title="This idea could not be read" detail={idea.error.message} onRetry={() => void idea.refetch()} /> : null}
        {idea.data ? <IdeaBody idea={idea.data} /> : null}
      </PaperStage>
    </AppShell>
  );
}

const VERDICT_TAG = { adopt: "green", adapt: "marigold", skip: "muted" } as const;

function IdeaBody({ idea }: { idea: VideoIdea }) {
  const status = ideaStatus(idea);
  const assessment = useIdeaAssessment(idea.id, Boolean(idea.assessmentPath));

  return (
    <div className="mt-3 pb-16">
      <PaperPageHeader
        title={idea.title}
        actions={
          <>
            {idea.notePath ? (
              <Link to={noteHref(idea.notePath)} className="inline-flex min-h-[var(--control-height)] items-center gap-1.5 border border-paper-ash bg-paper-linen px-3.5 text-[14px] font-medium text-paper-moss hover:bg-paper-stone">
                <NotebookText className="size-4" strokeWidth={1.75} aria-hidden="true" /> Open the note
              </Link>
            ) : null}
            <a href={transcriptDownloadUrl(idea.sourceId)} download className="inline-flex min-h-[var(--control-height)] items-center gap-1.5 px-3.5 text-[14px] font-medium text-paper-sage hover:bg-paper-stone hover:text-paper-moss">
              <FileDown className="size-4" strokeWidth={1.75} aria-hidden="true" /> Transcript
            </a>
            <a
              href={`https://www.youtube.com/watch?v=${idea.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[var(--control-height)] items-center gap-1.5 px-3.5 text-[14px] font-medium text-paper-sage hover:bg-paper-stone hover:text-paper-moss"
            >
              <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" /> YouTube
            </a>
          </>
        }
      />
      <PaperIndicator tone={status.tone} label={status.label} className="mt-2" />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-14">
        <div className="min-w-0 space-y-10">
          {idea.stage === "failed" ? <Stopped idea={idea} /> : null}
          {idea.stage === "needs_transcript" ? <PasteTranscript idea={idea} /> : null}
          {idea.stage === "awaiting_decision" ? <Decide idea={idea} /> : null}
          {idea.stage === "declined" ? (
            <PaperNotice>
              You declined this{idea.declineReason ? `: “${idea.declineReason}”` : "."} Later assessments take that into account.
            </PaperNotice>
          ) : null}
          {idea.plan?.length ? <BuildPlan idea={idea} /> : null}
          {idea.assessmentPath ? (
            <PaperSection label="Assessment">
              {assessment.data ? <Markdown tone="paper" content={assessment.data.markdown} className="max-w-[72ch]" /> : null}
              {assessment.error ? <p className="text-[13.5px] text-paper-flame-deep">{assessment.error.message}</p> : null}
            </PaperSection>
          ) : idea.mode === "learn" && idea.stage === "noted" ? (
            <PaperNotice>This one was only for learning. Your note is in Memory, tagged learning.</PaperNotice>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-8">
          {idea.verdict ? (
            <div>
              <FieldLabel>Verdict</FieldLabel>
              <div className="mt-1.5 flex items-center gap-2">
                <Tag tone={VERDICT_TAG[idea.verdict]}>{VERDICT_LABELS[idea.verdict]}</Tag>
                {idea.size ? <span className="text-[13px] text-paper-sage">{idea.size} change</span> : null}
              </div>
              {idea.verdictWhy ? <p className="mt-2 text-[14px] leading-6 text-paper-char">{idea.verdictWhy}</p> : null}
            </div>
          ) : null}
          <Runs runs={idea.runs} />
        </aside>
      </div>
    </div>
  );
}

function Decide({ idea }: { idea: VideoIdea }) {
  const decide = useDecideIdea();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <section aria-label="Decide" className="border border-paper-ash bg-paper-cream px-5 py-5">
      <h2 className="font-paper-display text-[19px] font-bold tracking-[-0.01em] text-paper-moss">Should AgentOS adopt this?</h2>
      <p className="mt-1.5 max-w-[64ch] text-[14px] leading-6 text-paper-char">
        Approving plans this and starts building it, one task at a time. You'll still review each change before it merges.
      </p>
      {declining ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            decide.mutate({ id: idea.id, decision: "decline", reason: reason.trim() || undefined });
          }}
        >
          <label className="block">
            <FieldLabel>Why not? (optional — it teaches later assessments)</FieldLabel>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} className={cn(PAPER_INPUT, "mt-1 w-full py-2")} />
          </label>
          <div className="mt-3 flex gap-2">
            <PaperButton type="submit" variant="danger" disabled={decide.isPending}>
              {decide.isPending ? "Declining…" : "Decline"}
            </PaperButton>
            <PaperButton variant="quiet" onClick={() => setDeclining(false)}>
              Back
            </PaperButton>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <PaperButton variant="amber" disabled={decide.isPending} onClick={() => decide.mutate({ id: idea.id, decision: "approve" })}>
            {decide.isPending ? "Approving…" : "Approve and build"}
          </PaperButton>
          <PaperButton variant="ghost" onClick={() => setDeclining(true)}>
            Decline
          </PaperButton>
        </div>
      )}
      {decide.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {decide.error.message}
        </p>
      ) : null}
    </section>
  );
}

function Stopped({ idea }: { idea: VideoIdea }) {
  const retry = useRetryIdea();
  const resuming = idea.failedAt === "building";
  return (
    <PaperError
      headingLevel="h2"
      title={resuming ? "The build paused" : "This stopped"}
      detail={idea.error}
      hint={resuming ? "Fix or retry the task in Workers, then resume to carry on from it." : undefined}
      onRetry={() => retry.mutate(idea.id)}
      isRetrying={retry.isPending}
    />
  );
}

function PasteTranscript({ idea }: { idea: VideoIdea }) {
  const paste = usePasteTranscript();
  const [text, setText] = useState("");
  return (
    <form
      aria-label="Paste a transcript"
      className="border border-paper-ash bg-paper-cream px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) paste.mutate({ id: idea.id, text });
      }}
    >
      <h2 className="font-paper-display text-[19px] font-bold tracking-[-0.01em] text-paper-moss">This video has no captions</h2>
      <p className="mt-1.5 max-w-[64ch] text-[14px] leading-6 text-paper-char">Paste a transcript and the note is written from it. Lines starting with a time like 01:05 keep it.</p>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} aria-label="Transcript" className={cn(PAPER_INPUT, "mt-3 w-full py-2 font-mono text-[12.5px]")} />
      <PaperButton type="submit" variant="amber" className="mt-3" disabled={!text.trim() || paste.isPending}>
        {paste.isPending ? "Saving…" : "Write the note"}
      </PaperButton>
      {paste.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {paste.error.message}
        </p>
      ) : null}
    </form>
  );
}

function taskState(idea: VideoIdea, index: number): { tone: "green" | "amber" | "flame" | "muted"; label: string } {
  const current = idea.currentTask ?? 0;
  if (idea.stage === "built" || index < current) return { tone: "green", label: "Merged" };
  if (index > current) return { tone: "muted", label: "Waiting" };
  if (idea.stage === "failed") return { tone: "flame", label: "Stopped" };
  return { tone: "amber", label: idea.jobId ? "In progress — review it in Workers when it's ready" : "Starting" };
}

function BuildPlan({ idea }: { idea: VideoIdea }) {
  const jobFor = (taskId: string | undefined) => [...idea.runs].reverse().find((run) => run.step === "build" && run.taskId === taskId)?.jobId;
  return (
    <PaperSection label="Build" count={idea.plan?.length}>
      <ol className="space-y-5">
        {idea.plan?.map((task, index) => {
          const taskId = idea.taskIds[index];
          const state = taskState(idea, index);
          const jobId = jobFor(taskId);
          return (
            <li key={taskId ?? index} className="border-t border-paper-mist pt-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[12.5px] text-paper-sage tabular-nums">{taskId}</span>
                <span className="text-[15px] font-medium text-paper-moss">{task.title}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <PaperIndicator tone={state.tone} label={state.label} />
                {jobId ? (
                  <Link to={`/workers/jobs/${encodeURIComponent(jobId)}`} className="text-[13px] font-medium text-paper-blue hover:underline">
                    Open the job
                  </Link>
                ) : null}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-[13px] text-paper-sage hover:text-paper-moss">What it builds</summary>
                <p className="mt-2 max-w-[72ch] text-[14px] leading-6 whitespace-pre-wrap text-paper-char">{task.objective}</p>
                {task.acceptanceCriteria.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-6 text-paper-char">
                    {task.acceptanceCriteria.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </details>
            </li>
          );
        })}
      </ol>
    </PaperSection>
  );
}

const STEP_LABEL: Record<IdeaRun["step"], string> = { note: "Note", assessment: "Assessment", plan: "Plan", build: "Build" };

/** Who ran each step and for how long: the cost of the idea, in the open. */
function Runs({ runs }: { runs: readonly IdeaRun[] }) {
  if (runs.length === 0) return null;
  return (
    <div>
      <FieldLabel>Runs</FieldLabel>
      <ul className="mt-1.5 divide-y divide-paper-mist">
        {runs.map((run, index) => (
          <li key={`${run.step}-${run.jobId ?? index}`} className="py-2 text-[13px] leading-5">
            <span className="font-medium text-paper-moss">
              {STEP_LABEL[run.step]}
              {run.taskId ? ` · ${run.taskId}` : ""}
            </span>
            <span className="block text-paper-sage">
              {run.worker} · {runLength(run.startedAt, run.endedAt)}
              {run.endedAt ? "" : " so far"}
              {run.status && run.status !== "completed" ? ` · ${run.status}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
