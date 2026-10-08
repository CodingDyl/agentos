import { ArrowUpRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import { elapsed } from "@/features/mission-control/mission-control-model";
import { cn } from "@/lib/utils";

/**
 * "Something is working", from every screen.
 *
 * The header is the one place every page shares, so this is where a running
 * job, Hermes run or Operator run shows itself, whatever page the operator is
 * on. Absent when nothing is running: an "idle" pill on every screen would be
 * noise people learn to skip, and then miss on the day it changes.
 *
 * The pulse is reserved for work that is confidently live. Work recorded as
 * running that nothing is executing (usually after a restart) is counted, but
 * drawn still and worded as "may have finished".
 */
export function ActiveWorkIndicator({ items }: { items: readonly ActiveWorkItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const confident = items.filter((item) => !item.uncertain).length;

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Everything finished while the list was open: nothing left to show it for.
  if (items.length === 0) return null;

  const summary = confident > 0 ? `${confident} working` : `${items.length} may be running`;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={`${summary}. Show what is running`}
        className={cn(
          "os-focus-ring inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-none border px-2.5 font-paper-utility text-[12px] font-medium tracking-[0.08em] uppercase transition-colors duration-150",
          confident > 0
            ? "border-os-success/50 bg-os-success/10 text-foreground hover:bg-os-success/20"
            : "border-os-border text-os-muted hover:bg-os-surface-raised",
        )}
      >
        <span className="relative flex size-2" aria-hidden="true">
          {confident > 0 ? (
            <span className="absolute inline-flex size-full rounded-full bg-os-success opacity-60 motion-safe:animate-ping" />
          ) : null}
          <span className={cn("relative inline-flex size-2 rounded-full", confident > 0 ? "bg-os-success" : "bg-os-subtle")} />
        </span>
        <span className="tabular-nums">
          {confident > 0 ? confident : items.length}
          <span className="hidden sm:inline">{confident > 0 ? " working" : " may be running"}</span>
        </span>
      </button>

      {isOpen ? (
        <div
          id={panelId}
          className="absolute top-full right-0 z-40 mt-2 w-[min(92vw,380px)] border border-os-border bg-os-surface shadow-none"
        >
          <p className="os-meta border-b border-os-border px-4 py-2.5 text-os-subtle">Running now</p>
          <ul className="max-h-[60vh] divide-y divide-os-border overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <ActiveWorkLink item={item} onNavigate={() => setIsOpen(false)} />
              </li>
            ))}
          </ul>
          <Link
            to="/#active-work"
            onClick={() => setIsOpen(false)}
            className="os-focus-ring os-meta flex min-h-10 items-center justify-between border-t border-os-border px-4 text-os-muted transition-colors hover:bg-os-surface-raised hover:text-foreground"
          >
            Open Mission Control
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Re-renders once a second, so the elapsed time beside "running" is true. */
function useTicker(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

function ActiveWorkLink({ item, onNavigate }: { item: ActiveWorkItem; onNavigate: () => void }) {
  const now = useTicker(!item.uncertain);

  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      className="os-focus-ring group flex min-w-0 items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-os-surface-raised"
    >
      <span
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.uncertain ? "bg-os-subtle" : "bg-os-success motion-safe:animate-pulse")}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-paper-utility text-[11.5px] font-medium tracking-[0.08em] text-os-muted uppercase">
          {item.actor}
          {item.project ? <span className="text-os-subtle normal-case tracking-normal"> · {item.project}</span> : null}
        </span>
        <span className="mt-0.5 block text-[13.5px] leading-5 text-foreground group-hover:underline">{item.title}</span>
        <span className="mt-0.5 block text-[12px] text-os-subtle tabular-nums">
          {item.uncertain
            ? `Started ${elapsed(item.startedAt, now)} ago · may have finished`
            : `${item.detail ? `${item.detail} · ` : ""}Running ${elapsed(item.startedAt, now)}`}
        </span>
      </span>
      <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-os-subtle group-hover:text-foreground" aria-hidden="true" />
    </Link>
  );
}
