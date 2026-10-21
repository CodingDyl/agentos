import { Sparkles } from "lucide-react";
import { useState } from "react";
import type { EditableStage, StageContent } from "@shared/startup-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard } from "@/components/paper";
import { useStageDraft, useStageQuestions } from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";

/**
 * The pieces every stage shares: Hermes' questions and draft, and a form built
 * from a field list. Nothing here saves; the stage panel does.
 */

export type FieldSpec = {
  key: string;
  label: string;
  kind: "text" | "area" | "list" | "number";
  hint?: string;
};

/** Lists are edited one item per line. */
const toLines = (value: unknown) => (Array.isArray(value) ? value.join("\n") : "");
const fromLines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

export function StageFields<T extends Record<string, unknown>>({
  fields,
  value,
  onChange,
  disabled,
}: {
  fields: readonly FieldSpec[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-5">
      {fields.map((field) => {
        const id = `field-${field.key}`;
        const current = value[field.key];
        return (
          <label key={field.key} htmlFor={id} className="block">
            <FieldLabel>{field.label}</FieldLabel>
            {field.kind === "text" ? (
              <input
                id={id}
                disabled={disabled}
                value={String(current ?? "")}
                onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
                className={cn(PAPER_INPUT, "w-full")}
              />
            ) : field.kind === "number" ? (
              <input
                id={id}
                type="number"
                min={1}
                max={52}
                disabled={disabled}
                value={Number(current ?? 0) || ""}
                onChange={(event) => onChange({ ...value, [field.key]: Number(event.target.value) || 1 })}
                className={cn(PAPER_INPUT, "w-28 tabular-nums")}
              />
            ) : (
              <textarea
                id={id}
                disabled={disabled}
                rows={field.kind === "list" ? Math.min(8, Math.max(3, toLines(current).split("\n").length + 1)) : 3}
                value={field.kind === "list" ? toLines(current) : String(current ?? "")}
                onChange={(event) => onChange({ ...value, [field.key]: field.kind === "list" ? fromLines(event.target.value) : event.target.value })}
                className={cn(PAPER_INPUT, "w-full py-2 leading-6")}
              />
            )}
            {field.hint ? <span className="mt-1 block text-[12.5px] leading-5 text-paper-sage">{field.hint}{field.kind === "list" ? " One per line." : ""}</span> : field.kind === "list" ? <span className="mt-1 block text-[12.5px] text-paper-sage">One per line.</span> : null}
          </label>
        );
      })}
    </div>
  );
}

const WAIT = "Hermes is thinking… (usually under a minute, sometimes a few)";

/**
 * Hermes reads what is written, asks only about the gaps, one question at a
 * time, then drafts the stage. The draft comes back for editing, never saved.
 */
export function StageInterview<S extends EditableStage>({
  slug,
  stage,
  intro,
  notesLabel,
  onDraft,
  onCancel,
}: {
  slug: string;
  stage: S;
  intro: string;
  /** When set, a free-text box comes first: the idea in the operator's own words. */
  notesLabel?: string;
  onDraft: (content: StageContent[S]) => void;
  onCancel?: () => void;
}) {
  const questions = useStageQuestions(slug, stage);
  const draft = useStageDraft(slug, stage);
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const list = questions.data?.questions ?? [];
  const last = index === list.length - 1;
  const finish = () =>
    draft.mutate({ answers: list.map((question, at) => ({ question, answer: answers[at] ?? "" })), notes: notes.trim() || undefined }, { onSuccess: onDraft });

  if (!questions.data) {
    return (
      <PaperCard className="bg-paper-cream p-6">
        <p className="max-w-[64ch] text-[14px] leading-6 text-paper-char">{intro}</p>
        {notesLabel ? (
          <label className="mt-4 block">
            <FieldLabel>{notesLabel}</FieldLabel>
            <textarea rows={5} maxLength={6000} value={notes} onChange={(event) => setNotes(event.target.value)} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} />
          </label>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" disabled={questions.isPending || (Boolean(notesLabel) && !notes.trim())} onClick={() => questions.mutate(notes.trim() || undefined)}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            {questions.isPending ? WAIT : "Start with Hermes"}
          </PaperButton>
          {onCancel ? <PaperButton onClick={onCancel}>Fill it in myself</PaperButton> : null}
        </div>
        {questions.error ? (
          <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
            {questions.error.message}
          </p>
        ) : null}
      </PaperCard>
    );
  }

  return (
    <PaperCard className="p-6">
      {questions.data.understood.length > 0 && index === 0 ? (
        <div className="mb-5 bg-paper-linen px-4 py-3">
          <FieldLabel>What Hermes already understood</FieldLabel>
          <ul className="mt-1 list-disc pl-5 text-[13.5px] leading-6 text-paper-char">
            {questions.data.understood.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[12.5px] font-semibold tracking-[0.06em] text-paper-sage uppercase tabular-nums">
        Question {index + 1} of {list.length}
      </p>
      <label className="mt-2 block">
        <span className="block font-paper-display text-[18px] leading-7 font-bold text-paper-moss">{list[index]}</span>
        <textarea
          key={index}
          rows={4}
          autoFocus
          maxLength={2000}
          value={answers[index] ?? ""}
          onChange={(event) => setAnswers((current) => Object.assign([...current], { [index]: event.target.value }))}
          placeholder="Answer in your own words. Leave it empty to skip."
          className={cn(PAPER_INPUT, "mt-3 w-full py-2 leading-6")}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PaperButton disabled={index === 0 || draft.isPending} onClick={() => setIndex(index - 1)}>
          Back
        </PaperButton>
        {last ? (
          <PaperButton variant="amber" disabled={draft.isPending} onClick={finish}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            {draft.isPending ? WAIT : "Draft it"}
          </PaperButton>
        ) : (
          <PaperButton variant="amber" onClick={() => setIndex(index + 1)}>
            Next
          </PaperButton>
        )}
      </div>
      {draft.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {draft.error.message}
        </p>
      ) : null}
    </PaperCard>
  );
}

/** A stage's saved content, editable, with a save that reports what went wrong. */
export function StageEditor<T extends Record<string, unknown>>({
  fields,
  initial,
  notice,
  saving,
  error,
  locked,
  onSave,
  onAskHermes,
}: {
  fields: readonly FieldSpec[];
  initial: T;
  notice?: string;
  saving: boolean;
  error?: string;
  locked?: boolean;
  onSave: (value: T) => void;
  onAskHermes?: () => void;
}) {
  const [value, setValue] = useState<T>(initial);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  return (
    <PaperCard className="p-6">
      {notice ? <p className="mb-5 bg-paper-linen px-4 py-3 text-[13.5px] leading-6 text-paper-char">{notice}</p> : null}
      <StageFields fields={fields} value={value} onChange={setValue} disabled={locked} />
      {!locked ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" disabled={saving || (!dirty && !notice)} onClick={() => onSave(value)}>
            {saving ? "Saving…" : "Save"}
          </PaperButton>
          {onAskHermes ? (
            <PaperButton onClick={onAskHermes}>
              <Sparkles className="size-3.5" aria-hidden="true" />
              Ask Hermes again
            </PaperButton>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error}
        </p>
      ) : null}
    </PaperCard>
  );
}
