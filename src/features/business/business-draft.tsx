import { useState } from "react";
import type { BusinessDraftRequest } from "@shared/business-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useCreateClientDraft } from "@/lib/agentos/business";
import { cn } from "@/lib/utils";

/**
 * Writes a draft into Gmail. The person edits the text here, AgentOS puts it
 * in Drafts, and the person sends it from Gmail. Nothing is ever sent here.
 */
export function ClientDraftForm({
  request,
  initialSubject,
  initialBody = "",
  showSubject,
  onClose,
}: {
  request: Omit<BusinessDraftRequest, "subject" | "body">;
  initialSubject?: string;
  initialBody?: string;
  /** Replies take their subject from the thread, so they hide it. */
  showSubject: boolean;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody);
  const create = useCreateClientDraft();

  if (create.data) {
    return (
      <p role="status" className="text-[13.5px] text-paper-char">
        Draft to {create.data.to} is in Gmail.{" "}
        <a href={create.data.url} target="_blank" rel="noreferrer" className="text-paper-blue hover:underline">
          Open Drafts
        </a>{" "}
        to review and send it.
      </p>
    );
  }

  return (
    <form
      className="grid max-w-[70ch] gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ ...request, subject: showSubject ? subject : undefined, body });
      }}
    >
      {showSubject ? (
        <label>
          <FieldLabel>Subject</FieldLabel>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} required className={cn(PAPER_INPUT, "w-full")} />
        </label>
      ) : null}
      <label>
        <FieldLabel>Message</FieldLabel>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} maxLength={20_000} required className={cn(PAPER_INPUT, "w-full py-2 leading-6")} />
      </label>
      <div className="flex flex-wrap gap-2">
        <PaperButton type="submit" variant="amber" disabled={create.isPending || !body.trim()}>
          {create.isPending ? "Saving…" : "Save to Gmail drafts"}
        </PaperButton>
        <PaperButton variant="quiet" onClick={onClose}>
          Cancel
        </PaperButton>
      </div>
      {create.error ? <p role="alert" className="text-[13px] text-paper-flame-deep">{create.error.message}</p> : null}
    </form>
  );
}
