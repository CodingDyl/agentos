import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CommandButton, SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import { useWorkspaceFeedback } from "./use-workspace-feedback";

/**
 * A field you edit where it is written.
 *
 * The whole affordance is a heading, the text, and a pencil. No settings page,
 * no dialog, no agent — 53.1's rule change made concrete: a person editing
 * their own notes does not ask permission, and the shortest path from "this
 * sentence is out of date" to "it is not any more" is the feature.
 *
 * `⌘Enter` saves and `Escape` cancels, because this is a textarea and Enter has
 * to stay available for the paragraph breaks these fields actually contain.
 */
export interface InlineEditProps {
  label: string;
  value?: string;
  placeholder?: string;
  /** Saves. Resolves when the write landed, rejects with the failure. */
  onSave: (body: string) => Promise<unknown>;
  /** Re-reads after a conflict, so the retry is composed against the truth. */
  onReload?: () => void;
  busy?: boolean;
  /** Shown instead of the value when there is one — e.g. rendered markdown. */
  children?: ReactNode;
  rows?: number;
}

export function InlineEdit({
  label,
  value,
  placeholder = "Nothing recorded.",
  onSave,
  onReload,
  busy = false,
  children,
  rows = 4,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
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

  if (!editing) {
    return (
      <section>
        <SectionLabel
          action={
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(value ?? "");
                setEditing(true);
              }}
              className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1.5 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </button>
          }
        >
          {label}
        </SectionLabel>

        <div className="mt-4">
          {children ?? (
            <p
              className={cn(
                "max-w-[80ch] text-[15px] leading-6 whitespace-pre-wrap",
                value ? "text-os-muted" : "text-os-subtle",
              )}
            >
              {value ?? placeholder}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel>{label}</SectionLabel>

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <textarea
          autoFocus
          rows={rows}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);

            // Enter belongs to the paragraph; the modifier commits.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void commit();
            }
          }}
          className="os-focus-ring w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CommandButton
            type="submit"
            variant="primary"
            loading={saving}
            loadingLabel="Saving"
          >
            Save
          </CommandButton>
          <CommandButton variant="quiet" onClick={() => setEditing(false)}>
            Cancel
          </CommandButton>
          <span className="os-meta ml-1 text-os-subtle">⌘↩ to save</span>
        </div>
      </form>
    </section>
  );
}
