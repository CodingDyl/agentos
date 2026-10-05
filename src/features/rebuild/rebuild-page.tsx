import { useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, RotateCcw } from "lucide-react";
import {
  GATED_STAGES,
  HERO_CONCEPTS,
  REBUILD_FUNCTION_LABEL,
  REBUILD_STAGES,
  type RebuildArtifact,
  type RebuildRun,
  type RebuildStage,
} from "@shared/website-rebuild-types";
import { AppShell } from "@/components/os";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperSection, PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import { useDecideStage, useRebuild, useRetryStage } from "@/lib/agentos/rebuilds";
import { cn } from "@/lib/utils";
import { StageStatusTag } from "./rebuild-status";

/**
 * One client website rebuild: the seven stages, what each produced, what is
 * happening now, and the checkpoints where you approve or ask for changes.
 * It polls while a stage is working, so you can leave it open and follow along.
 */
export function RebuildPage() {
  const navigationItems = useNavigationItems();
  const { id } = useParams<{ id: string }>();
  const rebuild = useRebuild(id);
  const run = rebuild.data;

  return (
    <AppShell navigationItems={navigationItems} pageId="traction" activeHref="/traction" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        {rebuild.isPending ? (
          <p role="status">Loading the rebuild…</p>
        ) : rebuild.error || !run ? (
          <p role="alert" className="border border-paper-flame-deep p-3 text-paper-flame-deep">
            {rebuild.error?.message ?? "That rebuild could not be found."}
          </p>
        ) : (
          <RebuildView run={run} />
        )}
      </PaperStage>
    </AppShell>
  );
}

/** The whole rebuild. `inWorkspace` drops what the workspace page already shows: the breadcrumb and the workspace link. */
export function RebuildView({ run, inWorkspace = false }: { run: RebuildRun; inWorkspace?: boolean }) {
  const done = run.stages.filter((stage) => stage.status === "complete").length;
  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {inWorkspace ? (
            <h2 className="font-paper-display text-[24px] leading-none font-bold tracking-[-0.01em] text-paper-moss">Website rebuild</h2>
          ) : (
            <>
              <p className="text-[13px] text-paper-sage">
                <Link to="/traction?tab=prospects" className="hover:underline">
                  Traction
                </Link>{" "}
                / Website rebuild
              </p>
              <h1 className="font-paper-display text-[40px] leading-none font-bold tracking-[-0.02em] text-paper-moss">{run.company}</h1>
            </>
          )}
          <p className="mt-2 max-w-[80ch] text-[13px] leading-5 text-paper-char">
            <a href={run.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-paper-blue hover:underline">
              {run.websiteUrl}
            </a>{" "}
            · {run.targetMarket} · {run.location} · Goal: {run.conversionGoal}
            {run.requiredFunctions.length > 0 ? ` · Needs: ${run.requiredFunctions.map((value) => REBUILD_FUNCTION_LABEL[value]).join(", ")}` : ""}
          </p>
        </div>
        <div className="text-[13px] text-paper-sage sm:text-right">
          <div className="text-[15px] font-semibold text-paper-moss">
            {done} of {REBUILD_STAGES.length} stages complete
          </div>
          {inWorkspace ? (
            <Link to={`/rebuilds/${encodeURIComponent(run.id)}`} className="text-paper-blue hover:underline">
              Open full page
            </Link>
          ) : run.workspaceSlug ? (
            <Link to={`/workspaces/${encodeURIComponent(run.workspaceSlug)}?tab=documents`} className="text-paper-blue hover:underline">
              Open the workspace
            </Link>
          ) : null}
          <div>
            Skill {run.skillId} v{run.skillVersion}
          </div>
        </div>
      </header>

      <div className="h-1.5 w-full bg-paper-stone" role="progressbar" aria-label="Rebuild progress" aria-valuemin={0} aria-valuemax={REBUILD_STAGES.length} aria-valuenow={done}>
        <div className="h-full bg-paper-blue transition-[width] duration-300" style={{ width: `${(done / REBUILD_STAGES.length) * 100}%` }} />
      </div>

      <ol className="grid gap-3" aria-label="Stages">
        {REBUILD_STAGES.map((definition, index) => {
          const stage = run.stages.find((entry) => entry.id === definition.id);
          return stage ? <StageCard key={definition.id} run={run} stage={stage} index={index} /> : null;
        })}
      </ol>

      <div className="grid gap-8 lg:grid-cols-2">
        <DecisionHistory run={run} />
        <ActivityLog run={run} />
      </div>
    </div>
  );
}

