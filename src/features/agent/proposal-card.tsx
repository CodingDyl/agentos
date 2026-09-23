import { ArrowRight, Check, Minus, Pencil, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ApprovalRequest } from "@shared/agentos-types";
import { HairlineCard, CommandButton, SectionLabel } from "@/components/os";
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
  add: "text-os-amber",
  complete: "text-os-success",
  remove: "text-os-danger",
  edit: "text-os-subtle",
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
export function ProposalCard({
  proposal,
  approval,
  onApply,
  onReject,
  isResponding = false,
  error,
  className,
}: ProposalCardProps) {
  const changed = changedFileCount(proposal);
  const isPending = approval?.status === "pending";

  return (
    <HairlineCard
      className={cn("max-w-[74ch] p-5 md:p-6", className)}
      role={isPending ? "alertdialog" : undefined}
      aria-label="Proposed update to AgentOS"
    >
      <SectionLabel
        className="text-os-amber"
        action={
          <span className="text-os-subtle">
            {changed} {changed === 1 ? "file" : "files"}
          </span>
        }
      >
        Proposed update
      </SectionLabel>

      <ul className="mt-5 space-y-6">
        {proposal.files.map((file) => (
          <li key={file.file} className="min-w-0">
            <p className="font-mono text-[13px] leading-5 text-foreground">
              {file.file}
            </p>

            {file.unchanged || file.changes.length === 0 ? (
              <p className="mt-2 text-[13px] leading-5 text-os-subtle">
                No change
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {file.changes.map((change, index) => {
                  const Icon = CHANGE_ICON[change.kind];

                  return (
                    <li
                      key={`${change.kind}-${index}-${change.text}`}
                      className="flex items-start gap-3 text-[15px] leading-6"
                    >
                      <Icon
                        className={cn(
                          "mt-1 size-3.5 shrink-0",
                          CHANGE_TONE[change.kind],
                        )}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 text-os-muted">
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
        <div className="mt-6 border-t border-os-border pt-5">
          {/* The second, separate question: not "is this edit right?" but
              "may Hermes run this?". Both are shown, so approving the change
              is never a blind approval of the command that performs it. */}
          <SectionLabel className="text-os-warning">System approval</SectionLabel>
          <p className="mt-3 text-[13px] leading-5 text-os-subtle">
            Applying runs this, once:
          </p>
          <GatedCommand request={approval} className="mt-2" />
        </div>
      ) : null}

      {isPending ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <CommandButton
            variant="primary"
            icon={ArrowRight}
            disabled={isResponding}
            loading={isResponding}
            loadingLabel="Applying"
            onClick={onApply}
          >
            Apply changes
          </CommandButton>
          <CommandButton
            variant="danger"
            disabled={isResponding}
            onClick={onReject}
          >
            Reject
          </CommandButton>
        </div>
      ) : approval ? (
        <ApprovalOutcome request={approval} className="mt-6" />
      ) : (
        <p className="mt-6 text-[13px] leading-5 text-os-subtle">
          Hermes has not asked for a decision on this yet.
        </p>
      )}

      {error ? (
        <p className="mt-4 text-[13px] leading-5 text-os-danger">
          {error} Nothing has been changed.
        </p>
      ) : null}
    </HairlineCard>
  );
}
