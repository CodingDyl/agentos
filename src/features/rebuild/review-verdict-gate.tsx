import { useId } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import type { ReviewVerdict } from "@shared/website-rebuild-types";
import { Tag } from "@/components/paper";
import { needsOverride } from "./review-verdict-model";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The reviewer's conclusion beside the approve button. With blockers, approving
 * waits for the box to be ticked: overriding the reviewer is a choice, not a slip.
 */
export function ReviewVerdictGate({ verdict, override, onOverride }: { verdict: ReviewVerdict | undefined; override: boolean; onOverride: (value: boolean) => void }) {
  const id = useId();
  if (!verdict) return null;
  const counts = [verdict.blockers > 0 ? plural(verdict.blockers, "blocker") : "", verdict.majors > 0 ? `${verdict.majors} major` : "", verdict.minors > 0 ? `${verdict.minors} minor` : ""].filter(Boolean).join(" · ");
  const blocked = needsOverride(verdict);
  const Icon = blocked ? AlertTriangle : verdict.ready ? CheckCircle2 : CircleHelp;

  return (
    <div className="mt-3 max-w-[75ch]">
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-paper-char">
        <Icon aria-hidden className={blocked ? "size-4 text-paper-flame-deep" : verdict.ready ? "size-4 text-paper-green" : "size-4 text-paper-sage"} />
        <span className="font-semibold text-paper-moss">Reviewer:</span>
        <span>{verdict.ready === true ? "ready for the client" : verdict.ready === false ? "not ready yet" : "no clear verdict"}</span>
        {counts ? <Tag tone={blocked ? "flame" : "muted"}>{counts}</Tag> : null}
      </p>
      {blocked ? (
        <label htmlFor={`${id}-override`} className="mt-2 flex cursor-pointer items-start gap-2.5 text-[13px] text-paper-char">
          <input id={`${id}-override`} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--paper-flame)]" checked={override} onChange={(event) => onOverride(event.target.checked)} />
          <span>
            I read the review and want to approve with {plural(verdict.blockers, "blocker")} still open. Requesting changes sends the findings to the next revision.
          </span>
        </label>
      ) : null}
    </div>
  );
}
