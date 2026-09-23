import { Check, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "@shared/agentos-types";
import { HairlineCard, CommandButton, SectionLabel } from "@/components/os";
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
export function GatedCommand({
  request,
  className,
}: {
  request: ApprovalRequest;
  className?: string;
}) {
  if (!request.command) {
    return (
      <p className={cn("text-[15px] leading-6 text-os-subtle", className)}>
        Hermes did not name the action it is asking about.
      </p>
    );
  }

  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-md border border-os-border bg-os-surface-raised p-4",
        className,
      )}
    >
      <code className="font-mono text-[13px] leading-5 text-foreground">
        {request.command}
      </code>
    </pre>
  );
}

/** How a decision that has already been recorded reads back. */
export function ApprovalOutcome({
  request,
  className,
}: {
  request: ApprovalRequest;
  className?: string;
}) {
  const denied = request.status === "denied";
  const Icon = denied ? X : Check;

  return (
    <p
      className={cn(
        "os-meta flex items-center gap-2",
        denied ? "text-os-danger" : "text-os-success",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {denied ? "Denied — nothing was changed" : "Approved"}
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
export function ApprovalCard({
  request,
  onRespond,
  isResponding = false,
  error,
  className,
}: ApprovalCardProps) {
  // `always` removes this gate permanently. That is not a primary-button
  // decision, so it lives behind an explicit extra step.
  const [showMore, setShowMore] = useState(false);
  const isPending = request.status === "pending";

  return (
    <HairlineCard
      className={cn("max-w-[62ch] p-5 md:p-6", className)}
      role="alertdialog"
      aria-label="System approval required"
    >
      <SectionLabel className="text-os-warning">System approval</SectionLabel>

      <p className="mt-4 text-[15px] leading-6 text-os-muted">
        Hermes wants to execute:
      </p>

      <GatedCommand request={request} className="mt-3" />

      {request.description ? (
        <p className="mt-4 text-[13px] leading-5 text-os-subtle">
          {request.description}
        </p>
      ) : null}

      {isPending ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <CommandButton
              variant="primary"
              disabled={isResponding}
              onClick={() => onRespond("once")}
            >
              Allow once
            </CommandButton>
            <CommandButton
              variant="secondary"
              disabled={isResponding}
              onClick={() => onRespond("session")}
            >
              Allow session
            </CommandButton>
            <CommandButton
              variant="danger"
              disabled={isResponding}
              onClick={() => onRespond("deny")}
            >
              Deny
            </CommandButton>
            <button
              type="button"
              aria-expanded={showMore}
              aria-label="More approval options"
              onClick={() => setShowMore((open) => !open)}
              className="os-focus-ring inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-os-subtle transition-colors duration-150 hover:bg-os-surface-raised hover:text-foreground"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </div>

          {showMore ? (
            <div className="mt-4 border-t border-os-border pt-4">
              <CommandButton
                variant="quiet"
                disabled={isResponding}
                onClick={() => onRespond("always")}
              >
                Always allow
              </CommandButton>
              <p className="mt-3 max-w-[52ch] text-[13px] leading-5 text-os-subtle">
                Removes this gate permanently, for every future run. Hermes will
                not ask again.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <ApprovalOutcome request={request} className="mt-6" />
      )}

      {error ? (
        <p className="mt-4 text-[13px] leading-5 text-os-danger">
          {error} The request is still waiting.
        </p>
      ) : null}
    </HairlineCard>
  );
}
