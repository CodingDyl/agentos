import { Link } from "react-router-dom";
import { chaseDate } from "@shared/traction-dates";
import { PaperSection } from "@/components/paper";
import { useTraction } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { formatShortDate, queueItemHref, queueProgress } from "./traction-model";

/** How many queue items Today shows before pointing at Traction. */
const TODAY_LIMIT = 3;

/**
 * Traction on Today, beside the build work.
 *
 * Prospecting feels uncomfortable and pays late; code feels productive now.
 * If Today only showed the build, acquisition would always lose. So the
 * section is always present — even empty, it says there is nothing queued and
 * links to where the queue is filled — and it comes before the workspaces.
 */
export function TractionToday({ className }: { className?: string }) {
  const { data, isError } = useTraction();

  if (isError) {
    return (
      <PaperSection label="Traction" className={className}>
        <p className="text-[15px] leading-6 text-paper-flame-deep">Traction could not be read.</p>
      </PaperSection>
    );
  }

  if (!data) return null;

  const progress = queueProgress(data);
  const shown = data.queue.slice(0, TODAY_LIMIT);

  return (
    <PaperSection
      id="traction"
      label="Traction"
      className={className}
      action={
        <Link
          to="/traction"
          className="text-[12.5px] -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-paper-sage transition-colors duration-150 hover:text-paper-moss"
        >
          {progress.total > 0 ? `${progress.done} / ${progress.total} done · ` : ""}Open Traction →
        </Link>
      }
    >
      {shown.length === 0 ? (
        <p className="text-[15px] leading-6 text-paper-char">
          {data.prospects.length === 0 ? (
            <>
              No prospects yet.{" "}
              <Link to="/traction?tab=prospects" className="rounded-sm text-paper-moss underline-offset-4 hover:underline">
                Add the first ten
              </Link>
              .
            </>
          ) : progress.done > 0 ? (
            "Today's acquisition work is done."
          ) : (
            "Nothing queued for today."
          )}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((item) => (
            <li key={item.id} className="flex min-w-0 items-baseline gap-3">
              <span className="size-1.5 shrink-0 translate-y-[-0.15em] rounded-full border border-paper-amber-deep" aria-hidden="true" />
              <Link
                to={queueItemHref(item)}
                className="min-w-0 rounded-sm text-[16px] leading-7 text-paper-char transition-colors duration-150 hover:text-paper-moss"
              >
                {item.title}
                <span className="text-[12.5px] ml-2 text-paper-sage">{item.detail[0]}</span>
              </Link>
            </li>
          ))}
          {data.queue.length > shown.length ? (
            <li className="text-[12.5px] pl-4.5 text-paper-sage">+{data.queue.length - shown.length} more in the queue</li>
          ) : null}
        </ul>
      )}

      {data.mailSuggestions.length > 0 ? (
        <p className="mt-4 text-[15px] leading-6">
          <Link to="/traction" className="rounded-sm text-paper-flame-deep underline-offset-4 hover:underline">
            {data.mailSuggestions.length} {data.mailSuggestions.length === 1 ? "prospect reply" : "prospect replies"} to confirm
          </Link>
        </p>
      ) : null}

      {/* What others owe — clients as much as prospects. Chases already due are
          in the queue above; this is the rest of the list, so nothing owed is
          only in your head. */}
      {data.waiting.length > 0 ? (
        <div className="mt-5">
          <p className="text-[12.5px] text-paper-sage">Waiting on</p>
          <ul className="mt-2 space-y-1.5">
            {data.waiting.slice(0, 4).map((item) => (
              <li key={item.id} className="flex min-w-0 items-baseline gap-3 text-[15px] leading-6 text-paper-char">
                <span className="min-w-0 truncate">
                  {item.who} <span className="text-paper-sage">·</span> {item.what}
                </span>
                <span className="text-[12.5px] shrink-0 text-paper-sage">
                  {chaseDate(item) <= data.today ? "chase today" : `chase ${formatShortDate(chaseDate(item))}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.attention.length > 0 ? (
        <ul className={cn("space-y-1", shown.length > 0 || data.prospects.length > 0 ? "mt-4" : "")}>
          {data.attention.map((flag) => (
            <li key={flag.kind} className="text-[14px] leading-6 text-paper-flame-deep">
              {flag.message}
            </li>
          ))}
        </ul>
      ) : null}
    </PaperSection>
  );
}
