import { useState } from "react";
import type { Persona } from "@shared/startup-types";
import { PaperButton, PaperCard } from "@/components/paper";
import { StageFields, type FieldSpec } from "./stage-form";

const PERSONA_FIELDS: readonly FieldSpec[] = [
  { key: "name", label: "Name", kind: "text", hint: "A first name makes the reviews easier to read." },
  { key: "role", label: "Role", kind: "text" },
  { key: "industry", label: "Industry", kind: "text" },
  { key: "seniority", label: "Seniority", kind: "text" },
  { key: "summary", label: "Who they are", kind: "area" },
  { key: "dayToDay", label: "Their working day", kind: "list", hint: "Specific tasks, not themes. Reviews walk through these." },
  { key: "tools", label: "Tools they use now", kind: "list" },
  { key: "pains", label: "What frustrates them", kind: "list" },
  { key: "buying", label: "How they buy software", kind: "area", hint: "Who decides, who signs, what it must cost." },
  { key: "sceptical", label: "What makes them sceptical", kind: "list" },
  { key: "behaviour", label: "Behaviour rules", kind: "list", hint: "How this persona must answer. Honesty rules are always added." },
];

/** Edits a persona before it goes into the shared library. */
export function PersonaEditor({
  persona,
  notice,
  saving,
  error,
  onSave,
  onCancel,
}: {
  persona: Persona;
  notice?: string;
  saving: boolean;
  error?: string;
  onSave: (persona: Persona) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<Persona>(persona);

  return (
    <PaperCard className="p-6">
      {notice ? <p className="mb-5 bg-paper-linen px-4 py-3 text-[13.5px] leading-6 text-paper-char">{notice}</p> : null}
      <StageFields fields={PERSONA_FIELDS} value={value as unknown as Record<string, unknown>} onChange={(next) => setValue(next as unknown as Persona)} />
      <div className="mt-6 flex flex-wrap gap-2">
        <PaperButton variant="amber" disabled={saving || !(value.name.trim() || value.role.trim())} onClick={() => onSave(value)}>
          {saving ? "Saving…" : "Save to the library"}
        </PaperButton>
        {onCancel ? <PaperButton onClick={onCancel}>Cancel</PaperButton> : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error}
        </p>
      ) : null}
    </PaperCard>
  );
}
