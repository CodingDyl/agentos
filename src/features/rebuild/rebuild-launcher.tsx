import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Hammer } from "lucide-react";
import { REBUILD_STAGES, currentStage, type RebuildFunction } from "@shared/website-rebuild-types";
import type { Prospect } from "@shared/traction-types";
import { PaperButton } from "@/components/paper";
import { useRebuildForProspect, useStartRebuild } from "@/lib/agentos/rebuilds";
import { RebuildBriefFields } from "./brief-fields";
import { companyOf, readBrief } from "./brief-model";
import { StageStatusTag } from "./rebuild-status";

/**
 * "Build it first", for real: starts the seven-stage rebuild for this
 * prospect, or shows where the one already running has got to.
 */
export function RebuildLauncher({ prospect }: { prospect: Prospect }) {
  const existing = useRebuildForProspect(prospect.id);
  const [open, setOpen] = useState(false);

  if (existing.isPending) return null;

  if (existing.data) {
    const run = existing.data;
    const next = currentStage(run.stages);
    const done = run.stages.filter((stage) => stage.status === "complete").length;
    const title = next ? REBUILD_STAGES.find((stage) => stage.id === next.id)?.title : undefined;
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-paper-mist bg-paper-linen px-4 py-3">
        <div className="text-[13px] leading-5">
          <span className="font-semibold text-paper-moss">Website rebuild: {done} of {REBUILD_STAGES.length} stages done.</span>{" "}
          {next && title ? (
            <span className="inline-flex items-center gap-2">
              Now: {title} <StageStatusTag status={next.status} />
            </span>
          ) : (
            "Complete."
          )}
        </div>
        <Link to={`/rebuilds/${encodeURIComponent(run.id)}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-paper-blue hover:underline">
          Open the rebuild <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return open ? (
    <RebuildStartForm prospect={prospect} onCancel={() => setOpen(false)} />
  ) : (
    <div className="mt-4">
      <PaperButton variant="amber" onClick={() => setOpen(true)}>
        <Hammer className="size-3.5" aria-hidden="true" /> Start website rebuild
      </PaperButton>
      <p className="mt-1 text-[12.5px] text-paper-sage">
        {prospect.website
          ? "Seven stages from their current site to a Vercel preview. You approve the design, the copy and the features before anything moves on."
          : "No website on file: the rebuild skips reading one and works from research and the details you give."}
      </p>
    </div>
  );
}

function RebuildStartForm({ prospect, onCancel }: { prospect: Prospect; onCancel: () => void }) {
  const id = useId();
  const start = useStartRebuild();
  const [functions, setFunctions] = useState<RebuildFunction[]>(["contact_form"]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start.mutate({ prospectId: prospect.id, company: companyOf(form), ...readBrief(form), requiredFunctions: functions });
  };

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border border-paper-mist bg-paper-linen p-4" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="font-semibold text-paper-moss">
        Start website rebuild
      </h4>
      <RebuildBriefFields id={id} defaults={{ company: prospect.company, websiteUrl: prospect.website ?? "", targetMarket: prospect.segment ?? "" }} functions={functions} onFunctions={setFunctions} />
      {start.error ? (
        <p role="alert" className="border border-paper-flame-deep p-3 text-[13px] text-paper-flame-deep">
          {start.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <PaperButton type="submit" variant="amber" disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start rebuild"}
        </PaperButton>
        <PaperButton onClick={onCancel} disabled={start.isPending}>
          Cancel
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">Creates (or reuses) the client's workspace and reads their site, if they have one. Nothing is sent to anyone.</span>
      </div>
    </form>
  );
}
