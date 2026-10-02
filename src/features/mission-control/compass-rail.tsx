import { Link } from "react-router-dom";
import type { AreaStatus } from "@shared/compass-types";
import { PAPER_FOCUS, PaperSection, Tag } from "@/components/paper";
import { useCompass } from "@/lib/agentos/compass";
import { cn } from "@/lib/utils";

/**
 * The Compass beside the day: where you are heading, this week, how each
 * area is going, and where the measurable goals stand. The "why" behind
 * your three, always in view.
 */

const TONE: Record<AreaStatus, "green" | "marigold" | "flame" | "muted"> = {
  "on track": "green",
  slipping: "marigold",
  neglected: "flame",
  unrated: "muted",
};

export function CompassRail({ className }: { className?: string }) {
  const compass = useCompass();
  const data = compass.data;

  if (!data?.exists) {
    return (
      <PaperSection label="Compass" className={className}>
        <p className="text-[14px] leading-6 text-paper-char">
          {compass.isPending ? "Reading your Compass…" : "No Compass yet. Ten minutes with Hermes sets out your direction, goals and life areas, and your three get picked against it."}
        </p>
        {!compass.isPending ? (
          <Link to="/compass" className={cn("mt-2 inline-block text-[13.5px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
            Set up your Compass
          </Link>
        ) : null}
      </PaperSection>
    );
  }

  const { direction, thisWeek, areas, goals } = data.compass;
  const measured = goals.filter((goal) => goal.target || goal.now);

  return (
    <PaperSection
      label="Compass"
      className={className}
      action={
        <Link to="/compass" className={cn("text-[12.5px] font-medium text-paper-sage hover:text-paper-moss hover:underline", PAPER_FOCUS)}>
          Edit
        </Link>
      }
    >
      {direction ? <p className="text-[14px] leading-6 text-paper-moss italic">{direction}</p> : null}

      {thisWeek.length > 0 ? (
        <div className="mt-4">
          <p className="text-[12px] font-semibold tracking-[0.06em] text-paper-sage uppercase">This week</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13.5px] leading-5 text-paper-char">
            {thisWeek.map((outcome) => (
              <li key={outcome}>{outcome}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {areas.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5" aria-label="Areas of life">
          {areas.map((area) => (
            <li key={area.name} className="flex items-center justify-between gap-2 text-[13px] text-paper-char">
              <span className="truncate">{area.name}</span>
              <Tag tone={TONE[area.status]}>{area.status === "unrated" ? "?" : area.status}</Tag>
            </li>
          ))}
        </ul>
      ) : null}

      {measured.length > 0 ? (
        <ul className="mt-4 space-y-1.5" aria-label="Goals with a target">
          {measured.slice(0, 5).map((goal) => (
            <li key={goal.id} className="text-[13px] leading-5">
              <span className="font-semibold text-paper-moss">{goal.title}</span>
              <span className="block text-paper-sage tabular-nums">
                {goal.now || "?"} → {goal.target || "?"}
                {goal.by ? ` by ${goal.by}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </PaperSection>
  );
}
