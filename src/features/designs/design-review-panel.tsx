import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type {
  DesignBriefProposal,
  DesignReview,
  DesignReviewMode,
} from "@shared/design-intelligence-types";
import {
  CommandButton,
  FilterBar,
  HairlineCard,
  SectionLabel,
  StatusPill,
} from "@/components/os";
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
    <HairlineCard className={className}>
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionLabel>Visual review</SectionLabel>
            <p className="mt-2 text-[15px] leading-6 text-foreground">
              {assetIds.length} reference{assetIds.length === 1 ? "" : "s"}{" "}
              selected
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close visual review"
            className="os-focus-ring rounded-md p-1 text-os-subtle transition-colors hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* The state that decides whether any of this is worth anything. An
            enabled-but-unconfigured vision toolset would answer confidently
            without having looked, so the review is not offered at all. */}
        {!vision ? (
          <div className="mt-5 border-t border-os-border pt-5">
            <StatusPill status="blocked" label="Vision unavailable" />
            <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-muted">
              {capabilities?.visionReason ??
                "Hermes cannot inspect images on this machine."}
            </p>
            <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
              Without it Hermes would still answer — from the filenames and the
              project notes — and nothing in the reply would tell you it had not
              looked at anything. So the review is not offered.
            </p>
          </div>
        ) : !review ? (
          <>
            {projects.length > 0 ? (
              <div className="mt-6">
                <SectionLabel>Project</SectionLabel>
                <FilterBar<string>
                  label="Choose a project"
                  className="mt-3"
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
              <SectionLabel>Mode</SectionLabel>
              <FilterBar<DesignReviewMode>
                label="Choose a review mode"
                className="mt-3"
                value={mode}
                onChange={setMode}
                options={MODES.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                }))}
              />
              <p className="os-meta mt-2 text-os-subtle">
                {MODES.find((entry) => entry.value === mode)?.hint}
              </p>
            </div>

            <label className="mt-6 block">
              <SectionLabel>Question (optional)</SectionLabel>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                placeholder="What direction should the Chef screen take?"
                className="os-focus-ring mt-3 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[14px] leading-6 text-foreground placeholder:text-os-subtle"
              />
            </label>

            <div className="mt-6">
              <CommandButton
                variant="primary"
                onClick={analyse}
                loading={start.isPending}
                loadingLabel="Starting"
              >
                Analyse
              </CommandButton>
            </div>
          </>
        ) : (
          <div className="mt-5 border-t border-os-border pt-5">
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
          <p className="mt-5 text-[13px] leading-5 text-os-danger">{failure}</p>
        ) : null}
      </div>
    </HairlineCard>
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
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={item.title} className="flex gap-3">
            {numbered ? (
              // Numbered because a design review is read as a list of findings,
              // and a person needs to be able to point at the third one.
              <span className="os-meta shrink-0 pt-0.5 font-mono tabular-nums text-os-subtle">
                {String(index + 1).padStart(2, "0")}
              </span>
            ) : (
              <span className="shrink-0 pt-1 text-os-amber" aria-hidden="true">
                →
              </span>
            )}
            <span className="min-w-0">
              <span className="block max-w-[62ch] text-[14px] leading-6 text-foreground">
                {item.title}
              </span>
              {item.detail !== item.title ? (
                <span className="mt-0.5 block max-w-[62ch] text-[13px] leading-5 text-os-muted">
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
        <StatusPill status="running" label="Analysing" />
        <ul className="mt-4 space-y-1.5">
          {progress.length === 0 ? (
            <li className="text-[13px] leading-5 text-os-subtle">
              Waiting for Hermes to pick up the run…
            </li>
          ) : (
            progress.map((line, index) => (
              <li
                key={`${line}-${index}`}
                className={cn(
                  "text-[13px] leading-5",
                  index === progress.length - 1
                    ? "text-os-muted"
                    : "text-os-subtle",
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
        <StatusPill status="blocked" label="Review failed" />
        <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-muted">
          {review.error ?? "The review did not finish."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status="completed" label="Review complete" />
        <span className="os-meta text-os-subtle">
          {review.mode.replace(/-/g, " ")} · {review.assetIds.length} reference
          {review.assetIds.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-4 max-w-[62ch] text-[15px] leading-6 text-os-muted">
        {review.summary}
      </p>

      {/* Observation and recommendation stay visually apart, because merging
          them is how a model's opinion becomes a finding. */}
      <InsightList label="Patterns" items={review.patterns} numbered />
      <InsightList label="Recommendations" items={review.recommendations} />

      {review.avoid?.length ? (
        <div className="mt-6">
          <SectionLabel>Avoid</SectionLabel>
          <ul className="mt-3 space-y-1.5">
            {review.avoid.map((item) => (
              <li
                key={item}
                className="flex max-w-[62ch] gap-2 text-[13px] leading-5 text-os-muted"
              >
                <span className="text-os-danger" aria-hidden="true">
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
          <SectionLabel>Implementation notes</SectionLabel>
          <ul className="mt-3 space-y-1.5">
            {review.implementationNotes.map((item) => (
              <li
                key={item}
                className="max-w-[62ch] text-[13px] leading-5 text-os-muted"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.bestNextMove ? (
        <div className="mt-6 border-t border-os-border pt-5">
          <SectionLabel>Best next move</SectionLabel>
          <p className="mt-2 max-w-[62ch] text-[14px] leading-6 text-foreground">
            {review.bestNextMove}
          </p>
        </div>
      ) : null}

      {/* Promoting a review into the project. The one step here that writes
          anything a person would have to live with. */}
      <div className="mt-6 border-t border-os-border pt-5">
        <SectionLabel>Design brief</SectionLabel>

        {!proposal ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={feature}
                onChange={(event) => onFeature(event.target.value)}
                placeholder="AI Chef"
                aria-label="Feature the brief is about"
                className="os-focus-ring min-h-9 min-w-[200px] flex-1 rounded-md border border-os-border bg-transparent px-3 text-[14px] leading-5 text-foreground placeholder:text-os-subtle"
              />
              <CommandButton
                variant="quiet"
                onClick={onDraft}
                disabled={feature.trim().length === 0}
                loading={drafting}
                loadingLabel="Drafting"
              >
                Draft brief
              </CommandButton>
            </div>
            <p className="os-meta mt-2 text-os-subtle">
              Drafted from this review — nothing is written to the project until
              you approve it
            </p>
          </>
        ) : (
          <div className="mt-3">
            <p className="font-mono text-[12px] leading-5 break-all text-os-amber">
              {proposal.path}
            </p>
            {proposal.exists ? (
              <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-warning">
                A file already exists there. Saving replaces it.
              </p>
            ) : null}

            <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-os-border p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-os-muted">
              {proposal.markdown}
            </pre>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <CommandButton
                variant="primary"
                onClick={onSave}
                disabled={saved}
                loading={saving}
                loadingLabel="Saving"
              >
                {saved ? "Saved to project" : "Save to project"}
              </CommandButton>
              {saved ? (
                <Check
                  className="size-4 text-os-success"
                  strokeWidth={1.5}
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
