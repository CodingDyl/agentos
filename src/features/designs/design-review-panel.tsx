import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type {
  DesignBriefProposal,
  DesignReview,
  DesignReviewMode,
} from "@shared/design-intelligence-types";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperButton,
  PaperCard,
  PaperFilterBar,
  Tag,
} from "@/components/paper";
import {
  useAgentCapabilities,
  useFinaliseDesignReview,
  useProjects,
  useProposeDesignBrief,
  useSaveDesignBrief,
  useStartDesignReview,
} from "@/lib/agentos/queries";
import { readSseStream } from "@/features/agent/sse";
import { cn } from "@/lib/utils";

/**
 * Reading a set of design references as project context.
 *
 * The panel has one job beyond showing the answer: making it obvious what the
 * answer is worth. A design opinion reads the same whether the model looked at
 * the images or guessed from their filenames, so the two states this screen
 * treats most carefully are the ones where it cannot see — vision unconfigured,
 * and a review that came back unreadable. Both say so plainly rather than
 * presenting a confident summary of nothing.
 */

const MODES: { value: DesignReviewMode; label: string; hint: string }[] = [
  {
    value: "direction",
    label: "Direction",
    hint: "What these suggest for the project",
  },
  { value: "critique", label: "Critique", hint: "What is wrong with them" },
  { value: "compare", label: "Compare", hint: "What to take from each" },
  {
    value: "design-system",
    label: "Design system",
    hint: "Colour, type, spacing, surfaces",
  },
];

export interface DesignReviewPanelProps {
  assetIds: string[];
  onClose: () => void;
  className?: string;
}

