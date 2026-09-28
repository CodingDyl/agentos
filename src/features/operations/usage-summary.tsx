import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PaperSection } from "@/components/paper";
import { useUsageSummary } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  budgetTone,
  coverageNote,
  formatCost,
  measuredCost,
  measuredTokens,
  measurementTone,
  UNKNOWN,
} from "./operations-model";

/**
 * Spend, on Mission Control.
 *
 * Four lines and a link. Mission Control is a consolidation, not a second copy
 * of every screen, and its question here is small: *is anything unusual
 * happening to my spend today?* The moment this block started breaking down
 * models or ranking projects it would be competing with Operations rather than
 * pointing at it.
 *
 * It removes itself entirely when nothing has been recorded. A permanent row
 * of em dashes would spend attention on a ledger nobody has filled yet, and
 * this screen is designed hardest for the good day.
 */
export function UsageSummary() {
  const { data } = useUsageSummary();

  if (!data || data.month.records === 0) return null;

  const todayTokens = measuredTokens(data.today);
  const todayCost = measuredCost(data.today);
  const note = coverageNote(data.today);

  return (
    <PaperSection
      label="AI usage"
      action={
        <Link
          to="/operations"
          className="text-[12.5px] inline-flex cursor-pointer items-center gap-2 rounded-md text-paper-sage transition-colors duration-150 hover:text-paper-moss"
        >
          Operations
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="grid gap-x-12 gap-y-6 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-paper-sage">Today</p>
          <p className="mt-2 text-[18px] leading-6">
            <span className={measurementTone(todayCost.measurement)}>
              {todayCost.text}
            </span>
            <span className="text-paper-sage"> · </span>
            <span className={measurementTone(todayTokens.measurement)}>
              {todayTokens.text}
            </span>
          </p>
          {note ? (
            <p className="mt-1.5 text-[13px] leading-5 text-paper-sage">{note}</p>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="text-[12.5px] text-paper-sage">Month</p>
          <p className="mt-2 text-[18px] leading-6 text-paper-moss">
            {formatCost(data.month.costUsd)}
            {data.budget ? (
              <span className="text-paper-sage">
                {" "}
                / {formatCost(data.budget.budget.monthlyUsd)}
              </span>
            ) : null}
          </p>

          {data.budget ? (
            <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-paper-stone">
              <div
                className={cn("h-full", budgetTone(data.budget.state))}
                style={{
                  width: `${Math.min(data.budget.fraction * 100, 100)}%`,
                }}
                aria-hidden="true"
              />
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="text-[12.5px] text-paper-sage">Highest today</p>
          <p className="mt-2 text-[18px] leading-6 text-paper-moss">
            {data.topAgent
              ? `${data.topAgent.label} · ${formatCost(data.topAgent.costUsd)}`
              : UNKNOWN}
          </p>
          {!data.topAgent ? (
            <p className="mt-1.5 text-[13px] leading-5 text-paper-sage">
              Nothing today reported a cost
            </p>
          ) : null}
        </div>
      </div>
    </PaperSection>
  );
}
