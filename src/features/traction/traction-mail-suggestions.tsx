import { Mail } from "lucide-react";
import type { MailSuggestion, TractionData } from "@shared/traction-types";
import { PaperButton, PaperCard, PaperSection } from "@/components/paper";
import { useConfirmMailLink, useDismissMailSuggestion } from "@/lib/agentos/traction";
import { formatShortDate, stageLabel } from "./traction-model";

/**
 * Gmail replies that look like they belong to a prospect.
 *
 * Asked, never assumed. A reply from a contacted prospect probably means a
 * conversation has started — but "probably" is not good enough to change
 * sales state, so each one is a question with three answers: move and link,
 * link only, or not theirs. Nothing changes until one is chosen.
 *
 * Matching is by address or by the prospect's website domain; no model reads
 * the thread, so this says "reply", not "positive reply".
 */
export function TractionMailSuggestions({ data }: { data: TractionData }) {
  if (data.mailSuggestions.length === 0) return null;

  return (
    <PaperSection label="Replies to check" count={data.mailSuggestions.length}>
      <ul className="space-y-3">
        {data.mailSuggestions.slice(0, 5).map((suggestion) => (
          <SuggestionRow key={suggestion.threadId} suggestion={suggestion} />
        ))}
      </ul>
      {data.mailSuggestions.length > 5 ? (
        <p className="mt-3 text-[12.5px] text-paper-sage">+{data.mailSuggestions.length - 5} more. Answer these first.</p>
      ) : null}
    </PaperSection>
  );
}

function SuggestionRow({ suggestion }: { suggestion: MailSuggestion }) {
  const confirm = useConfirmMailLink();
  const dismiss = useDismissMailSuggestion();
  const busy = confirm.isPending || dismiss.isPending;
  const sender = suggestion.fromName ?? suggestion.fromEmail ?? "Someone";

  return (
    <li>
      <PaperCard>
        <div className="flex items-start gap-3">
          <Mail className="mt-1 size-4 shrink-0 text-paper-sage" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-6 text-paper-moss">
              {suggestion.moveTo ? "A reply from " : "An email from "}
              <span className="font-semibold">{suggestion.company}</span>
              <span className="text-paper-sage">
                {" "}
                · {sender} · {formatShortDate(suggestion.messageDate)}
                {suggestion.match === "domain" ? " · matched by their website's domain" : ""}
              </span>
            </p>
            <p className="truncate text-[13px] text-paper-char">“{suggestion.subject}”</p>

            {suggestion.moveTo && suggestion.moveFrom ? (
              <p className="mt-2 text-[13.5px] font-medium text-paper-moss">
                Move {stageLabel(suggestion.moveFrom)} → {stageLabel(suggestion.moveTo)}?
              </p>
            ) : (
              <p className="mt-2 text-[13.5px] font-medium text-paper-moss">Link this thread to {suggestion.company}?</p>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestion.moveTo ? (
                <PaperButton
                  variant="amber"
                  disabled={busy}
                  onClick={() => confirm.mutate({ threadId: suggestion.threadId, prospectId: suggestion.prospectId, moveTo: suggestion.moveTo })}
                >
                  Confirm
                </PaperButton>
              ) : null}
              <PaperButton
                variant={suggestion.moveTo ? "ghost" : "amber"}
                disabled={busy}
                onClick={() => confirm.mutate({ threadId: suggestion.threadId, prospectId: suggestion.prospectId })}
              >
                {suggestion.moveTo ? "Link only" : "Link"}
              </PaperButton>
              <PaperButton disabled={busy} onClick={() => dismiss.mutate(suggestion.threadId)}>
                Not theirs
              </PaperButton>
            </div>
            {confirm.error ?? dismiss.error ? (
              <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
                {(confirm.error ?? dismiss.error)?.message}
              </p>
            ) : null}
          </div>
        </div>
      </PaperCard>
    </li>
  );
}
