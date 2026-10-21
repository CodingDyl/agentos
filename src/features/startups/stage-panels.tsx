import { GraduationCap, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { IdeaSchema, MvpSchema, ValueSchema, type ScopeCheck, type StageContent, type VentureDetail } from "@shared/startup-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperNotice, Tag } from "@/components/paper";
import { useGraduateVenture, useSaveStage, useScopeCheck } from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";
import { StageEditor, StageInterview, type FieldSpec } from "./stage-form";

const IDEA_FIELDS: readonly FieldSpec[] = [
  { key: "title", label: "Name", kind: "text" },
  { key: "oneLiner", label: "One line", kind: "text", hint: "What it is, for whom, in one sentence." },
  { key: "problem", label: "The problem", kind: "area" },
  { key: "who", label: "Who has it", kind: "area", hint: "A specific type of person or business, not \"everyone\"." },
  { key: "howItWorks", label: "How it would help", kind: "area" },
  { key: "whyNow", label: "Why now", kind: "area" },
  { key: "assumptions", label: "Assumptions it rests on", kind: "list", hint: "What must be true for this to work." },
];

const VALUE_FIELDS: readonly FieldSpec[] = [
  { key: "customer", label: "Customer", kind: "area" },
  { key: "jobToBeDone", label: "The job they are trying to get done", kind: "area" },
  { key: "painToday", label: "The pain today", kind: "area" },
  { key: "alternatives", label: "What they use instead", kind: "list" },
  { key: "valueProposition", label: "Value proposition", kind: "area" },
  { key: "whoPays", label: "Who pays", kind: "text" },
  { key: "pricingIdea", label: "Pricing idea (ZAR)", kind: "text" },
  { key: "advantage", label: "Unfair advantage", kind: "area" },
];

const MVP_FIELDS: readonly FieldSpec[] = [
  { key: "targetUser", label: "The one target user", kind: "text" },
  { key: "problem", label: "The one problem", kind: "area" },
  { key: "coreWorkflow", label: "The core workflow", kind: "list", hint: "The steps that user takes. These become the first tasks." },
  { key: "inScope", label: "In scope", kind: "list", hint: "Only what the workflow needs." },
  { key: "outOfScope", label: "Out of scope", kind: "list", hint: "Everything else. Parked, not lost." },
  { key: "successMetric", label: "Success metric", kind: "text", hint: "A number and a time, e.g. 5 firms open 20 matters in 4 weeks." },
  { key: "killCriteria", label: "Kill criteria", kind: "list", hint: "What result means stop." },
  { key: "timeboxWeeks", label: "Timebox (weeks)", kind: "number" },
];

type SimpleStage = "idea" | "value" | "mvp";

const SPECS: Record<SimpleStage, { fields: readonly FieldSpec[]; blank: () => Record<string, unknown>; intro: string; notesLabel?: string }> = {
  idea: {
    fields: IDEA_FIELDS,
    blank: () => IdeaSchema.parse({}),
    intro: "Describe the idea in your own words. Hermes reads it, along with lessons from earlier ventures, asks a few questions about what is missing, then drafts the idea for you to edit.",
    notesLabel: "The idea, as you would explain it to a friend",
  },
  value: {
    fields: VALUE_FIELDS,
    blank: () => ValueSchema.parse({}),
    intro: "Who would pay for this, and why. Hermes asks about the customer, what they do today and what it costs them, then drafts the value for you to edit.",
  },
  mvp: {
    fields: MVP_FIELDS,
    blank: () => MvpSchema.parse({}),
    intro: "The smallest thing that tests the idea: one user, one problem, one workflow, one number. Hermes drafts a strict contract from everything so far. What does not fit goes to Later.",
  },
};

/** Idea, Value or the MVP contract: interview, then an editable draft, then save. */
export function SimpleStagePanel({ detail, stage }: { detail: VentureDetail; stage: SimpleStage }) {
  const slug = detail.venture.slug;
  const spec = SPECS[stage];
  const saved = detail.stages[stage] as Record<string, unknown> | null;
  const save = useSaveStage(slug, stage);
  const locked = Boolean(detail.locks[stage]);

  const [draft, setDraft] = useState<{ content: Record<string, unknown>; from: "hermes" | "blank" }>();
  const [interviewing, setInterviewing] = useState(!saved);

  const onSave = (value: Record<string, unknown>) =>
    save.mutate(
      { content: value as StageContent[typeof stage], expectedRevision: detail.revisions[stage] },
      { onSuccess: () => setDraft(undefined) },
    );

  if (locked) return <PaperNotice>{detail.locks[stage]}</PaperNotice>;

  if (interviewing && !draft) {
    return (
      <StageInterview
        slug={slug}
        stage={stage}
        intro={spec.intro}
        notesLabel={!saved ? spec.notesLabel : undefined}
        onDraft={(content) => {
          setDraft({ content: content as Record<string, unknown>, from: "hermes" });
          setInterviewing(false);
        }}
        onCancel={() => {
          if (!saved) setDraft({ content: spec.blank(), from: "blank" });
          setInterviewing(false);
        }}
      />
    );
  }

  const initial = draft?.content ?? saved ?? spec.blank();
  return (
    <StageEditor
      key={JSON.stringify(initial)}
      fields={spec.fields}
      initial={initial}
      notice={draft?.from === "hermes" ? "Hermes drafted this. Edit anything, then save it. Nothing is in the vault until you do." : undefined}
      saving={save.isPending}
      error={save.error?.message}
      onSave={onSave}
      onAskHermes={() => {
        setDraft(undefined);
        setInterviewing(true);
      }}
    />
  );
}

const VERDICT: Record<ScopeCheck["verdict"], { label: string; tone: "green" | "marigold" | "flame" }> = {
  in: { label: "In the MVP", tone: "green" },
  later: { label: "Parked for later", tone: "marigold" },
  pivot: { label: "That is a pivot", tone: "flame" },
};

/** The MVP stage: the contract, the scope guard, and graduation into a workspace. */
export function MvpPanel({ detail }: { detail: VentureDetail }) {
  const slug = detail.venture.slug;
  const mvp = detail.stages.mvp;
  const scope = useScopeCheck(slug);
  const graduate = useGraduateVenture(slug);
  const [request, setRequest] = useState("");

  return (
    <div className="space-y-6">
      <SimpleStagePanel detail={detail} stage="mvp" />

      {mvp && !detail.locks.mvp ? (
        <PaperCard className="p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-paper-moss" aria-hidden="true" />
            <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">Scope guard</h3>
          </div>
          <p className="mt-1 max-w-[64ch] text-[13.5px] leading-6 text-paper-char">
            Want to add something? Check it against the contract first. Anything the core workflow does not need is parked in Later, so the MVP stays small.
          </p>
          <form
            className="mt-4 flex flex-wrap items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (request.trim()) scope.mutate(request.trim(), { onSuccess: () => setRequest("") });
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">What do you want to add?</span>
              <input value={request} onChange={(event) => setRequest(event.target.value)} placeholder="I also want…" maxLength={1000} className={cn(PAPER_INPUT, "w-full")} />
            </label>
            <PaperButton type="submit" variant="ghost" disabled={scope.isPending || !request.trim()}>
              {scope.isPending ? "Checking…" : "Check it"}
            </PaperButton>
          </form>
          {scope.data ? (
            <div className="mt-4 bg-paper-linen px-4 py-3" role="status">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={VERDICT[scope.data.check.verdict].tone}>{VERDICT[scope.data.check.verdict].label}</Tag>
                <span className="text-[13.5px] font-medium text-paper-moss">{scope.data.check.request}</span>
              </div>
              <p className="mt-1 text-[13.5px] leading-6 text-paper-char">{scope.data.check.reason}</p>
              {scope.data.check.clause ? <p className="mt-1 text-[12.5px] text-paper-sage">Against: {scope.data.check.clause}</p> : null}
            </div>
          ) : null}
          {scope.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{scope.error.message}</p> : null}
        </PaperCard>
      ) : null}

      {mvp && !detail.locks.mvp ? (
        <PaperCard className="bg-paper-cream p-6">
          {detail.venture.workspace ? (
            <p className="text-[14px] leading-6 text-paper-char">
              This venture is now the{" "}
              <Link to={`/workspaces/${detail.venture.workspace}?tab=startup`} className="font-medium text-paper-blue underline underline-offset-4">
                {detail.venture.workspace} workspace
              </Link>
              . Its tasks start with the core workflow only.
            </p>
          ) : (
            <>
              <FieldLabel>Ready to build</FieldLabel>
              <p className="max-w-[64ch] text-[14px] leading-6 text-paper-char">
                Creates a workspace for this venture. The core workflow becomes its first tasks; everything out of scope and in Later waits under Later. Design and tech come next.
              </p>
              <PaperButton variant="amber" className="mt-4" disabled={graduate.isPending} onClick={() => graduate.mutate()}>
                <GraduationCap className="size-3.5" aria-hidden="true" />
                {graduate.isPending ? "Creating the workspace…" : "Create the workspace"}
              </PaperButton>
              {graduate.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{graduate.error.message}</p> : null}
            </>
          )}
        </PaperCard>
      ) : null}
    </div>
  );
}
