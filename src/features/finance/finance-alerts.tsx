import type { Attention, FinanceTab } from "@shared/finance-types";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { PaperButton, PaperSection, Tag } from "@/components/paper";
import { useDismissAlert, useRestoreAlert } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { MutationError } from "./finance-kit";
import { forgetDismissed, rememberDismissed, useDismissedNotice } from "./finance-ui-hooks";

const TAB_LABEL: Record<FinanceTab, string> = {
  overview: "Overview",
  "cash-flow": "Cash flow",
  spending: "Spending",
  subscriptions: "Subscriptions",
  bills: "Bills",
  shared: "Shared costs",
  goals: "Goals",
  savings: "Savings plan",
  investments: "Investments",
  insights: "Insights",
  analyser: "Analyser",
  settings: "Settings",
};

/** Where an alert came from, as a tag: the part of Finance whose numbers raised it. */
export function SourceTag({ source }: { source: Attention["source"] }) {
  return <Tag tone="muted">{source}</Tag>;
}

/**
 * Dismisses an alert until the month ends and offers to undo it. "Not relevant"
 * is the person's call, so it is one click, reversible, and never silent.
 */
export function DismissAlertButton({ id, text, className }: { id: string; text: string; className?: string }) {
  const dismiss = useDismissAlert();

  return (
    <>
      <button
        type="button"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate({ id, scope: "month" }, { onSuccess: () => rememberDismissed({ id, text }) })}
        aria-label={`Dismiss: ${text}`}
        title="Not relevant: hide until next month"
        className={cn(
          "inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-none border border-paper-mist bg-paper-white px-2 text-[12.5px] font-medium text-paper-char transition-colors duration-150 hover:border-paper-char hover:bg-paper-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue disabled:cursor-default disabled:opacity-50",
          className,
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
        Dismiss
      </button>
      <MutationError error={dismiss.error} />
    </>
  );
}

/** Says what was just dismissed, and lets you undo it or hide it for good. */
export function AlertUndoBar() {
  const notice = useDismissedNotice();
  const restore = useRestoreAlert();
  const always = useDismissAlert();

  if (!notice) return null;

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-none border border-paper-mist bg-paper-linen px-3.5 py-2.5 text-[13.5px] leading-6 text-paper-moss">
      <span className="min-w-0">
        Dismissed until next month: <span className="text-paper-char">{notice.text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <PaperButton
          disabled={restore.isPending}
          onClick={() => restore.mutate(notice.id, { onSuccess: forgetDismissed })}
        >
          Undo
        </PaperButton>
        <PaperButton
          variant="quiet"
          disabled={always.isPending}
          onClick={() => always.mutate({ id: notice.id, scope: "always" }, { onSuccess: forgetDismissed })}
        >
          Never show this again
        </PaperButton>
      </span>
    </div>
  );
}

/**
 * Alerts as a list: what happened, where it came from, why you are seeing it,
 * where to look, and a way to say it is not relevant. Used on Overview and Insights.
 */
export function AttentionSection({ label, items, onOpen, hrefFor }: { label: string; items: readonly Attention[]; onOpen?: (tab: FinanceTab) => void; hrefFor?: (tab: FinanceTab) => string }) {
  if (items.length === 0) return null;

  return (
    <PaperSection label={label} count={items.length}>
      <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14.5px] leading-6 text-paper-moss">
                <span aria-hidden="true" className={cn("w-3 shrink-0 text-center font-semibold", item.tone === "warn" ? "text-paper-flame-deep" : "text-paper-sage")}>
                  {item.tone === "warn" ? "!" : "○"}
                </span>
                <span className="sr-only">{item.tone === "warn" ? "Needs action: " : "For your information: "}</span>
                <SourceTag source={item.source} />
                <span className="min-w-0">{item.text}</span>
              </p>
              <p className="mt-1 pl-5 text-[13px] leading-5 text-paper-char">{item.detail}</p>
              <p className="mt-1.5 pl-5 text-[12.5px]">
                {hrefFor ? (
                  <Link to={hrefFor(item.tab)} className="rounded-sm text-paper-sage underline-offset-4 hover:text-paper-moss hover:underline">
                    Open {TAB_LABEL[item.tab]} →
                  </Link>
                ) : (
                  <button type="button" onClick={() => onOpen?.(item.tab)} className="cursor-pointer rounded-none text-paper-sage underline-offset-4 hover:text-paper-moss hover:underline focus-visible:outline-2 focus-visible:outline-paper-blue">
                    Open {TAB_LABEL[item.tab]} →
                  </button>
                )}
              </p>
            </div>
            {item.dismissible ? <DismissAlertButton id={item.id} text={item.text} /> : null}
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}
