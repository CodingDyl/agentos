import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  CommandButton,
  EmptyState,
  HairlineCard,
  SectionLabel,
} from "@/components/os";
import {
  useDeleteDecision,
  useEditableDecisions,
  useWriteDecision,
} from "@/lib/agentos/queries";
import { InlineEdit } from "./inline-edit";
import { useWorkspaceFeedback } from "./use-workspace-feedback";

/**
 * Decisions, written directly.
 *
 * Worth a word on shape, because it is not the obvious one. The vault keeps
 * decisions as **topic sections** — `## Navigation`, `## AI Chef` — each
 * holding the current position, revised as thinking changes. Not a dated feed.
 *
 * AgentOS follows that rather than imposing a reverse-chronological log on top,
 * because the topic structure answers the question a decisions file is actually
 * for: *what did we settle about navigation?* A dated log answers *what did I
 * decide on the fifth*, which nobody asks. The date is recorded inside the
 * section so it stays visible without becoming the organising principle.
 *
 * Editing one is therefore a revision, not an append — which is why each entry
 * is an inline edit rather than a new-entry form.
 */
export function DecisionsEditor({ project }: { project: string }) {
  const { data, isPending, refetch } = useEditableDecisions(project);
  const [adding, setAdding] = useState(false);

  const write = useWriteDecision(project);
  const remove = useDeleteDecision(project);
  const feedback = useWorkspaceFeedback();

  const decisions = data?.decisions ?? [];
  const revision = data?.revision;

  if (isPending) {
    return <p className="text-[15px] leading-6 text-os-muted">Reading DECISIONS.md…</p>;
  }

  return (
    <div className="space-y-10">
      <SectionLabel
        action={
          <button
            type="button"
            onClick={() => setAdding((open) => !open)}
            className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1.5 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Decision
          </button>
        }
      >
        {decisions.length === 1 ? "1 decision" : `${decisions.length} decisions`}
      </SectionLabel>

      {adding ? (
        <NewDecision
          busy={write.isPending}
          onCancel={() => setAdding(false)}
          onSave={(title, body) =>
            write.mutate(
              {
                title,
                body,
                decidedOn: new Date().toISOString().slice(0, 10),
                expectedRevision: revision,
              },
              {
                onSuccess: (result) => {
                  feedback.recordEdit(`${title} recorded.`, result.undoId);
                  setAdding(false);
                },
                onError: (error) => feedback.reportFailure(error, () => void refetch()),
              },
            )
          }
        />
      ) : null}

      {decisions.length === 0 && !adding ? (
        <EmptyState
          label="No decisions"
          description="Nothing has been settled in writing for this project yet."
        />
      ) : null}

      {decisions.map((decision) => (
        <HairlineCard key={decision.title} className="p-5">
          <InlineEdit
            label={decision.title}
            value={decision.body}
            rows={5}
            onReload={() => void refetch()}
            onSave={(body) =>
              write.mutateAsync({
                title: decision.title,
                body,
                decidedOn: decision.decidedOn,
                expectedRevision: revision,
              })
            }
          />

          <div className="mt-4 flex items-center justify-between gap-4 border-t border-os-border pt-3">
            <span className="os-meta text-os-subtle">
              {decision.decidedOn ? `Decided ${decision.decidedOn}` : "Undated"}
            </span>

            <button
              type="button"
              aria-label={`Remove ${decision.title}`}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(decision.title, {
                  onSuccess: (result) =>
                    feedback.recordEdit(`${decision.title} removed.`, result.undoId),
                  onError: (error) =>
                    feedback.reportFailure(error, () => void refetch()),
                })
              }
              className="os-focus-ring cursor-pointer rounded-md p-1 text-os-subtle transition-colors duration-150 hover:text-os-danger disabled:cursor-not-allowed"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </HairlineCard>
      ))}
    </div>
  );
}

function NewDecision({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (title: string, body: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  return (
    <HairlineCard className="p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim().length === 0 || body.trim().length === 0) return;

          onSave(title, body);
        }}
      >
        <label className="block">
          <SectionLabel>Topic</SectionLabel>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Worker routing"
            className="os-focus-ring mt-3 w-full rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
          />
        </label>

        <label className="mt-5 block">
          <SectionLabel>What was decided</SectionLabel>
          <textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Use Grok as the implementation worker. Hermes remains the orchestrator."
            className="os-focus-ring mt-3 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <CommandButton
            type="submit"
            variant="primary"
            loading={busy}
            loadingLabel="Recording"
          >
            Record
          </CommandButton>
          <CommandButton variant="quiet" onClick={onCancel}>
            Cancel
          </CommandButton>
        </div>
      </form>
    </HairlineCard>
  );
}
