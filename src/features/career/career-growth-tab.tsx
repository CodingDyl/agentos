import { useState } from "react";
import { EVIDENCE_KINDS, type CareerData, type EvidenceKind } from "@shared/career-types";
import { PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import {
  useAcceptSuggestion,
  useAddEvidence,
  useAddGoal,
  useDeleteEvidence,
  useDismissSuggestion,
  useSaveGrowthProfile,
  useSetGoalStatus,
  useSuggestGrowth,
} from "@/lib/agentos/career";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, MemoryProposalButton } from "./career-kit";
import { formatDay, formatTimestamp, localToday, toLines, TEXTAREA } from "./career-model";

/**
 * Role, growth areas, goals and evidence. Hermes may suggest; only a person
 * changes a goal — a suggestion becomes one when accepted, never on its own.
 */
export function CareerGrowthTab({ data }: { data: CareerData }) {
  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <Profile data={data} />
        <Goals data={data} />
        <Evidence data={data} />
      </div>
      <Suggestions data={data} />
    </div>
  );
}

function Profile({ data }: { data: CareerData }) {
  const { growth } = data;
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(growth.role);
  const [milestone, setMilestone] = useState(growth.nextMilestone);
  const [areas, setAreas] = useState(growth.growthAreas.join("\n"));
  const save = useSaveGrowthProfile();

  return (
    <PaperSection label="Current role" action={editing ? null : <PaperButton onClick={() => setEditing(true)}>Edit</PaperButton>}>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ role, nextMilestone: milestone, growthAreas: toLines(areas) }, { onSuccess: () => setEditing(false) });
          }}
        >
          <Field label="Role">
            <input className={cn(PAPER_INPUT, "w-full")} value={role} maxLength={120} onChange={(event) => setRole(event.target.value)} />
          </Field>
          <Field label="Next career milestone">
            <input className={cn(PAPER_INPUT, "w-full")} value={milestone} maxLength={300} onChange={(event) => setMilestone(event.target.value)} />
          </Field>
          <Field label="Growth areas (one per line, focus first)">
            <textarea className={TEXTAREA} value={areas} placeholder={"System design\nTechnical leadership\nAI engineering"} onChange={(event) => setAreas(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <PaperButton type="submit" variant="amber" disabled={save.isPending}>
              Save
            </PaperButton>
            <PaperButton onClick={() => setEditing(false)}>Cancel</PaperButton>
          </div>
          <ErrorLine error={save.error} />
        </form>
      ) : (
        <div className="space-y-3 text-[15px] leading-6 text-paper-char">
          <p className="font-medium text-paper-moss">{growth.role}</p>
          {growth.nextMilestone ? <p>Next: {growth.nextMilestone}</p> : null}
          {growth.growthAreas.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {growth.growthAreas.map((area) => (
                <Tag key={area} tone="blue">
                  {area}
                </Tag>
              ))}
            </div>
          ) : (
            <p className="text-paper-sage">No growth areas yet.</p>
          )}
        </div>
      )}
    </PaperSection>
  );
}

function Goals({ data }: { data: CareerData }) {
  const [text, setText] = useState("");
  const add = useAddGoal();
  const setStatus = useSetGoalStatus();
  const active = data.growth.goals.filter((goal) => goal.status === "active");
  const closed = data.growth.goals.filter((goal) => goal.status !== "active");

  return (
    <PaperSection label="Goals" count={active.length}>
      <ul className="space-y-2">
        {active.map((goal) => (
          <li key={goal.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[15px] leading-6">
            <span className="min-w-0">{goal.text}</span>
            <span className="flex gap-1">
              <PaperButton onClick={() => setStatus.mutate({ goalId: goal.id, status: "done" })}>Done</PaperButton>
              <PaperButton onClick={() => setStatus.mutate({ goalId: goal.id, status: "dropped" })}>Drop</PaperButton>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) add.mutate(text, { onSuccess: () => setText("") });
        }}
      >
        <input aria-label="New goal" className={cn(PAPER_INPUT, "min-w-0 flex-1")} placeholder="Deliver Y by Q1" value={text} maxLength={500} onChange={(event) => setText(event.target.value)} />
        <PaperButton type="submit" variant="ghost" disabled={add.isPending}>
          Add goal
        </PaperButton>
      </form>
      <ErrorLine error={add.error ?? setStatus.error} />
      {closed.length > 0 ? (
        <ul className="mt-4 space-y-1 text-[13.5px] text-paper-sage">
          {closed.map((goal) => (
            <li key={goal.id}>
              {goal.status === "done" ? "✓" : "✕"} {goal.text}
            </li>
          ))}
        </ul>
      ) : null}
    </PaperSection>
  );
}

const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  project: "Project delivered",
  problem: "Problem solved",
  feedback: "Feedback",
  responsibility: "New responsibility",
  achievement: "Achievement",
};

