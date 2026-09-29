import type { ReactNode } from "react";
import { PaperButton, Tag } from "@/components/paper";
import { useSaveCorrection, useSuggestCategory } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { CATEGORY_CHOICES } from "./finance-model";

/** Small pieces shared by Finance's tabs. */

/** A labelled figure. `tone="warn"` is the only colour a figure ever takes. */
export function Figure({ label, value, note, tone, large }: { label: string; value: ReactNode; note?: ReactNode; tone?: "warn"; large?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] font-medium text-paper-sage">{label}</p>
      <p
        className={cn(
          "mt-1 font-paper-display leading-none font-extrabold tracking-[-0.02em] tabular-nums",
          large ? "text-[44px] sm:text-[52px]" : "text-[24px]",
          tone === "warn" ? "text-paper-flame-deep" : "text-paper-moss",
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-1.5 text-[12.5px] leading-5 text-paper-sage">{note}</p> : null}
    </div>
  );
}

/** A label and a value on one line, for the little ledgers inside cards. */
export function Line({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[14px]">
      <dt className="text-paper-char">{label}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "font-semibold text-paper-moss" : "text-paper-moss")}>{value}</dd>
    </div>
  );
}

export function MutationError({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-[13px] leading-5 text-paper-flame-deep">
      {error.message}
    </p>
  );
}

/** A dot for a signal. Colour is redundant: the words beside it say the same. */
export function SignalDot({ tone }: { tone: "good" | "warn" | "neutral" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("mt-[0.55em] size-2 shrink-0 rounded-full", tone === "good" ? "bg-paper-green" : tone === "warn" ? "bg-paper-flame" : "border border-paper-ash bg-paper-white")}
    />
  );
}

export function SampleNotice({ onSettings }: { onSettings: () => void }) {
  return (
    <div role="note" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-paper-mist bg-paper-cream px-4 py-3">
      <p className="max-w-[70ch] text-[14px] leading-6 text-paper-char">
        <Tag tone="marigold" className="mr-2">
          Sample data
        </Tag>
        This is an illustrative ledger so you can see the page. It is not saved and it is not your money. Connect Investec and it is replaced by your own accounts.
      </p>
      <PaperButton variant="ghost" onClick={onSettings}>
        Connect Investec
      </PaperButton>
    </div>
  );
}

/**
 * Asks Jev for a category on one payment, and offers it. It never applies it:
 * "Use Groceries" is a correction, made by a click, and it is your correction
 * (not Jev's guess) that Finance remembers.
 */
export function CategorySuggest({ transactionId, merchant, disabled }: { transactionId: string; merchant: string; disabled?: boolean }) {
  const suggest = useSuggestCategory();
  const save = useSaveCorrection();
  const result = suggest.data?.suggestion;

  return (
    <div className="mt-2">
      {result ? (
        <div className="rounded-[4px] bg-paper-cream p-3 text-[13px] leading-5 text-paper-char">
          <p>
            Jev leans <span className="font-semibold text-paper-moss">{result.category}</span> ({Math.round(result.confidence * 100)}% confident).
          </p>
          {result.alternatives.length > 1 ? (
            <p className="text-paper-sage">Also considered: {result.alternatives.slice(1).map((entry) => `${entry.category} ${Math.round(entry.confidence * 100)}%`).join(", ")}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <PaperButton
              variant="ghost"
              disabled={save.isPending || !CATEGORY_CHOICES.some((entry) => entry === result.category)}
              onClick={() => save.mutate({ merchant, category: result.category as (typeof CATEGORY_CHOICES)[number] })}
            >
              Use {result.category}
            </PaperButton>
          </div>
          <MutationError error={save.error} />
        </div>
      ) : (
        <PaperButton variant="ghost" disabled={disabled || suggest.isPending} onClick={() => suggest.mutate(transactionId)}>
          {suggest.isPending ? "Asking Jev…" : "Classify"}
        </PaperButton>
      )}
      <MutationError error={suggest.error} />
    </div>
  );
}
