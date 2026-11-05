import { useEffect, useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared page primitives: panels, buttons, tags, inputs and meters, drawn
 * from the semantic tokens in `agentos.css`. DESIGN.md is the authority. The
 * `Paper` names are historical and describe no particular look.
 *
 * Motion is limited to short colour and opacity transitions, plus a meter
 * settling to its value; all of it stops under reduced motion.
 */

export const PAPER_FOCUS = "os-focus-ring";

const EASE = "duration-150 ease-out motion-reduce:transition-none";

/** True one frame after mount, so meters can draw from empty rather than appear full. */
function useArrived(): boolean {
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return arrived;
}

/**
 * The page frame: canvas behind, content on one left edge, held to the 1440px
 * measure with the gutter for the current width.
 */
export function PaperStage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-background text-paper-moss">
      <div className="qt-page">{children}</div>
    </div>
  );
}

export function PaperSection({
  id,
  label,
  count,
  action,
  children,
  className,
}: {
  /** An anchor, so another part of the page can link straight here. */
  id?: string;
  label: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-label={label} className={cn("qt-panel", id && "scroll-mt-6", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-[16px] leading-6 font-semibold text-paper-moss">
          {label}
          {count !== undefined ? (
            <span className="rounded-sm bg-paper-stone px-1.5 text-[13px] leading-5 font-medium text-paper-char tabular-nums">
              {count}
            </span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A top-level card on the window. Never nested inside another. */
export function PaperCard({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn("rounded-lg bg-paper-white p-6 max-sm:p-4", className)}>
      {children}
    </div>
  );
}

type ButtonVariant = "amber" | "ghost" | "quiet" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  // The filled primary. "amber" is the variant's historical name.
  amber: "bg-primary text-primary-foreground hover:bg-[var(--accent-hover)]",
  // The secondary action: a raised neutral surface.
  ghost: "border border-paper-mist bg-paper-linen text-paper-moss hover:bg-paper-stone",
  quiet: "text-paper-char hover:bg-paper-linen hover:text-paper-moss",
  // Refusing or stopping something: an explicit verb and the error treatment.
  danger: "border border-paper-flame/50 text-paper-flame hover:bg-paper-flame/10",
};

export function PaperButton({
  variant = "quiet",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-[var(--control-height)] cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-[14px] font-medium transition-[background-color,color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        PAPER_FOCUS,
        BUTTON[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

type TagTone = "flame" | "green" | "marigold" | "muted" | "blue";

const TAG: Record<TagTone, string> = {
  flame: "bg-paper-flame/10 text-paper-flame",
  green: "bg-paper-green/10 text-paper-green",
  marigold: "bg-paper-marigold/10 text-paper-marigold",
  muted: "bg-paper-stone text-paper-char",
  blue: "bg-paper-stone text-paper-moss",
};

/** A small status or category badge. Its word carries the meaning; tone only reinforces it. */
export function Tag({ tone = "muted", children, className }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-sm px-1.5 text-[13px] leading-5 font-medium", TAG[tone], className)}>
      {children}
    </span>
  );
}

/** Standard radio/tab arrow keys without changing selection callbacks. */
function moveChoice<T extends string>(event: KeyboardEvent<HTMLDivElement>, options: readonly { value: T }[], value: T, onChange: (value: T) => void) {
  const index = options.findIndex((option) => option.value === value);
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
    event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % options.length :
    event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + options.length) % options.length : -1;
  if (next < 0 || !options[next]) return;
  event.preventDefault();
  onChange(options[next].value);
  event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
}

/** A small set of choices, one selected. The paper version of a segmented control. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={(event) => moveChoice(event, options, value, onChange)} className="inline-flex rounded-md bg-paper-linen p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-[var(--control-height)] cursor-pointer rounded-md px-3 text-[14px] font-medium transition-colors duration-150",
              PAPER_FOCUS,
              selected ? "bg-selected text-paper-moss" : "text-paper-char hover:text-paper-moss",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Content tabs: secondary text when idle, primary text with a 2px underline when active. */
export function PaperTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} onKeyDown={(event) => moveChoice(event, options, value, onChange)} className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--paper-mist)]">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`tab-${option.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            aria-controls={`panel-${option.value}`}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-10 shrink-0 cursor-pointer rounded-t-md border-b-2 px-3 py-2 text-[14px] leading-5 font-medium transition-colors duration-150",
              PAPER_FOCUS,
              selected
                ? "border-paper-moss text-paper-moss"
                : "border-transparent text-paper-char hover:bg-paper-linen hover:text-paper-moss",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A share of a whole, as a bar.
 *
 * Draws nothing at all over an unknown share: a bar behind an em dash would
 * read as "all of it", which is the opposite of what an absence means.
 */
export function Meter({
  value,
  label,
  tone = "ink",
  size = "sm",
}: {
  /** 0–1. Undefined draws an empty track. */
  value: number | undefined;
  label: string;
  tone?: "ink" | "amber" | "green" | "flame";
  size?: "sm" | "md";
}) {
  const arrived = useArrived();
  const clamped = value === undefined ? 0 : Math.max(0, Math.min(value, 1));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(clamped * 100)}
      className={cn("w-full overflow-hidden rounded-sm bg-paper-stone", size === "md" ? "h-2" : "h-1.5")}
    >
      {value === undefined ? null : (
        <div
          className={cn(
            "h-full origin-left transition-transform",
            EASE,
            tone === "amber" ? "bg-paper-amber" : tone === "green" ? "bg-paper-green" : tone === "flame" ? "bg-paper-flame" : "bg-paper-char",
          )}
          style={{ transform: `scaleX(${arrived ? clamped : 0})` }}
        />
      )}
    </div>
  );
}

/**
 * Parts of a whole on one bar, with a legend that carries the numbers.
 *
 * A stacked bar rather than a pie: readable at any share, and the legend means
 * no segment's meaning depends on telling two inks apart.
 */
const STACK_INKS = ["bg-paper-moss", "bg-paper-char", "bg-paper-sage", "bg-paper-ash", "bg-paper-mist", "bg-paper-stone"];

export function StackedMeter({
  segments,
  format,
  label,
}: {
  segments: readonly { key: string; label: string; value: number }[];
  format: (value: number) => string;
  label: string;
}) {
  const arrived = useArrived();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;

  const summary = segments.map((segment) => `${segment.label} ${Math.round((segment.value / total) * 100)}%`).join(", ");

  return (
    <div>
      <div role="img" aria-label={`${label}: ${summary}`} className="flex h-2.5 w-full gap-px overflow-hidden rounded-sm bg-paper-stone">
        {segments.map((segment, index) => (
          <div
            key={segment.key}
            className={cn("h-full origin-left transition-transform", EASE, STACK_INKS[index % STACK_INKS.length])}
            style={{ width: `${(segment.value / total) * 100}%`, transform: `scaleX(${arrived ? 1 : 0})` }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((segment, index) => (
          <li key={segment.key} className="flex items-center gap-1.5 text-[13px] text-paper-char">
            <span className={cn("size-2 rounded-sm", STACK_INKS[index % STACK_INKS.length])} aria-hidden="true" />
            <span className="max-w-[16ch] truncate">{segment.label}</span>
            <span className="text-paper-sage tabular-nums">{format(segment.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A value within a range, as a ring: a quiet track and an arc for the filled part. */
export function RadialMeter({
  value,
  word,
  label,
  size = 132,
  tone = "ink",
}: {
  /** 0–1, or undefined when nobody can say. */
  value: number | undefined;
  word?: string;
  label: string;
  size?: number;
  tone?: "ink" | "green" | "amber" | "flame";
}) {
  const arrived = useArrived();
  const id = useId();
  const stroke = size >= 100 ? 9 : 6;
  const radius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === undefined ? 0 : Math.max(0, Math.min(value, 1));
  const color =
    tone === "green" ? "var(--paper-green)" : tone === "amber" ? "var(--paper-amber)" : tone === "flame" ? "var(--paper-flame)" : "var(--paper-moss)";

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(clamped * 100)}
      aria-describedby={word ? id : undefined}
      className="relative inline-grid place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--paper-mist)"
          strokeWidth={stroke}
        />
        {value === undefined ? null : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={arrived ? circumference * (1 - clamped) : circumference}
            className={cn("transition-[stroke-dashoffset]", EASE)}
          />
        )}
      </svg>

      <div className="absolute inset-0 grid place-content-center text-center">
        <span
          className={cn(
            "leading-none font-semibold text-paper-moss tabular-nums",
            size >= 100 ? "text-[24px]" : "text-[14px]",
          )}
        >
          {value === undefined ? "-" : `${Math.round(clamped * 100)}%`}
        </span>
        {word && size >= 100 ? (
          <span id={id} className="mt-1 text-[13px] text-paper-sage">
            {word}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The shape of a range, bucket by bucket. The caller decides what a bucket
 * with nothing in it means — for spend, "nothing priced" plots as zero, which
 * is what was spent on priced runs that day.
 */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const arrived = useArrived();
  if (values.length < 2 || values.every((value) => value === 0)) {
    return <div className="h-14 border-b border-dashed border-paper-mist" aria-hidden="true" />;
  }

  const max = Math.max(...values, Number.EPSILON);
  const step = 100 / (values.length - 1);
  const line = values
    .map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(2)},${(30 - (value / max) * 26).toFixed(2)}`)
    .join(" ");

  return (
    <div
      className="transition-opacity duration-150 motion-reduce:transition-none"
      style={{ opacity: arrived ? 1 : 0 }}
    >
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="block h-14 w-full" role="img" aria-label={label}>
                <path d={line} fill="none" stroke="var(--paper-amber-deep)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="0" y1="31.5" x2="100" y2="31.5" stroke="var(--paper-mist)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** The on/off switch. Mint when on, and its label says what it controls. */
export function PaperSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 disabled:cursor-wait disabled:opacity-60",
        PAPER_FOCUS,
        checked ? "border-paper-green bg-paper-green" : "border-paper-mist bg-paper-stone",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-[18px] rounded-full border border-paper-mist bg-paper-white transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-[21px] border-paper-white" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

export const PAPER_INPUT =
  "min-h-[var(--control-height)] rounded-md border border-paper-ash bg-paper-linen px-3 text-[14px] leading-5 text-paper-moss placeholder:text-paper-sage";

/** A persistent field label, above its input. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[13px] leading-5 font-medium text-paper-char">{children}</span>;
}
