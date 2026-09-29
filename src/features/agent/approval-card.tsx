import { Check, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "@shared/agentos-types";
import { PAPER_FOCUS, PaperButton, PaperCard } from "@/components/paper";
import { cn } from "@/lib/utils";

export interface ApprovalCardProps {
  request: ApprovalRequest;
  onRespond: (decision: ApprovalDecision) => void;
  isResponding?: boolean;
  /** Why the last decision could not be recorded. The gate stays closed. */
  error?: string;
  className?: string;
}

/** The exact action being gated, shown verbatim and never paraphrased. */
export function GatedCommand({ request, className }: { request: ApprovalRequest; className?: string }) {
  if (!request.command) {
    return <p className={cn("text-[14px] leading-6 text-paper-sage", className)}>Hermes did not name the action it is asking about.</p>;
  }

  return (
    <pre className={cn("overflow-x-auto rounded-none border border-paper-mist bg-paper-linen p-4", className)}>
      <code className="font-mono text-[13px] leading-5 text-paper-moss">{request.command}</code>
    </pre>
  );
}

/** How a decision that has already been recorded reads back. */
export function ApprovalOutcome({ request, className }: { request: ApprovalRequest; className?: string }) {
  const denied = request.status === "denied";
  const Icon = denied ? X : Check;

  return (
    <p className={cn("flex items-center gap-2 text-[13.5px] font-semibold", denied ? "text-paper-flame-deep" : "text-paper-char", className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {denied ? "Denied. Nothing was changed" : "Approved"}
    </p>
  );
}

/**
 * A *system* approval: may Hermes execute this action?
 *
 * This is not the same question as whether a proposed change to AgentOS state
 * is correct — a safe command can still be the wrong edit. When Hermes has
 * proposed a change, the proposal card asks that second question, and this card
 * is not used on its own.
 *
 * Shown only when capabilities advertise approvals *and* a request has actually
 * arrived. Hermes may handle guarded commands itself without surfacing one.
 */
export function ApprovalCard({ request, onRespond, isResponding = false, error, className }: ApprovalCardProps) {
  // `always` removes this gate permanently. That is not a primary-button
  // decision, so it lives behind an explicit extra step.
  const [showMore, setShowMore] = useState(false);
  const isPending = request.status === "pending";

  return (
    <PaperCard
      className={cn("max-w-[62ch] p-5", isPending && "border-paper-gold", className)}
      role="alertdialog"
      aria-label="System approval required"
    >
      <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">System approval</h2>

      <p className="mt-3 text-[14px] leading-6 text-paper-char">Hermes wants to execute:</p>

      <GatedCommand request={request} className="mt-2" />

      {request.description ? <p className="mt-3 text-[13.5px] leading-5 text-paper-sage">{request.description}</p> : null}

      {isPending ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PaperButton variant="amber" disabled={isResponding} onClick={() => onRespond("once")}>
              Allow once
            </PaperButton>
            <PaperButton variant="ghost" disabled={isResponding} onClick={() => onRespond("session")}>
              Allow session
            </PaperButton>
            <PaperButton variant="danger" disabled={isResponding} onClick={() => onRespond("deny")}>
              Deny
            </PaperButton>
            <button
              type="button"
              aria-expanded={showMore}
              aria-label="More approval options"
              onClick={() => setShowMore((open) => !open)}
              className={cn(
                "inline-flex size-9 cursor-pointer items-center justify-center rounded-none text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
                PAPER_FOCUS,
              )}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </div>

          {showMore ? (
            <div className="mt-4 border-t border-paper-mist pt-4">
              <PaperButton variant="quiet" disabled={isResponding} onClick={() => onRespond("always")}>
                Always allow
              </PaperButton>
              <p className="mt-3 max-w-[52ch] text-[13px] leading-5 text-paper-sage">
                Removes this gate permanently, for every future run. Hermes will not ask again.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <ApprovalOutcome request={request} className="mt-5" />
      )}

      {error ? <p className="mt-4 text-[13.5px] leading-5 text-paper-flame-deep">{error} The request is still waiting.</p> : null}
    </PaperCard>
  );
}
