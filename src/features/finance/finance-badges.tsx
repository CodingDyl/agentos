import { AlertTriangle, Check, Clock, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Meter } from "@/components/paper";
import { cn } from "@/lib/utils";
import { utilisationTone, type PayState } from "./finance-model";

/**
 * Whether something has been paid, at a glance.
 *
 * State is never colour alone: each has its own icon and its own words
 * ("Paid", "Due", "Not seen"), so it reads the same in greyscale and for
 * someone who cannot tell green from orange. Paid is green with dark text
 * (white on this green fails contrast), not seen is the one loud state.
 */
const STATE: Record<PayState, { icon: typeof Check; classes: string }> = {
  paid: { icon: Check, classes: "bg-paper-green text-paper-white" },
  due: { icon: Clock, classes: "bg-paper-stone text-paper-char" },
  late: { icon: AlertTriangle, classes: "bg-paper-flame-deep font-semibold text-paper-white" },
  unknown: { icon: Minus, classes: "border border-dashed border-paper-mist bg-paper-white text-paper-sage" },
};

export function PayBadge({ state, children, className }: { state: PayState; children: ReactNode; className?: string }) {
  const { icon: Icon, classes } = STATE[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-px text-[12px] leading-[18px] font-medium", classes, className)}>
      <Icon className="size-3" aria-hidden="true" strokeWidth={2.5} />
      {children}
    </span>
  );
}

const TONE_LABEL = { good: "Comfortable", watch: "Getting high", act: "High" } as const;

/** How much of a limit is in use: a bar, the figure, and a word for how worried to be. */
export function UtilisationBar({ value, label }: { value: number; label: string }) {
  const tone = utilisationTone(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-paper-char">{label}</span>
        <span className={cn("tabular-nums", tone === "act" ? "font-semibold text-paper-flame-deep" : "text-paper-moss")}>
          {Math.round(value * 100)}% · {TONE_LABEL[tone]}
        </span>
      </div>
      <div className="mt-1.5">
        <Meter value={Math.min(1, value)} label={`${label}: ${Math.round(value * 100)}%`} tone={tone === "good" ? "green" : tone === "watch" ? "amber" : "flame"} />
      </div>
    </div>
  );
}

/**
 * A progress bar made of spans, for places a block element cannot go, such as
 * inside a card's header button. Same look as `Meter`, and announced as an image
 * with the figure in its label.
 */
export function MiniBar({ value, label, tone = "green" }: { value: number; label: string; tone?: "green" | "amber" | "flame" }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span role="img" aria-label={label} className="block h-1.5 w-full max-w-[16rem] overflow-hidden rounded-[2px] bg-paper-stone">
      <span className={cn("block h-full rounded-[2px]", tone === "green" ? "bg-paper-green" : tone === "amber" ? "bg-paper-amber" : "bg-paper-flame")} style={{ width: `${clamped * 100}%` }} />
    </span>
  );
}
