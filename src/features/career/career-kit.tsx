import { useState, type ReactNode } from "react";
import { CAREER_MEMORY_KINDS, CAREER_MEMORY_LABELS, type CareerMemoryKind } from "@shared/career-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { TEXTAREA } from "./career-model";
import { useSaveCareerMemory } from "@/lib/agentos/career";
import { cn } from "@/lib/utils";

/** A mutation's error, said in words, in the place it happened. */
export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-[13.5px] leading-6 text-paper-flame-deep">
      {error instanceof Error ? error.message : "That did not work."}
    </p>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

/**
 * "Save to memory" as a proposal a person edits before it is saved: Career
 * never writes memory on its own, and routine admin never becomes memory.
 */
export function MemoryProposalButton({
  defaultKind,
  defaultTitle,
  defaultBody,
  source,
  label = "Propose memory",
}: {
  defaultKind: CareerMemoryKind;
  defaultTitle: string;
  defaultBody: string;
  source?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CareerMemoryKind>(defaultKind);
  const [title, setTitle] = useState(defaultTitle.slice(0, 140));
  const [body, setBody] = useState(defaultBody);
  const [duplicates, setDuplicates] = useState(false);
  const save = useSaveCareerMemory();

  if (save.isSuccess) {
    const target = save.data.outcome.target;
    return <p className="text-[13px] text-paper-green">Saved to memory{target ? ` · ${target}` : ""}.</p>;
  }

  if (!open) {
    return (
      <PaperButton variant="quiet" className="-mx-2" onClick={() => setOpen(true)}>
        {label}
      </PaperButton>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 border border-paper-mist bg-paper-linen p-3"
      aria-label="Memory proposal"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { kind, title, body, source, acknowledgedDuplicates: duplicates || undefined },
          { onError: (error) => setDuplicates(/duplicate|already/i.test(error.message)) },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Kind">
          <select className={cn(PAPER_INPUT, "w-full")} value={kind} onChange={(event) => setKind(event.target.value as CareerMemoryKind)}>
            {CAREER_MEMORY_KINDS.map((value) => (
              <option key={value} value={value}>
                {CAREER_MEMORY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input className={cn(PAPER_INPUT, "w-full")} value={title} maxLength={140} required minLength={3} onChange={(event) => setTitle(event.target.value)} />
        </Field>
      </div>
      <Field label="What to remember">
        <textarea className={TEXTAREA} value={body} maxLength={4000} required onChange={(event) => setBody(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <PaperButton type="submit" variant="amber" disabled={save.isPending}>
          {save.isPending ? "Saving…" : duplicates ? "Save anyway" : "Save to memory"}
        </PaperButton>
        <PaperButton onClick={() => setOpen(false)}>Cancel</PaperButton>
      </div>
      <ErrorLine error={save.error} />
    </form>
  );
}