function StageCard({ run, stage, index }: { run: RebuildRun; stage: RebuildStage; index: number }) {
  const definition = REBUILD_STAGES[index];
  const retry = useRetryStage(run.id);
  const artifacts = run.artifacts.filter((artifact) => artifact.stage === stage.id && artifact.media === "document");
  // Screenshots of the revision on screen: the latest one once it exists, so an old revision's pictures never pass for the new one.
  const shownRevision = run.artifacts.filter((artifact) => artifact.stage === stage.id && artifact.media === "image").reduce((max, artifact) => Math.max(max, artifact.revision), 0);
  const images = run.artifacts.filter((artifact) => artifact.stage === stage.id && artifact.media === "image" && artifact.revision === shownRevision);
  const revision = run.revisions.filter((entry) => entry.stage === stage.id).at(-1);
  const gated = GATED_STAGES.has(stage.id);

  return (
    <li>
      <PaperCard className={cn("p-4", stage.status === "awaiting_approval" && "border-paper-marigold", stage.status === "blocked" && "border-paper-flame")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2.5 font-paper-display text-[17px] font-bold text-paper-moss">
              <span className="inline-flex size-6 items-center justify-center bg-paper-blue font-paper-ui text-[12px] text-paper-white" aria-hidden="true">
                {stage.status === "complete" ? <CheckCircle2 className="size-3.5" /> : index + 1}
              </span>
              {definition.title}
              <StageStatusTag status={stage.status} />
              {gated && stage.status !== "awaiting_approval" ? (
                <span className="text-[12px] font-normal text-paper-sage" title="When this stage finishes, it waits for you to approve or request changes before the next one starts.">
                  Approval checkpoint
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-paper-sage">{definition.detail}</p>
          </div>
          <div className="text-[12px] text-paper-sage sm:text-right">
            {stage.revision > 0 ? <div>Revision {stage.revision}{gated && stage.approvedRevision ? ` · approved r${stage.approvedRevision}` : ""}</div> : null}
            {stage.attempts > 1 ? <div>{stage.attempts} attempts</div> : null}
            {stage.finishedAt ? <div>{formatRelativeTime(stage.finishedAt)}</div> : null}
          </div>
        </div>

        {stage.status === "in_progress" ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-paper-blue">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {stage.activity ?? "Working…"}
          </p>
        ) : null}

        {stage.status === "blocked" ? (
          <div role="alert" className="mt-3 flex flex-wrap items-start justify-between gap-3 border border-paper-flame/40 bg-paper-flame/5 p-3 text-[13px] text-paper-char">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-paper-flame" aria-hidden="true" />
              {stage.blocker}
            </span>
            <PaperButton onClick={() => retry.mutate(stage.id)} disabled={retry.isPending}>
              <RotateCcw className="size-3.5" aria-hidden="true" /> {retry.isPending ? "Retrying…" : "Retry"}
            </PaperButton>
          </div>
        ) : null}
        {retry.error ? <p className="mt-2 text-[12.5px] text-paper-flame-deep">{retry.error.message}</p> : null}

        {revision && stage.status !== "in_progress" ? (
          <p className="mt-3 text-[13px] text-paper-char">
            {revision.summary}
            {revision.worker || revision.ref ? (
              <span className="text-paper-sage">
                {" "}
                ({[revision.worker ? `by ${revision.worker}` : "", revision.ref ? `commit ${revision.ref.slice(0, 7)}` : ""].filter(Boolean).join(", ")})
              </span>
            ) : null}
          </p>
        ) : null}

        {images.length > 0 && stage.id !== "hero" ? <ScreenshotGallery images={images} revision={shownRevision} /> : null}

        {artifacts.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${definition.title} reports`}>
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <Link to={artifact.href} className="inline-flex items-center gap-1.5 border border-paper-mist px-2.5 py-1 text-[12.5px] text-paper-blue hover:bg-paper-linen">
                  <FileText className="size-3.5" aria-hidden="true" /> {artifact.title}
                  <span className="text-paper-sage">r{artifact.revision}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {stage.status === "awaiting_approval" ? <ReviewPanel run={run} stage={stage} images={images} /> : stage.id === "hero" && images.length > 0 ? <ConceptGallery images={images} chosen={run.heroChoice} /> : null}

        {stage.id === "preview" && run.previewUrl ? (
          <a href={run.previewUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-paper-blue hover:underline">
            {run.previewUrl} <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </PaperCard>
    </li>
  );
}

/** Approve or request changes, always naming the revision on screen, so an approval can't land on something unseen. */
function ReviewPanel({ run, stage, images }: { run: RebuildRun; stage: RebuildStage; images: RebuildArtifact[] }) {
  const id = useId();
  const decide = useDecideStage(run.id);
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState<string | undefined>(stage.id === "hero" ? run.heroChoice : undefined);
  const needsChoice = stage.id === "hero";

  return (
    <div className="mt-4 border-t border-paper-mist pt-4">
      <p className="text-[13px] font-semibold text-paper-moss">Review revision {stage.revision}</p>
      {needsChoice ? <ConceptGallery images={images} chosen={choice} onChoose={setChoice} name={`${id}-concept`} /> : null}
      <label htmlFor={`${id}-note`} className="mt-3 block">
        <FieldLabel>What should change? (needed to request changes)</FieldLabel>
        <textarea id={`${id}-note`} className={cn(PAPER_INPUT, "min-h-20 w-full max-w-[75ch]")} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {decide.error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-paper-flame-deep">
          {decide.error.message}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PaperButton
          variant="amber"
          disabled={decide.isPending || (needsChoice && !choice)}
          onClick={() => decide.mutate({ stage: stage.id, revision: stage.revision, decision: "approve", note: note.trim() || undefined, choice })}
        >
          {needsChoice ? (choice ? `Approve and build ${conceptLabel(choice)}` : "Choose a concept to approve") : `Approve revision ${stage.revision}`}
        </PaperButton>
        <PaperButton
          disabled={decide.isPending || !note.trim()}
          onClick={() => decide.mutate({ stage: stage.id, revision: stage.revision, decision: "request-changes", note: note.trim() }, { onSuccess: () => setNote("") })}
        >
          Request changes
        </PaperButton>
      </div>
    </div>
  );
}

const conceptLabel = (concept: string) => `Concept ${concept.replace("concept-", "").toUpperCase()}`;

/** The three heroes side by side, desktop over phone. With `onChoose`, a radio group for picking one. */
function ConceptGallery({ images, chosen, onChoose, name }: { images: RebuildArtifact[]; chosen?: string; onChoose?: (concept: string) => void; name?: string }) {
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3" role={onChoose ? "radiogroup" : undefined} aria-label={onChoose ? "Hero concepts" : undefined}>
      {HERO_CONCEPTS.map((concept) => {
        const desktop = images.find((image) => image.path.includes(`-${concept}-desktop`));
        const mobile = images.find((image) => image.path.includes(`-${concept}-mobile`));
        const selected = chosen === concept;
        const body = (
          <>
            <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-paper-moss">
              {conceptLabel(concept)}
              {selected ? <CheckCircle2 className="size-4 text-paper-blue" aria-hidden="true" /> : null}
            </span>
            <span className="mt-2 grid grid-cols-[1fr_auto] items-start gap-2">
              {desktop ? <img src={desktop.href} alt={`${conceptLabel(concept)} hero at desktop width`} className="w-full border border-paper-mist" loading="lazy" /> : <span className="text-[12px] text-paper-sage">No desktop shot</span>}
              {mobile ? <img src={mobile.href} alt={`${conceptLabel(concept)} hero at phone width`} className="w-16 border border-paper-mist sm:w-20" loading="lazy" /> : null}
            </span>
          </>
        );
        return onChoose ? (
          <label key={concept} className={cn("cursor-pointer border-[1.5px] p-3", selected ? "border-paper-blue bg-paper-white" : "border-paper-mist hover:border-paper-sage")}>
            <input type="radio" name={name} value={concept} checked={selected} onChange={() => onChoose(concept)} className="sr-only" />
            {body}
          </label>
        ) : (
          <div key={concept} className={cn("border-[1.5px] p-3", selected ? "border-paper-blue" : "border-paper-mist")}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Pages of a built revision, each at desktop and phone width. Click to open full size. */
function ScreenshotGallery({ images, revision }: { images: RebuildArtifact[]; revision: number }) {
  const pages = [...new Set(images.map((image) => image.title.replace(/ \((desktop|mobile)\)$/, "")))];
  return (
    <div className="mt-3">
      <p className="text-[12px] text-paper-sage">Screenshots of revision {revision}</p>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map((page) => {
          const desktop = images.find((image) => image.title === `${page} (desktop)`);
          const mobile = images.find((image) => image.title === `${page} (mobile)`);
          return (
            <li key={page} className="border border-paper-mist p-2">
              <p className="mb-1 text-[12.5px] font-semibold text-paper-moss">{page}</p>
              <div className="grid grid-cols-[1fr_auto] items-start gap-2">
                {desktop ? (
                  <a href={desktop.href} target="_blank" rel="noopener noreferrer">
                    <img src={desktop.href} alt={`${page} at desktop width`} className="w-full" loading="lazy" />
                  </a>
                ) : null}
                {mobile ? (
                  <a href={mobile.href} target="_blank" rel="noopener noreferrer">
                    <img src={mobile.href} alt={`${page} at phone width`} className="w-14" loading="lazy" />
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DecisionHistory({ run }: { run: RebuildRun }) {
  const title = (stage: string) => REBUILD_STAGES.find((entry) => entry.id === stage)?.title ?? stage;
  return (
    <PaperSection label="Approvals and feedback" count={run.decisions.length}>
      {run.decisions.length === 0 ? (
        <p className="text-[13px] text-paper-sage">Nothing reviewed yet. Stages 4, 5 and 6 stop here for you.</p>
      ) : (
        <ul className="grid gap-2">
          {[...run.decisions].reverse().map((decision) => (
            <li key={decision.id} className="border-l-2 border-paper-mist pl-3 text-[13px]">
              <span className="font-semibold text-paper-moss">
                {title(decision.stage)} r{decision.revision}: {decision.decision === "approved" ? "approved" : "changes requested"}
              </span>{" "}
              <span className="text-paper-sage">{formatRelativeTime(decision.at)}</span>
              {decision.note ? <p className="mt-0.5 whitespace-pre-wrap text-paper-char">{decision.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

function ActivityLog({ run }: { run: RebuildRun }) {
  return (
    <PaperSection label="Activity" count={run.events.length}>
      <ol className="grid max-h-[420px] gap-1.5 overflow-y-auto text-[13px]" aria-label="Activity, newest first">
        {run.events.map((event) => (
          <li key={event.id} className={cn("grid grid-cols-[auto_1fr] gap-3", event.level === "warning" && "text-paper-flame", event.level === "error" && "text-paper-flame-deep")}>
            <time dateTime={event.at} className="text-paper-sage tabular-nums">
              {formatRelativeTime(event.at)}
            </time>
            <span>{event.message}</span>
          </li>
        ))}
      </ol>
    </PaperSection>
  );
}
