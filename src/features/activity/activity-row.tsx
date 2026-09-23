import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ActivityEvent } from "@shared/agentos-types";
import { cn } from "@/lib/utils";
import {
  detailsFor,
  formatTime,
  linksFor,
  sourceLabel,
  toneFor,
  type ActivityTone,
} from "./activity-model";

const TONE_DOT: Record<ActivityTone, string> = {
  quiet: "bg-os-subtle",
  active: "bg-os-amber motion-safe:animate-pulse",
  success: "bg-os-success",
  warning: "bg-os-warning",
  danger: "bg-os-danger",
};

export interface ActivityRowProps {
  event: ActivityEvent;
  now?: Date;
}

/**
 * One thing that happened.
 *
 * Closed, it answers when, who, and what. Opened, it says where to go next —
 * the timeline is a way back into AgentOS, not an archive to read. There is no
 * raw payload here at any depth: every field shown is one the model named.
 */
export function ActivityRow({ event, now }: ActivityRowProps) {
  const [isOpen, setIsOpen] = useState(false);

  const tone = toneFor(event);
  const links = linksFor(event);
  const details = detailsFor(event, now);

  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "group flex w-full cursor-pointer gap-4 px-5 py-4 text-left transition-colors duration-150 outline-none md:gap-6 md:px-6",
          "hover:bg-os-surface-raised focus-visible:inset-ring-2 focus-visible:inset-ring-ring/70",
        )}
      >
        <span className="os-meta w-11 shrink-0 pt-0.5 text-os-subtle tabular-nums">
          {formatTime(event.timestamp)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
              aria-hidden="true"
            />
            <span className="os-meta text-os-subtle">
              {sourceLabel(event.source)}
            </span>
          </span>

          <span
            className={cn(
              "mt-2 block text-[15px] leading-6",
              tone === "danger" ? "text-os-danger" : "text-foreground",
            )}
          >
            {event.title}
          </span>

          {event.description ? (
            <span className="mt-1 block max-w-[72ch] truncate text-[13px] leading-5 text-os-muted">
              {event.description}
            </span>
          ) : null}

          {event.project ? (
            <span className="os-meta mt-2 block text-os-subtle">
              {event.project}
            </span>
          ) : null}
        </span>

        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-os-subtle transition-transform duration-150 group-hover:text-foreground",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div className="border-t border-os-border bg-os-surface-raised/40 px-5 py-5 md:px-6">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:max-w-2xl">
            {details.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <dt className="os-meta text-os-subtle">{detail.label}</dt>
                <dd className="mt-1.5 truncate font-mono text-[13px] leading-5 text-os-muted">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>

          {links.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {links.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center rounded-md border border-os-border px-3 text-os-muted transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
