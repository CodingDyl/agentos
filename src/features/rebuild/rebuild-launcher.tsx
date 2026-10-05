import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Hammer } from "lucide-react";
import {
  REBUILD_FUNCTION_LABEL,
  REBUILD_STAGES,
  RebuildFunctionSchema,
  currentStage,
  type RebuildFunction,
} from "@shared/website-rebuild-types";
import type { Prospect } from "@shared/traction-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useRebuildForProspect, useStartRebuild } from "@/lib/agentos/rebuilds";
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
      <PaperButton variant="amber" onClick={() => setOpen(true)} disabled={!prospect.website}>
        <Hammer className="size-3.5" aria-hidden="true" /> Start website rebuild
      </PaperButton>
      <p className="mt-1 text-[12.5px] text-paper-sage">
        {prospect.website
          ? "Seven stages from their current site to a Vercel preview. You approve the design, the copy and the features before anything moves on."
          : "Add their website first: the rebuild starts by reading it."}
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
    const text = (name: string) => String(form.get(name) ?? "").trim();
    start.mutate({
      prospectId: prospect.id,
      company: text("company"),
      websiteUrl: text("websiteUrl"),
      targetMarket: text("targetMarket"),
      location: text("location"),
      conversionGoal: text("conversionGoal"),
      requiredFunctions: functions,
      designTemplate: text("designTemplate") || "DESIGN.md",
    });
  };

  const field = (name: string, label: string, defaultValue: string, hint?: string, type = "text") => (
    <label className="block" htmlFor={`${id}-${name}`}>
      <FieldLabel>{label}</FieldLabel>
      <input id={`${id}-${name}`} name={name} type={type} required className={PAPER_INPUT} defaultValue={defaultValue} />
      {hint ? <span className="mt-0.5 block text-[12.5px] text-paper-sage">{hint}</span> : null}
    </label>
  );

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border border-paper-mist bg-paper-linen p-4" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="font-semibold text-paper-moss">
        Start website rebuild
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("company", "Company", prospect.company)}
        {field("websiteUrl", "Current website", prospect.website ?? "", undefined, "url")}
        {field("targetMarket", "Target market", prospect.segment ?? "", "Who they sell to, e.g. homeowners needing an electrician")}
        {field("location", "Location", "", "Town or area they serve")}
        {field("conversionGoal", "Main goal for visitors", "Get in touch", "What a visitor should do, e.g. book a call-out")}
        {field("designTemplate", "DESIGN.md template", "DESIGN.md", "Path to the DESIGN.md whose structure the three concepts follow")}
      </div>
      <fieldset>
        <legend>
          <FieldLabel>Functions the site needs</FieldLabel>
        </legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {RebuildFunctionSchema.options.map((value) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={functions.includes(value)}
                onChange={(event) => setFunctions((current) => (event.target.checked ? [...current, value] : current.filter((entry) => entry !== value)))}
              />
              {REBUILD_FUNCTION_LABEL[value]}
            </label>
          ))}
        </div>
      </fieldset>
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
        <span className="text-[12.5px] text-paper-sage">Creates (or reuses) the client's workspace and reads their site. Nothing is sent to anyone.</span>
      </div>
    </form>
  );
}
