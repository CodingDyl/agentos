import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The paper world's primitives, as Operations uses them.
 *
 * A sandy desk, a white application window on it, hairline warm borders, 4px
 * corners, and no shadows — the same world Mail trialled, drawn here from the
 * shared `paper-*` tokens so the next screen to move over can reuse them.
 *
 * The one piece of authored motion is the meters filling in: every meter,
 * ring and line on the page draws from empty once, on arrival, with the same
 * ease-out. It is transform-only, and it does nothing under reduced motion.
 */

export const PAPER_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue";

const EASE = "duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

/** True one frame after mount, so meters can draw from empty rather than appear full. */
function useArrived(): boolean {
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return arrived;
}

export function PaperStage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-paper-desk px-4 py-6 font-paper-ui text-paper-moss sm:px-8 sm:py-8">
      {children}
    </div>
  );
}

/** A document opened on the desk: title bar with the three dots and a filename. */
export function PaperWindow({
  filename,
  meta,
  children,
}: {
  filename: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1180px] rounded-[6px] border border-paper-mist bg-paper-white">
      <div className="relative flex h-9 items-center justify-center rounded-t-[6px] border-b border-paper-mist bg-paper-white/80 px-4 backdrop-blur-sm">
        <div className="absolute left-3.5 flex gap-1.5" aria-hidden="true">
          <span className="size-[9px] rounded-full bg-paper-mist" />
          <span className="size-[9px] rounded-full bg-paper-mist" />
          <span className="size-[9px] rounded-full bg-paper-mist" />
        </div>
        <span className="font-mono text-[12.5px] text-paper-sage">{filename}</span>
        {meta ? <span className="absolute right-4 hidden text-[12px] text-paper-sage sm:block">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function PaperSection({
  label,
  count,
  action,
  children,
  className,
}: {
  label: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">
          {label}
          {count !== undefined ? (
            <span className="rounded-full bg-paper-stone px-2 py-px font-paper-ui text-[11.5px] font-medium tracking-normal text-paper-char tabular-nums">
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
export function PaperCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-[4px] border border-paper-mist bg-paper-white p-4", className)}>{children}</div>;
}

type ButtonVariant = "amber" | "ghost" | "quiet";

const BUTTON: Record<ButtonVariant, string> = {
  amber: "bg-paper-amber text-paper-moss hover:bg-paper-amber-deep hover:text-paper-white",
  // The gold border is the "available action" signal; the label stays dark,
  // because gold text on white is 3.6:1 and fails AA at this size.
  ghost: "border-[1.5px] border-paper-gold text-paper-moss hover:bg-paper-linen",
  quiet: "text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
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
        "inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] px-3 text-[13.5px] font-semibold transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
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
  flame: "bg-paper-flame-deep font-semibold text-paper-white",
  // Dark on green: white on moss green is 2.9:1.
  green: "bg-paper-green text-paper-moss",
  marigold: "bg-paper-marigold text-paper-moss",
  muted: "bg-paper-stone text-paper-char",
  blue: "bg-paper-blue text-paper-white",
};

/** The world's only pill: a small categorical tag. */
export function Tag({ tone = "muted", children, className }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-px text-[11.5px] leading-[18px] font-medium", TAG[tone], className)}>
      {children}
    </span>
  );
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[4px] border border-paper-mist bg-paper-linen p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-7 cursor-pointer rounded-[3px] px-3 text-[13px] font-medium transition-colors duration-150",
              PAPER_FOCUS,
              selected ? "bg-paper-white text-paper-moss ring-1 ring-paper-mist" : "text-paper-sage hover:text-paper-moss",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Content tabs: sage when idle, signal blue with a 2px underline when active. */
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
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--paper-mist)]">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`tab-${option.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${option.value}`}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 cursor-pointer rounded-t-[6px] border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors duration-150",
              PAPER_FOCUS,
              selected
                ? "border-paper-blue bg-paper-white text-paper-blue"
                : "border-transparent text-paper-sage hover:bg-paper-linen hover:text-paper-moss",
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
      className={cn("w-full overflow-hidden rounded-[2px] bg-paper-stone", size === "md" ? "h-2" : "h-1.5")}
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
      <div role="img" aria-label={`${label}: ${summary}`} className="flex h-2.5 w-full gap-px overflow-hidden rounded-[2px] bg-paper-stone">
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
          <li key={segment.key} className="flex items-center gap-1.5 text-[12.5px] text-paper-char">
            <span className={cn("size-2 rounded-[1px]", STACK_INKS[index % STACK_INKS.length])} aria-hidden="true" />
            <span className="max-w-[16ch] truncate">{segment.label}</span>
            <span className="text-paper-sage tabular-nums">{format(segment.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A value within a range, as a ring: a track of printed beads, and a solid
 * arc over it for the part that is filled.
 */
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
  // A whole number of beads, so the track closes without a seam.
  const beads = Math.round(circumference / (stroke * 1.9));
  const beadGap = circumference / beads;
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
          strokeLinecap="round"
          strokeDasharray={`0.1 ${(beadGap - 0.1).toFixed(3)}`}
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
            "font-paper-display leading-none font-extrabold tracking-[-0.03em] text-paper-moss tabular-nums",
            size >= 100 ? "text-[32px]" : "text-[15px]",
          )}
        >
          {value === undefined ? "—" : `${Math.round(clamped * 100)}%`}
        </span>
        {word && size >= 100 ? (
          <span id={id} className="mt-1 text-[12.5px] text-paper-sage">
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
  const area = `${line} L100,32 L0,32 Z`;

  // Revealed left to right with a clip-path wipe rather than a stroke-dash
  // draw: dash lengths and `non-scaling-stroke` disagree in Chromium and leave
  // gaps mid-line.
  return (
    <div
      className="transition-[clip-path] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      style={{ clipPath: arrived ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}
    >
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="block h-14 w-full" role="img" aria-label={label}>
        <path d={area} fill="var(--paper-amber)" opacity={0.16} />
        <path d={line} fill="none" stroke="var(--paper-amber-deep)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="0" y1="31.5" x2="100" y2="31.5" stroke="var(--paper-mist)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** The paper version of the on/off switch: moss green when on. */
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
  "min-h-8 rounded-[4px] border border-paper-mist bg-paper-white px-3 text-[14px] text-paper-moss placeholder:text-paper-ash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue";

/** Small uppercase-free field label, above its input. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[12.5px] font-medium text-paper-char">{children}</span>;
}
