import { Check, ExternalLink, Play, Video } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { BriefPlan, CalendarEvent } from "@shared/today-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { mailConnectUrl } from "@/lib/agentos/client";
import {
  useCaptureNote,
  useControlAutomation,
  useDayWrap,
  useMorningBrief,
  useTodayCalendar,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { eventTimings, formatBriefTime, formatEventTime } from "./mission-control-model";
import { TodayLabel, TodayLink } from "./today-kit";

/* ── Morning plan ─────────────────────────────────────────────────────── */

/** Hermes' text with its `backticked` ids set as small code, rather than raw backticks. */
function BriefText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded-[3px] bg-paper-stone px-1 py-px font-mono text-[0.85em] text-paper-moss">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The plan itself: outcome first, then the three, then the extras. */
function PlanBody({ plan }: { plan: BriefPlan }) {
  return (
    <>
      {plan.mainOutcome ? (
        <p className="font-paper-display text-[19px] leading-[1.35] font-bold tracking-[-0.01em] text-balance text-paper-moss">
          <BriefText text={plan.mainOutcome} />
        </p>
      ) : null}
      {plan.top.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {plan.top.map((task, index) => (
            <li key={task} className="flex gap-3 text-[14.5px] leading-6 text-paper-moss">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-paper-stone text-[11.5px] font-semibold text-paper-char tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0">
                <BriefText text={task} />
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {plan.ifTime.length > 0 || plan.avoid ? (
        <dl className="mt-4 grid gap-x-8 gap-y-3 border-t border-paper-stone pt-3 sm:grid-cols-2">
          {plan.ifTime.length > 0 ? (
            <div className="min-w-0">
              <dt>
                <TodayLabel>If there's time</TodayLabel>
              </dt>
              <dd className="mt-0.5 text-[13.5px] leading-5 text-paper-char"><BriefText text={plan.ifTime.join(" · ")} /></dd>
            </div>
          ) : null}
          {plan.avoid ? (
            <div className="min-w-0">
              <dt>
                <TodayLabel>Avoid</TodayLabel>
              </dt>
              <dd className="mt-0.5 text-[13.5px] leading-5 text-paper-char">
                <BriefText text={plan.avoid} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </>
  );
}

/**
 * Hermes' morning brief, as the plan for the day. When this morning's brief
 * isn't a plan (Hermes couldn't reach the calendar, say), that is said plainly,
 * with Hermes' own words and the most recent plan it did write.
 */
export function MorningPlan({ className }: { className?: string }) {
  const [queued, setQueued] = useState(false);
  const brief = useMorningBrief(queued);
  const run = useControlAutomation();
  const data = brief.data;

  const runNow =
    data?.jobId !== undefined ? (
      <PaperButton
        variant="quiet"
        disabled={run.isPending || queued}
        onClick={() =>
          run.mutate({ id: data.jobId as string, control: "run" }, { onSuccess: () => setQueued(true) })
        }
      >
        <Play className="size-3.5" aria-hidden="true" />
        {queued ? "Hermes is on it" : run.isPending ? "Queuing…" : data.status === "today" ? "Run again" : "Run now"}
      </PaperButton>
    ) : null;

  if (brief.isPending) {
    return (
      <PaperSection label="This morning's plan" className={className}>
        <p className="text-[14px] text-paper-sage">Reading Hermes' brief…</p>
      </PaperSection>
    );
  }

  if (!data || data.status === "no-job") {
    return (
      <PaperSection label="This morning's plan" className={className}>
        <p className="max-w-[62ch] text-[14px] leading-6 text-paper-char">
          {brief.isError
            ? "Hermes' brief couldn't be read."
            : "Hermes has no morning-brief job. A scheduled job running the start-day skill will appear here each morning."}{" "}
          <Link to="/automations" className={cn("rounded-[2px] font-semibold text-paper-moss underline decoration-paper-gold underline-offset-4", PAPER_FOCUS)}>
            Automations
          </Link>
        </p>
      </PaperSection>
    );
  }

  const when = data.runAt ? formatBriefTime(data.runAt) : undefined;

  return (
    <PaperSection
      label="This morning's plan"
      className={className}
      action={
        <span className="flex items-center gap-2">
          {when ? <span className="text-[12.5px] text-paper-sage">Hermes · {when}</span> : null}
          {runNow}
        </span>
      }
    >
      <div className="rounded-[4px] border border-paper-mist bg-paper-cream px-5 py-4">
        {queued ? (
          <p className="mb-3 text-[13px] text-paper-sage" role="status">
            Queued. The new plan appears here when Hermes finishes, usually within a couple of minutes.
          </p>
        ) : null}

        {data.status === "none" ? (
          <p className="text-[14px] text-paper-char">The brief hasn't run yet. Run it now to get today's plan.</p>
        ) : data.plan ? (
          <>
            {data.status === "stale" ? (
              <p className="mb-3 text-[13px] text-paper-flame-deep">No brief yet today. This is the latest one, from {when}.</p>
            ) : null}
            <PlanBody plan={data.plan} />
          </>
        ) : (
          <>
            <p className="text-[14px] font-semibold text-paper-flame-deep">
              {data.status === "today" ? "Hermes didn't produce a plan this morning." : `The latest brief (${when}) isn't a plan.`}
            </p>
            {data.response ? (
              <p className="mt-1 line-clamp-3 max-w-[80ch] text-[13.5px] leading-5 text-paper-char">
                <BriefText text={data.response} />
              </p>
            ) : null}
            {data.lastPlan ? (
              <div className="mt-4 border-t border-paper-stone pt-4">
                <TodayLabel className="mb-2">Latest plan Hermes wrote · {formatBriefTime(data.lastPlan.runAt)}</TodayLabel>
                <PlanBody plan={data.lastPlan.plan} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </PaperSection>
  );
}

/* ── Calendar ─────────────────────────────────────────────────────────── */

const CALENDAR_HELP: Record<string, string> = {
  "not-configured": "Google isn't set up in AgentOS yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.",
  "not-connected": "Connect Google to see today's events here.",
};

function EventRow({ event, timing }: { event: CalendarEvent; timing: string | undefined }) {
  const past = timing === "past";
  return (
    <li className={cn("flex min-w-0 gap-3 px-4 py-2.5", timing === "now" && "bg-paper-cream", past && "opacity-60")}>
      <span className="w-[5.5rem] shrink-0 pt-px text-[12.5px] text-paper-sage tabular-nums">{formatEventTime(event)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-[14px] leading-5 font-medium text-paper-moss">{event.title}</span>
          {timing === "now" ? <Tag tone="green">Now</Tag> : timing === "next" ? <Tag>Next</Tag> : null}
        </span>
        {event.location ? <span className="mt-0.5 block truncate text-[12.5px] text-paper-sage">{event.location}</span> : null}
      </span>
      {event.meetingUrl && !past ? (
        <a
          href={event.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] px-2 text-[12.5px] font-semibold text-paper-blue hover:bg-paper-stone",
            PAPER_FOCUS,
          )}
        >
          <Video className="size-3.5" aria-hidden="true" />
          Join
        </a>
      ) : event.htmlLink ? (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${event.title} in Google Calendar`}
          className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-paper-sage hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}

/** Today's meetings and blocks, with what's on now and what's next. */
export function TodayCalendar({ className }: { className?: string }) {
  const { data, isPending } = useTodayCalendar();
  const events = data?.today ?? [];
  const timings = eventTimings(events);

  return (
    <PaperSection label="Calendar" count={events.length > 0 ? events.length : undefined} className={className}>
      {isPending ? (
        <p className="text-[14px] text-paper-sage">Reading your calendar…</p>
      ) : !data || data.status !== "ready" ? (
        <div className="rounded-[4px] border border-paper-mist px-4 py-3.5">
          <p className="text-[14px] leading-6 text-paper-char">
            {data?.detail ?? CALENDAR_HELP[data?.status ?? ""] ?? "The calendar couldn't be read."}
          </p>
          {data?.status === "needs-connect" || data?.status === "not-connected" ? (
            <a
              href={mailConnectUrl()}
              className={cn(
                "mt-3 inline-flex min-h-8 items-center rounded-[4px] border-[1.5px] border-paper-gold px-3 text-[13.5px] font-semibold text-paper-moss hover:bg-paper-linen",
                PAPER_FOCUS,
              )}
            >
              {data.status === "needs-connect" ? "Reconnect Google" : "Connect Google"}
            </a>
          ) : null}
        </div>
      ) : events.length === 0 ? (
        <p className="text-[14px] text-paper-char">Nothing on the calendar today. A clear run at the work.</p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
          {events.map((event) => (
            <EventRow key={event.id} event={event} timing={timings.get(event.id)} />
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

/* ── End-of-day wrap ──────────────────────────────────────────────────── */

const DONE_KIND = { task: "Task", worker: "Agent work", milestone: "Milestone" } as const;

/**
 * Closing the day: what got done, what carries over, how tomorrow starts,
 * and one box for the loose ends in your head, so they're filed rather than
 * carried home.
 */
export function DayWrapUp({ className }: { className?: string }) {
  const wrap = useDayWrap(true);
  const calendar = useTodayCalendar();
  const capture = useCaptureNote();
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(0);
  const data = wrap.data;
  const tomorrow = calendar.data?.tomorrowFirst;

  const save = () => {
    const text = note.trim();
    if (!text) return;
    capture.mutate(
      { note: text },
      {
        onSuccess: () => {
          setNote("");
          setSaved((count) => count + 1);
        },
      },
    );
  };

  return (
    <PaperSection label="Wrap up the day" className={className}>
      <div className="rounded-[4px] border border-paper-mist">
        <div className="grid gap-px bg-paper-stone md:grid-cols-2">
          <div className="bg-paper-white px-5 py-4">
            <TodayLabel>Done today{data && data.done.length > 0 ? ` · ${data.done.length}` : ""}</TodayLabel>
            {wrap.isPending ? (
              <p className="mt-2 text-[14px] text-paper-sage">Reading today's activity…</p>
            ) : !data || data.done.length === 0 ? (
              <p className="mt-2 text-[14px] leading-6 text-paper-char">
                Nothing marked done in AgentOS today. Work done elsewhere won't show here; capture it below if it matters.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.done.map((item) => (
                  <li key={item.id} className="flex min-w-0 gap-2.5">
                    <Check className="mt-1 size-3.5 shrink-0 text-[#3f7a2a]" strokeWidth={2.5} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-6 text-paper-moss">{item.title}</span>
                      <span className="block text-[12px] text-paper-sage">
                        {DONE_KIND[item.kind]}
                        {item.project ? ` · ${item.project}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-paper-white px-5 py-4">
            <TodayLabel>
              Carrying over{data && data.carryOverTotal > 0 ? ` · ${data.carryOverTotal} open in Now` : ""}
            </TodayLabel>
            {!data ? null : data.carryOver.length === 0 ? (
              <p className="mt-2 text-[14px] leading-6 text-paper-char">Every Now task is done. Tomorrow starts clean.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {data.carryOver.map((task) => (
                  <li key={`${task.projectSlug}:${task.taskId ?? task.title}`} className="min-w-0">
                    <Link
                      to={`/workspaces/${task.projectSlug}?tab=tasks`}
                      className={cn("block rounded-[2px] text-[14px] leading-6 text-paper-moss hover:underline", PAPER_FOCUS)}
                    >
                      {task.taskId ? <span className="mr-1.5 text-[12px] text-paper-sage">{task.taskId}</span> : null}
                      {task.title}
                    </Link>
                  </li>
                ))}
                {data.carryOverTotal > data.carryOver.length ? (
                  <li>
                    <TodayLink to="/workspaces">+{data.carryOverTotal - data.carryOver.length} more</TodayLink>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-px border-t border-paper-stone bg-paper-stone md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="bg-paper-white px-5 py-4">
            <TodayLabel>Tomorrow starts with</TodayLabel>
            <p className="mt-2 text-[14px] leading-6 text-paper-moss">
              {tomorrow ? (
                <>
                  <span className="font-semibold tabular-nums">{formatEventTime(tomorrow)}</span> · {tomorrow.title}
                </>
              ) : calendar.data?.status === "ready" ? (
                "Nothing on the calendar tomorrow."
              ) : (
                <span className="text-paper-char">Connect your calendar to see tomorrow's first event.</span>
              )}
            </p>
          </div>

          <form
            className="bg-paper-white px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label htmlFor="loose-ends">
              <TodayLabel>Loose ends</TodayLabel>
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="loose-ends"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Anything still in your head, filed for tomorrow"
                className={cn(PAPER_INPUT, "min-w-0 flex-1")}
              />
              <PaperButton type="submit" variant="ghost" disabled={!note.trim() || capture.isPending}>
                {capture.isPending ? "Saving…" : "Capture"}
              </PaperButton>
            </div>
            <p className="mt-1.5 min-h-4 text-[12.5px] text-paper-sage" aria-live="polite">
              {capture.isError
                ? "That didn't save. Try again."
                : saved > 0
                  ? `${saved} captured to your inbox. Hermes files them with the next start-day.`
                  : ""}
            </p>
          </form>
        </div>
      </div>
    </PaperSection>
  );
}