function Evidence({ data }: { data: CareerData }) {
  const [kind, setKind] = useState<EvidenceKind>("project");
  const [text, setText] = useState("");
  const [date, setDate] = useState(localToday());
  const add = useAddEvidence();
  const remove = useDeleteEvidence();

  return (
    <PaperSection label="Evidence" count={data.growth.evidence.length}>
      <form
        className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)_9.5rem]"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) add.mutate({ kind, text, date }, { onSuccess: () => setText("") });
        }}
      >
        <Field label="Kind">
          <select className={cn(PAPER_INPUT, "w-full")} value={kind} onChange={(event) => setKind(event.target.value as EvidenceKind)}>
            {EVIDENCE_KINDS.map((value) => (
              <option key={value} value={value}>
                {EVIDENCE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What happened">
          <input className={cn(PAPER_INPUT, "w-full")} value={text} maxLength={2000} placeholder="Delivered X resulting in Y" onChange={(event) => setText(event.target.value)} />
        </Field>
        <Field label="When">
          <input type="date" className={cn(PAPER_INPUT, "w-full")} value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <PaperButton type="submit" variant="ghost" disabled={add.isPending}>
            Add evidence
          </PaperButton>
          <ErrorLine error={add.error} />
        </div>
      </form>

      <ul className="mt-6 space-y-3">
        {data.growth.evidence.map((item) => (
          <li key={item.id}>
            <PaperCard>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Tag>{EVIDENCE_LABELS[item.kind]}</Tag>
                  <span className="text-[12.5px] text-paper-sage">{formatDay(item.date)}</span>
                </span>
                <PaperButton disabled={remove.isPending} onClick={() => window.confirm("Delete this evidence?") && remove.mutate(item.id)}>
                  Delete
                </PaperButton>
              </div>
              <p className="mt-2 text-[15px] leading-6">{item.text}</p>
              {item.memoryTarget ? (
                <p className="mt-2 text-[12.5px] text-paper-green">In memory · {item.memoryTarget}</p>
              ) : (
                <div className="mt-1">
                  <MemoryProposalButton
                    defaultKind={item.kind === "feedback" ? "feedback" : "achievement"}
                    defaultTitle={item.text}
                    defaultBody={`${item.text}\n\n(${EVIDENCE_LABELS[item.kind]}, ${item.date})`}
                    source={`evidence:${item.id}`}
                  />
                </div>
              )}
            </PaperCard>
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}

const SUGGESTION_LABELS = { "skill-gap": "Skill gap", "next-step": "Next step", achievement: "Achievement", mismatch: "Mismatch" } as const;

function Suggestions({ data }: { data: CareerData }) {
  const suggest = useSuggestGrowth();
  const accept = useAcceptSuggestion();
  const dismiss = useDismissSuggestion();
  const { suggestions, suggestionsAt } = data.growth;

  return (
    <PaperSection
      label="Hermes suggests"
      action={
        <PaperButton variant="ghost" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
          {suggest.isPending ? "Thinking…" : "Ask Hermes"}
        </PaperButton>
      }
    >
      <ErrorLine error={suggest.error ?? accept.error ?? dismiss.error} />
      {suggestions.length === 0 ? (
        <p className="text-[14.5px] leading-6 text-paper-char">
          Skill gaps, measurable next steps, achievements worth recording, and goals your recent work isn't serving. Nothing changes until you accept it.
        </p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <PaperCard>
                <Tag tone={suggestion.kind === "mismatch" ? "flame" : "marigold"}>{SUGGESTION_LABELS[suggestion.kind]}</Tag>
                <p className="mt-2 text-[14.5px] leading-6">{suggestion.text}</p>
                {suggestion.proposedGoal ? <p className="mt-1 text-[13.5px] text-paper-sage">Goal: {suggestion.proposedGoal}</p> : null}
                <div className="mt-3 flex gap-2">
                  {suggestion.kind !== "mismatch" || suggestion.proposedGoal ? (
                    <PaperButton variant="ghost" disabled={accept.isPending} onClick={() => accept.mutate(suggestion.id)}>
                      {suggestion.kind === "achievement" ? "Add as evidence" : "Add as goal"}
                    </PaperButton>
                  ) : null}
                  <PaperButton disabled={dismiss.isPending} onClick={() => dismiss.mutate(suggestion.id)}>
                    Dismiss
                  </PaperButton>
                </div>
              </PaperCard>
            </li>
          ))}
        </ul>
      )}
      {suggestionsAt ? <p className="mt-3 text-[12.5px] text-paper-sage">Asked {formatTimestamp(suggestionsAt)}</p> : null}
    </PaperSection>
  );
}
