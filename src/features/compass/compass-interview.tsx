import { Sparkles } from "lucide-react";
import { useState } from "react";
import type { Compass } from "@shared/compass-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard } from "@/components/paper";
import { useDraftCompass, useInterviewQuestions } from "@/lib/agentos/compass";
import { cn } from "@/lib/utils";

/**
 * Setting up the Compass the first time. Hermes reads what is already
 * written about you, asks only about the gaps, one question at a time, then
 * drafts the Compass. Nothing is saved until you save the draft.
 */
export function CompassInterview({ onDraft }: { onDraft: (compass: Compass) => void }) {
  const questions = useInterviewQuestions();
  const draft = useDraftCompass();
  const [answers, setAnswers] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const list = questions.data?.questions ?? [];
  const last = index === list.length - 1;
  const finish = () =>
    draft.mutate(
      list.map((question, at) => ({ question, answer: answers[at] ?? "" })),
      { onSuccess: (result) => onDraft(result.compass) },
    );

  if (!questions.data) {
    return (
      <PaperCard className="max-w-[760px] bg-paper-cream p-6">
        <p className="font-paper-display text-[19px] font-bold text-paper-moss">Set up your Compass</p>
        <p className="mt-2 max-w-[64ch] text-[14px] leading-6 text-paper-char">
          Hermes reads your profile, goals, current focus and workspaces first, then asks you 6 to 10 questions about what is missing: numbers and dates for your goals, which projects matter most, how each part of your life is really going. It then drafts your Compass for you to edit. About ten minutes.
        </p>
        <PaperButton variant="amber" className="mt-4" disabled={questions.isPending} onClick={() => questions.mutate()}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {questions.isPending ? "Hermes is reading your files… (usually under a minute, sometimes up to five)" : "Start"}
        </PaperButton>
        {questions.error ? (
          <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
            {questions.error.message}
          </p>
        ) : null}
      </PaperCard>
    );
  }

  return (
    <PaperCard className="max-w-[760px] p-6">
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
          className={cn(PAPER_INPUT, "mt-3 w-full")}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PaperButton disabled={index === 0 || draft.isPending} onClick={() => setIndex(index - 1)}>
          Back
        </PaperButton>
        {last ? (
          <PaperButton variant="amber" disabled={draft.isPending} onClick={finish}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            {draft.isPending ? "Hermes is drafting your Compass… (usually under a minute, sometimes up to five)" : "Draft my Compass"}
          </PaperButton>
        ) : (
          <PaperButton variant="amber" onClick={() => setIndex(index + 1)}>
            {answers[index]?.trim() ? "Next" : "Skip"}
          </PaperButton>
        )}
        {!last ? (
          <PaperButton variant="ghost" disabled={draft.isPending} onClick={finish}>
            Draft now with what I have
          </PaperButton>
        ) : null}
      </div>
      {draft.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {draft.error.message}
        </p>
      ) : null}
    </PaperCard>
  );
}
