import { Pencil } from "lucide-react";
import { useState } from "react";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useWorkspaceFeedback } from "@/features/workspace";
import { cn } from "@/lib/utils";

/**
 * The paper twin of `InlineEdit`: a heading, the text, and an Edit link that
 * swaps the paragraph for a textarea and writes the one section it belongs to.
 *
 * Same contract — `⌘Enter` saves, `Escape` cancels, the undo offer comes from
 * the shared feedback layer — drawn in the paper world's type and controls.
 */
export function PaperInlineEdit({
  label,
  value,
  placeholder,
  onSave,
  onReload,
  busy = false,
  rows = 4,
  emphasis = false,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onSave: (body: string) => Promise<unknown>;
  onReload?: () => void;
  busy?: boolean;
  rows?: number;
  /** The goal reads as the page's thesis: larger than body text. */
  emphasis?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const feedback = useWorkspaceFeedback();

  const commit = async () => {
    if (draft.trim().length === 0) return;
    setSaving(true);
    try {
      const result = (await onSave(draft)) as { undoId?: string } | undefined;
      feedback.recordEdit(`${label} updated.`, result?.undoId);
      setEditing(false);
    } catch (error) {
      feedback.reportFailure(error, onReload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-paper-display text-[15px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">{label}</h2>
        {!editing ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(value ?? "");
              setEditing(true);
            }}
            className={cn(
              "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[4px] px-2 text-[13px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss disabled:cursor-not-allowed disabled:opacity-50",
              PAPER_FOCUS,
            )}
          >
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Edit
            <span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void commit();
          }}
        >
          <textarea
            autoFocus
            rows={rows}
            aria-label={label}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void commit();
              }
            }}
            className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PaperButton type="submit" variant="amber" disabled={saving || draft.trim().length === 0}>
              {saving ? "Saving…" : "Save"}
            </PaperButton>
            <PaperButton variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </PaperButton>
            <span className="ml-1 text-[12px] text-paper-sage">⌘↵ to save</span>
          </div>
        </form>
      ) : (
        <p
          className={cn(
            "mt-1.5 max-w-[68ch] whitespace-pre-wrap",
            emphasis ? "font-paper-display text-[19px] leading-[1.45] font-medium tracking-[-0.005em]" : "text-[15px] leading-6",
            value ? "text-paper-char" : "text-paper-sage",
          )}
        >
          {value || placeholder}
        </p>
      )}
    </section>
  );
}
