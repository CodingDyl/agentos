import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink } from "lucide-react";
import {
  budgetBreakdown,
  MOTION_WIZARD_STEP_LABEL,
  type MotionRunView,
} from "@shared/motion-design-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperError, Tag } from "@/components/paper";
import { useApproveMotionConcept, useMotionForWorkspace, useSendMotionNotes } from "@/lib/agentos/motion-design";
import { cn } from "@/lib/utils";

export function WorkspaceMotionTab({ slug }: { slug: string }) {
  const query = useMotionForWorkspace(slug);
  if (query.isPending) return <p role="status">Loading Motion Design…</p>;
  if (query.error) {
    return <PaperError title="Motion Design could not be read." detail={query.error.message} onRetry={() => void query.refetch()} isRetrying={query.isFetching} headingLevel="h2" />;
  }
  if (!query.data) {
    return <p className="text-[13.5px] text-paper-sage">This workspace has no Motion Design run.</p>;
  }
  return <MotionRunViewPanel run={query.data} />;
}

function MotionRunViewPanel({ run }: { run: MotionRunView }) {
  const approve = useApproveMotionConcept(run.id);
  const notes = useSendMotionNotes(run.id);
  const [conceptId, setConceptId] = useState(run.approval?.conceptId ?? run.concepts.find((concept) => concept.recommended)?.id ?? run.concepts[0]?.id ?? "");
  const [ceiling, setCeiling] = useState(run.budgetCeiling ?? run.approval?.ceiling ?? 330);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const selected = run.concepts.find((concept) => concept.id === conceptId);
  const split = selected ? budgetBreakdown(ceiling, selected.plannedCredits) : undefined;
  const job = run.job;
  const progress = run.progress;

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-paper-display text-[24px] font-bold tracking-[-0.01em] text-paper-moss">Motion Design</h2>
          <p className="mt-1 text-[13.5px] text-paper-char">
            {MOTION_WIZARD_STEP_LABEL[run.step]} · {run.brief.brandName || run.workspaceSlug}
            {run.codeOnly ? " · code-only motion" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {job ? (
            <Link to={job.href} className="text-[13px] text-paper-blue hover:underline">
              Open worker job
            </Link>
          ) : null}
          <Link to={`/coder?workspace=${encodeURIComponent(run.workspaceSlug)}`} className="inline-flex items-center gap-1 text-[13px] text-paper-blue hover:underline">
            Open in Coder
          </Link>
        </div>
      </header>

      {run.error ? <PaperError title="The run failed." detail={run.error} headingLevel="h2" /> : null}
      {job?.error && job.error !== run.error ? <PaperError title="Claude Code stopped." detail={job.error} headingLevel="h2" /> : null}

      {run.status === "awaiting_approval" || (run.concepts.length > 0 && !run.approval && !run.codeOnly) ? (
        <PaperCard className="border-paper-marigold p-4">
          <h3 className="font-paper-display text-[17px] font-bold">Pick a concept and a credit ceiling</h3>
          <p className="mt-1 max-w-[68ch] text-[13.5px] leading-5 text-paper-char">
            The skill proposed two ideas. One Approve click authorizes that concept plus this ceiling. Any later request to go over it needs a new approval. You decide never authorizes spend.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {run.concepts.map((concept) => (
              <li key={concept.id}>
                <button
                  type="button"
                  onClick={() => {
                    setConceptId(concept.id);
                    setCeiling((current) => Math.max(current, Math.ceil(concept.plannedCredits / 0.85)));
                  }}
                  className={cn("h-full w-full border p-3 text-left", conceptId === concept.id ? "border-paper-blue" : "border-paper-mist")}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{concept.title}</span>
                    {concept.recommended ? <Tag tone="blue">Recommended</Tag> : null}
                  </span>
                  <span className="mt-2 block text-[13px] leading-5 text-paper-char">{concept.summary}</span>
                  <span className="mt-2 block text-[12.5px] tabular-nums text-paper-sage">Planned {concept.plannedCredits} credits</span>
                  {concept.itemized.length > 0 ? (
                    <ul className="mt-2 text-[12.5px] text-paper-char">
                      {concept.itemized.map((item) => (
                        <li key={item.label}>
                          {item.label} · {item.credits}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {split ? (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
              <div>
                <dt className="text-paper-sage">Planned spend</dt>
                <dd className="font-medium tabular-nums">{split.planned}</dd>
              </div>
              <div>
                <dt className="text-paper-sage">15% reserve</dt>
                <dd className="font-medium tabular-nums">{split.reserve}</dd>
              </div>
              <div>
                <dt className="text-paper-sage">Max ceiling</dt>
                <dd className="font-medium tabular-nums">{split.ceiling}</dd>
              </div>
            </dl>
          ) : null}
          <label className="mt-3 block">
            <FieldLabel>Credit ceiling</FieldLabel>
            <input type="number" min={1} className={cn(PAPER_INPUT, "w-40")} value={ceiling} onChange={(event) => setCeiling(Number(event.target.value))} />
          </label>
          <textarea className={cn(PAPER_INPUT, "mt-3 w-full py-2")} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
          <PaperButton
            variant="amber"
            className="mt-4"
            disabled={!conceptId || approve.isPending}
            onClick={() => approve.mutate({ conceptId, ceiling, note: note.trim() || undefined })}
          >
            {approve.isPending ? "Approving…" : "Approve concept and ceiling"}
          </PaperButton>
          {approve.error instanceof Error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{approve.error.message}</p> : null}
        </PaperCard>
      ) : null}

      {run.approval ? (
        <p className="text-[13.5px] text-paper-char">
          Approved concept {run.approval.conceptId} with a ceiling of {run.approval.ceiling} credits (planned {run.approval.plannedCredits}).
        </p>
      ) : null}

      {progress ? (
        <section>
          <h3 className="font-paper-display text-[17px] font-bold">Progress</h3>
          <ol className="mt-3 grid gap-2">
            {progress.stages.map((stage) => (
              <li key={stage.id} className="flex items-center gap-2 text-[13.5px]">
                {stage.status === "complete" ? <CheckCircle2 className="size-4 text-paper-green" /> : <span className={cn("size-2 rounded-full", stage.status === "in_progress" ? "bg-paper-amber" : "bg-paper-ash")} />}
                <span className={stage.status === "not_started" ? "text-paper-sage" : "text-paper-moss"}>
                  {stage.label}
                  {stage.status === "in_progress" ? " · in progress" : ""}
                </span>
              </li>
            ))}
          </ol>
          {progress.error ? <PaperError className="mt-4" title="A stage reported a failure." detail={progress.error} headingLevel="h2" /> : null}

          {progress.reviewLog.length > 0 ? (
            <div className="mt-6">
              <h4 className="font-medium">Review log</h4>
              <ul className="mt-2 grid gap-3">
                {progress.reviewLog.map((entry, index) => (
                  <li key={`${entry.review}-${index}`} className="border border-paper-mist p-3">
                    <Tag tone="muted">{entry.review === "design" ? "Design rules" : entry.review === "craft" ? "Craft" : "Brief"}</Tag>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-paper-char">{entry.summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {progress.keyframes.length > 0 ? (
            <div className="mt-6">
              <h4 className="font-medium">Keyframes</h4>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {progress.keyframes.map((image) => (
                  <figure key={image.url} className="border border-paper-mist">
                    <img src={image.url} alt={image.name} className="aspect-video w-full object-cover" />
                    <figcaption className="truncate px-2 py-1 font-mono text-[11px]">{image.name}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          {progress.clips.length > 0 ? (
            <div className="mt-6">
              <h4 className="font-medium">Clips</h4>
              <div className="mt-2 grid gap-3">
                {progress.clips.map((clip) => (
                  <video key={clip.url} src={clip.url} controls className="w-full border border-paper-mist" />
                ))}
              </div>
            </div>
          ) : null}

          {progress.previewUrl ? (
            <p className="mt-4">
              <a href={progress.previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-paper-blue hover:underline">
                Latest preview <ExternalLink className="size-3.5" />
              </a>
            </p>
          ) : null}

          {progress.ledger ? (
            <div className="mt-6 overflow-x-auto">
              <h4 className="font-medium">Credit ledger</h4>
              <p className="mt-1 text-[12.5px] text-paper-sage">
                Spent {progress.ledger.spent} · pending {progress.ledger.pending} · committed {progress.ledger.committed}
              </p>
              <table className="mt-2 w-full text-left text-[12.5px]">
                <thead>
                  <tr className="text-paper-sage">
                    <th className="py-1 pr-3">When</th>
                    <th className="py-1 pr-3">Purpose</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Quoted</th>
                    <th className="py-1">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.ledger.rows.map((row, index) => (
                    <tr key={`${row.timestamp}-${index}`} className="border-t border-paper-stone">
                      <td className="py-1 pr-3 font-mono text-[11px]">{row.timestamp}</td>
                      <td className="py-1 pr-3">{row.purpose}</td>
                      <td className="py-1 pr-3">{row.status}</td>
                      <td className="py-1 pr-3 tabular-nums">{row.quotedCredits ?? "—"}</td>
                      <td className="py-1 tabular-nums">{row.actualCredits ?? (row.status === "pending" ? "pending" : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className="font-paper-display text-[17px] font-bold">Your notes</h3>
        <p className="mt-1 text-[13px] text-paper-sage">Sent into the job for the next round. Highest design priority.</p>
        <textarea className={cn(PAPER_INPUT, "mt-2 w-full py-2")} rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
        <PaperButton
          variant="amber"
          className="mt-3"
          disabled={!feedback.trim() || notes.isPending}
          onClick={() => notes.mutate(feedback.trim(), { onSuccess: () => setFeedback("") })}
        >
          {notes.isPending ? "Sending…" : "Send notes"}
        </PaperButton>
        {notes.error instanceof Error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{notes.error.message}</p> : null}
      </section>

      <section className="border border-dashed border-paper-ash p-4">
        <h3 className="font-paper-display text-[17px] font-bold text-paper-sage">Make it a business</h3>
        <p className="mt-1 max-w-[62ch] text-[13.5px] leading-5 text-paper-sage">
          Placeholder — out of scope for now. A later step will attach a MongoDB-backed business record to this motion site. Nothing here creates accounts, billing, or a backend.
        </p>
      </section>
    </div>
  );
}
