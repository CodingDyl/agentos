import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ActivityEvent } from "@shared/agentos-types";
import { PAPER_FOCUS } from "@/components/paper";
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
  quiet: "bg-paper-ash",
  active: "bg-paper-amber motion-safe:animate-pulse",
  success: "bg-paper-green",
  warning: "bg-paper-marigold",
  danger: "bg-paper-flame-deep",
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
          "group flex w-full cursor-pointer gap-4 px-5 py-4 text-left transition-colors duration-150 md:gap-6 md:px-6",
          "hover:bg-paper-cream focus-visible:-outline-offset-2",
          PAPER_FOCUS,
        )}
      >
        <span className="w-11 shrink-0 pt-0.5 text-[12.5px] text-paper-sage tabular-nums">
          {formatTime(event.timestamp)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
              aria-hidden="true"
            />
            <span className="text-[12.5px] font-medium text-paper-sage">
              {sourceLabel(event.source)}
            </span>
          </span>

          <span
            className={cn(
              "mt-1.5 block text-[15px] leading-6",
              tone === "danger" ? "text-paper-flame-deep" : "text-paper-moss",
            )}
          >
            {event.title}
          </span>

          {event.description ? (
            <span className="mt-1 block max-w-[72ch] truncate text-[13.5px] leading-5 text-paper-char">
              {event.description}
            </span>
          ) : null}

          {event.project ? (
            <span className="mt-1.5 block font-mono text-[12px] text-paper-sage">
              {event.project}
            </span>
          ) : null}
        </span>

        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-paper-sage transition-transform duration-150 group-hover:text-paper-moss",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div className="border-t border-paper-mist bg-paper-cream px-5 py-5 md:px-6">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:max-w-2xl">
            {details.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <dt className="text-[12px] text-paper-sage">{detail.label}</dt>
                <dd className="mt-1 truncate font-mono text-[12.5px] leading-5 text-paper-char">
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
                  className={cn("inline-flex min-h-8 cursor-pointer items-center rounded-none border-[1.5px] border-paper-gold px-3 text-[13px] font-semibold text-paper-moss transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
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
