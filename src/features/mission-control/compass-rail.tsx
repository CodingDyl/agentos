import { Link } from "react-router-dom";
import type { AreaStatus } from "@shared/compass-types";
import { PageLoader } from "@/components/os";
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
        {compass.isPending ? (
          <PageLoader variant="compact" />
        ) : (
          <>
            <p className="max-w-[62ch] text-[14px] leading-[22px] text-paper-char">
              No Compass yet. Ten minutes with Hermes sets out your direction, goals and life areas, and your three get picked against it.
            </p>
            <Link to="/compass" className={cn("mt-2 inline-block rounded-sm text-[14px] leading-5 font-medium text-paper-moss hover:underline", PAPER_FOCUS)}>
              Set up your Compass
            </Link>
          </>
        )}
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
        <Link to="/compass" className={cn("inline-flex min-h-8 items-center rounded-md px-1.5 text-[14px] leading-5 text-paper-char transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}>
          Edit
        </Link>
      }
    >
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-3">
        <div className="min-w-0">
          {direction ? <p className="text-[14px] leading-[22px] text-paper-moss">{direction}</p> : null}
          {measured.length > 0 ? (
            <ul className="mt-3 space-y-1.5" aria-label="Goals with a target">
              {measured.slice(0, 5).map((goal) => (
                <li key={goal.id} className="text-[13px] leading-5">
                  <span className="font-medium text-paper-moss">{goal.title}</span>
                  <span className="block text-paper-sage tabular-nums">
                    {goal.now || "?"} → {goal.target || "?"}
                    {goal.by ? ` by ${goal.by}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {thisWeek.length > 0 ? (
          <div className="min-w-0">
            <h3 className="text-[13px] leading-5 text-paper-sage">This week</h3>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[14px] leading-[22px] text-paper-char">
              {thisWeek.map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {areas.length > 0 ? (
          <div className="min-w-0">
            <h3 className="text-[13px] leading-5 text-paper-sage">Areas of life</h3>
            <ul className="mt-1 space-y-1" aria-label="Areas of life">
              {areas.map((area) => (
                <li key={area.name} className="flex items-center justify-between gap-2 text-[14px] leading-[22px] text-paper-char">
                  <span className="truncate">{area.name}</span>
                  <Tag tone={TONE[area.status]}>{area.status === "unrated" ? "Unrated" : area.status}</Tag>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </PaperSection>
  );
}