export function DesignReviewPanel({
  assetIds,
  onClose,
  className,
}: DesignReviewPanelProps) {
  const { data: capabilities } = useAgentCapabilities();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const start = useStartDesignReview();
  const finalise = useFinaliseDesignReview();
  const propose = useProposeDesignBrief();
  const save = useSaveDesignBrief();

  const [project, setProject] = useState(projects[0]?.slug ?? "agentos");
  const [mode, setMode] = useState<DesignReviewMode>("direction");
  const [question, setQuestion] = useState("");
  const [review, setReview] = useState<DesignReview>();
  const [progress, setProgress] = useState<string[]>([]);

  const [feature, setFeature] = useState("");
  const [proposal, setProposal] = useState<DesignBriefProposal>();
  const [saved, setSaved] = useState(false);

  const vision = capabilities?.vision === true;

  /**
   * Follows the run while it works.
   *
   * The review is an ordinary Hermes run, so this reads the same event stream
   * the agent screen uses. Only tool boundaries are shown — the point is to
   * make a long analysis legible, not to reproduce the transcript.
   */
  const streamed = useRef<string | undefined>(undefined);

  useEffect(() => {
    const runId = review?.runId;

    if (!runId || review?.status !== "pending") return;
    // A re-render must not open a second stream on the same run.
    if (streamed.current === runId) return;

    streamed.current = runId;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/agent/runs/${runId}/events`, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (response.body) {
          await readSseStream(response.body, (message) => {
            const line = describeEvent(message.event, message.data);
            if (line) setProgress((current) => [...current.slice(-8), line]);
          });
        }
      } catch {
        // A dropped stream is not a failed review: the run continues, and the
        // finalise below reads whatever it produced.
      }

      if (controller.signal.aborted) return;

      const next = await finalise.mutateAsync(review.id).catch(() => undefined);
      if (next) setReview(next);
    })();

    return () => controller.abort();
  }, [review?.runId, review?.status, review?.id, finalise]);

  const analyse = () => {
    if (start.isPending) return;

    setProgress([]);
    setReview(undefined);

    start.mutate(
      {
        project,
        assetIds,
        mode,
        question: question.trim() || undefined,
      },
      { onSuccess: setReview },
    );
  };

  const draftBrief = () => {
    if (!review || !feature.trim()) return;

    setSaved(false);
    propose.mutate(
      { reviewId: review.id, feature: feature.trim() },
      { onSuccess: setProposal },
    );
  };

  const failure =
    start.error instanceof Error
      ? start.error.message
      : propose.error instanceof Error
        ? propose.error.message
        : save.error instanceof Error
          ? save.error.message
          : undefined;

  return (
    <PaperCard className={cn("p-5", className)}>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">Visual review</h2>
            <p className="mt-1 text-[14px] leading-6 text-paper-char">
              {assetIds.length} reference{assetIds.length === 1 ? "" : "s"}{" "}
              selected
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close visual review"
            className={cn("rounded-none p-1 text-paper-sage transition-colors hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {/* The state that decides whether any of this is worth anything. An
            enabled-but-unconfigured vision toolset would answer confidently
            without having looked, so the review is not offered at all. */}
        {!vision ? (
          <div className="mt-5 border-t border-paper-mist pt-5">
            <Tag tone="flame">Vision unavailable</Tag>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
              {capabilities?.visionReason ??
                "Hermes cannot inspect images on this machine."}
            </p>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-5 text-paper-sage">
              Without it Hermes would still answer (from the filenames and the
              project notes), and nothing in the reply would tell you it had not
              looked at anything. So the review is not offered.
            </p>
          </div>
        ) : !review ? (
          <>
            {projects.length > 0 ? (
              <div className="mt-6">
                <FieldLabel>Workspace</FieldLabel>
                <PaperFilterBar<string>
                  label="Choose a workspace"
                  value={project}
                  onChange={setProject}
                  options={projects.map((entry) => ({
                    value: entry.slug,
                    label: entry.name,
                  }))}
                />
              </div>
            ) : null}

            <div className="mt-6">
              <FieldLabel>Mode</FieldLabel>
              <PaperFilterBar<DesignReviewMode>
                label="Choose a review mode"
                value={mode}
                onChange={setMode}
                options={MODES.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                }))}
              />
              <p className="mt-2 text-[13px] text-paper-sage">
                {MODES.find((entry) => entry.value === mode)?.hint}
              </p>
            </div>

            <label className="mt-6 block">
              <FieldLabel>Question (optional)</FieldLabel>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                placeholder="What direction should the Chef screen take?"
                className={cn(PAPER_INPUT, "w-full resize-y py-2.5 leading-6")}
              />
            </label>

            <div className="mt-6">
              <PaperButton variant="amber" onClick={analyse} disabled={start.isPending}>
                {start.isPending ? "Starting…" : "Analyse"}
              </PaperButton>
            </div>
          </>
        ) : (
          <div className="mt-5 border-t border-paper-mist pt-5">
            <ReviewResult
              review={review}
              progress={progress}
              feature={feature}
              onFeature={setFeature}
              onDraft={draftBrief}
              drafting={propose.isPending}
              proposal={proposal}
              saved={saved}
              saving={save.isPending}
              onSave={() => {
                if (!proposal) return;
                save.mutate(proposal, { onSuccess: () => setSaved(true) });
              }}
            />
          </div>
        )}

        {failure ? (
          <p role="alert" className="mt-5 text-[13.5px] leading-5 text-paper-flame-deep">{failure}</p>
        ) : null}
      </div>
    </PaperCard>
  );
}

/**
 * One run event, as a line worth reading.
 *
 * Most of the stream is not: token deltas and bookkeeping say nothing about
 * where a long analysis has got to. Tool boundaries do, so those are kept and
 * everything else is dropped.
 */
function describeEvent(event: string, data: string): string | undefined {
  if (!/tool|status|step/i.test(event)) return undefined;

  try {
    const parsed: unknown = JSON.parse(data);
    const record = typeof parsed === "object" && parsed !== null ? parsed : {};
    const name = (record as { tool?: string; name?: string }).tool ??
      (record as { name?: string }).name;

    if (typeof name === "string" && name.length > 0) {
      return name === "vision_analyze" ? "Looking at a reference" : name;
    }
  } catch {
    // Not JSON. The event name alone is still a boundary worth showing.
  }

  return event.replace(/[._]/g, " ");
}

function InsightList({
  label,
  items,
  numbered,
}: {
  label: string;
  items: { title: string; detail: string }[];
  numbered?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-[13.5px] font-semibold text-paper-moss">{label}</h3>
      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={item.title} className="flex gap-3">
            {numbered ? (
              // Numbered because a design review is read as a list of findings,
              // and a person needs to be able to point at the third one.
              <span className="shrink-0 pt-0.5 font-mono text-[12.5px] tabular-nums text-paper-sage">
                {String(index + 1).padStart(2, "0")}
              </span>
            ) : (
              <span className="shrink-0 pt-0.5 text-paper-amber-deep" aria-hidden="true">
                →
              </span>
            )}
            <span className="min-w-0">
              <span className="block max-w-[62ch] text-[14px] leading-6 text-paper-moss">
                {item.title}
              </span>
              {item.detail !== item.title ? (
                <span className="mt-0.5 block max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
                  {item.detail}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewResult({
  review,
  progress,
  feature,
  onFeature,
  onDraft,
  drafting,
  proposal,
  saved,
  saving,
  onSave,
}: {
  review: DesignReview;
  progress: string[];
  feature: string;
  onFeature: (value: string) => void;
  onDraft: () => void;
  drafting: boolean;
  proposal?: DesignBriefProposal;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  if (review.status === "pending") {
    return (
      <div>
        <Tag tone="marigold">Analysing</Tag>
        <ul className="mt-4 space-y-1.5">
          {progress.length === 0 ? (
            <li className="text-[13.5px] leading-5 text-paper-sage">
              Waiting for Hermes to pick up the run…
            </li>
          ) : (
            progress.map((line, index) => (
              <li
                key={`${line}-${index}`}
                className={cn(
                  "text-[13.5px] leading-5",
                  index === progress.length - 1
                    ? "text-paper-char"
                    : "text-paper-sage",
                )}
              >
                {line}
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }

  if (review.status === "failed") {
    return (
      <div>
        <Tag tone="flame">Review failed</Tag>
        <p className="mt-3 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
          {review.error ?? "The review did not finish."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Tag tone="green">Review complete</Tag>
        <span className="text-[13px] text-paper-sage">
          {review.mode.replace(/-/g, " ")} · {review.assetIds.length} reference
          {review.assetIds.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-4 max-w-[62ch] text-[15px] leading-6 text-paper-char">
        {review.summary}
      </p>

      {/* Observation and recommendation stay visually apart, because merging
          them is how a model's opinion becomes a finding. */}
      <InsightList label="Patterns" items={review.patterns} numbered />
      <InsightList label="Recommendations" items={review.recommendations} />

      {review.avoid?.length ? (
        <div className="mt-6">
          <h3 className="text-[13.5px] font-semibold text-paper-moss">Avoid</h3>
          <ul className="mt-3 space-y-1.5">
            {review.avoid.map((item) => (
              <li
                key={item}
                className="flex max-w-[62ch] gap-2 text-[13.5px] leading-5 text-paper-char"
              >
                <span className="text-paper-flame-deep" aria-hidden="true">
                  ×
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.implementationNotes?.length ? (
        <div className="mt-6">
          <h3 className="text-[13.5px] font-semibold text-paper-moss">Implementation notes</h3>
          <ul className="mt-3 space-y-1.5">
            {review.implementationNotes.map((item) => (
              <li
                key={item}
                className="max-w-[62ch] text-[13.5px] leading-5 text-paper-char"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.bestNextMove ? (
        <div className="mt-6 border-t border-paper-mist pt-5">
          <h3 className="text-[13.5px] font-semibold text-paper-moss">Best next move</h3>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-6 text-paper-moss">
            {review.bestNextMove}
          </p>
        </div>
      ) : null}

      {/* Promoting a review into the project. The one step here that writes
          anything a person would have to live with. */}
      <div className="mt-6 border-t border-paper-mist pt-5">
        <h3 className="text-[13.5px] font-semibold text-paper-moss">Design brief</h3>

        {!proposal ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={feature}
                onChange={(event) => onFeature(event.target.value)}
                placeholder="AI Chef"
                aria-label="Feature the brief is about"
                className={cn(PAPER_INPUT, "min-w-[200px] flex-1")}
              />
              <PaperButton variant="ghost" onClick={onDraft} disabled={feature.trim().length === 0 || drafting}>
                {drafting ? "Drafting…" : "Draft brief"}
              </PaperButton>
            </div>
            <p className="mt-2 text-[13px] text-paper-sage">
              Drafted from this review. Nothing is written to the project until
              you approve it
            </p>
          </>
        ) : (
          <div className="mt-3">
            <p className="font-mono text-[12.5px] leading-5 break-all text-paper-moss">
              {proposal.path}
            </p>
            {proposal.exists ? (
              <p className="mt-2 max-w-[62ch] text-[13.5px] leading-5 font-medium text-paper-flame-deep">
                A file already exists there. Saving replaces it.
              </p>
            ) : null}

            <pre className="mt-3 max-h-64 overflow-auto rounded-none border border-paper-mist bg-paper-linen p-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-paper-char">
              {proposal.markdown}
            </pre>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <PaperButton variant="amber" onClick={onSave} disabled={saved || saving}>
                {saving ? "Saving…" : saved ? "Saved to project" : "Save to project"}
              </PaperButton>
              {saved ? (
                <Check
                  className="size-4 text-paper-char"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
