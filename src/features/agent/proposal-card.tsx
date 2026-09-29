import { ArrowRight, Check, Minus, Pencil, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ApprovalRequest } from "@shared/agentos-types";
import { PaperButton, PaperCard } from "@/components/paper";
import { cn } from "@/lib/utils";
import { ApprovalOutcome, GatedCommand } from "./approval-card";
import { changedFileCount, type ChangeKind, type ChangeProposal } from "./proposal";

const CHANGE_ICON: Record<ChangeKind, LucideIcon> = {
  add: Plus,
  complete: Check,
  remove: Minus,
  edit: Pencil,
};

/** Colour carries the kind, but the icon and text carry it too — never colour alone. */
const CHANGE_TONE: Record<ChangeKind, string> = {
  add: "text-paper-amber-deep",
  complete: "text-paper-char",
  remove: "text-paper-flame-deep",
  edit: "text-paper-sage",
};

export interface ProposalCardProps {
  proposal: ChangeProposal;
  /**
   * The system approval gating the change, when one is live. Its command is
   * shown so the operator can see exactly what will execute.
   */
  approval?: ApprovalRequest;
  /**
   * Applying answers the gate for this one action only — a proposal is never
   * approved for a session or permanently.
   */
  onApply: () => void;
  onReject: () => void;
  isResponding?: boolean;
  error?: string;
  className?: string;
}

/**
 * An *AgentOS proposal*: is this change to project state correct?
 *
 * Distinct from a system approval, which only asks whether Hermes may execute
 * something. A command can be perfectly safe and still be the wrong edit, so
 * this card asks the substantive question and shows the change file by file.
 *
 * It renders what Hermes said it will do. Nothing here applies a change and
 * nothing is written locally — approving lets Hermes act, and the console
 * re-reads the vault afterwards to find out what actually happened.
 */
export function ProposalCard({ proposal, approval, onApply, onReject, isResponding = false, error, className }: ProposalCardProps) {
  const changed = changedFileCount(proposal);
  const isPending = approval?.status === "pending";

  return (
    <PaperCard
      className={cn("max-w-[74ch] p-5", isPending && "border-paper-gold", className)}
      role={isPending ? "alertdialog" : undefined}
      aria-label="Proposed update to AgentOS"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">Proposed update</h2>
        <span className="text-[12.5px] text-paper-sage">
          {changed} {changed === 1 ? "file" : "files"}
        </span>
      </div>

      <ul className="mt-4 space-y-5">
        {proposal.files.map((file) => (
          <li key={file.file} className="min-w-0">
            <p className="font-mono text-[13px] leading-5 text-paper-moss">{file.file}</p>

            {file.unchanged || file.changes.length === 0 ? (
              <p className="mt-1.5 text-[13.5px] leading-5 text-paper-sage">No change</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {file.changes.map((change, index) => {
                  const Icon = CHANGE_ICON[change.kind];

                  return (
                    <li key={`${change.kind}-${index}-${change.text}`} className="flex items-start gap-3 text-[15px] leading-6">
                      <Icon className={cn("mt-1 size-3.5 shrink-0", CHANGE_TONE[change.kind])} strokeWidth={1.75} aria-hidden="true" />
                      <span className="min-w-0 text-paper-char">
                        <span className="sr-only">{change.kind}: </span>
                        {change.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {approval ? (
        <div className="mt-5 border-t border-paper-mist pt-4">
          {/* The second, separate question: not "is this edit right?" but
              "may Hermes run this?". Both are shown, so approving the change
              is never a blind approval of the command that performs it. */}
          <h3 className="text-[13.5px] font-semibold text-paper-moss">System approval</h3>
          <p className="mt-1.5 text-[13.5px] leading-5 text-paper-sage">Applying runs this, once:</p>
          <GatedCommand request={approval} className="mt-2" />
        </div>
      ) : null}

      {isPending ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" disabled={isResponding} onClick={onApply}>
            {isResponding ? "Applying…" : "Apply changes"}
            {isResponding ? null : <ArrowRight className="size-3.5" aria-hidden="true" />}
          </PaperButton>
          <PaperButton variant="danger" disabled={isResponding} onClick={onReject}>
            Reject
          </PaperButton>
        </div>
      ) : approval ? (
        <ApprovalOutcome request={approval} className="mt-5" />
      ) : (
        <p className="mt-5 text-[13.5px] leading-5 text-paper-sage">Hermes has not asked for a decision on this yet.</p>
      )}

      {error ? <p className="mt-4 text-[13.5px] leading-5 text-paper-flame-deep">{error} Nothing has been changed.</p> : null}
    </PaperCard>
  );
}
