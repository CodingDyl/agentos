import { Link } from "react-router-dom";
import { PaperSection } from "@/components/paper";
import { useFinance } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";

/** How many alerts Today shows before pointing at Finance. */
const TODAY_LIMIT = 4;

/**
 * Finance on Today, so it is part of the day rather than a page nobody opens.
 *
 * Only real data raises alerts here. On sample data, or with no accounts, the
 * section says how to connect instead of announcing problems in a ledger that
 * is not yours.
 */
export function FinanceToday({ className }: { className?: string }) {
  const { data, isError } = useFinance();

  if (isError) {
    return (
      <PaperSection label="Finance" className={className}>
        <p className="text-[15px] leading-6 text-paper-flame-deep">Finance could not be read.</p>
      </PaperSection>
    );
  }

  if (!data) return null;

  const live = data.source.kind === "investec";
  const shown = live ? data.attention.slice(0, TODAY_LIMIT) : [];

  return (
    <PaperSection
      id="finance"
      label="Finance"
      className={className}
      action={
        <Link to="/finance" className="-mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-[12.5px] text-paper-sage transition-colors duration-150 hover:text-paper-moss">
          Open Finance →
        </Link>
      }
    >
      {!live ? (
        <p className="text-[15px] leading-6 text-paper-char">
          Finance is not connected to a bank yet.{" "}
          <Link to="/finance?tab=settings" className="rounded-sm text-paper-moss underline-offset-4 hover:underline">
            Connect Investec
          </Link>{" "}
          to see spending alerts here.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[15px] leading-6 text-paper-char">Nothing needs attention in your money.</p>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((item) => (
            <li key={item.id} className="flex min-w-0 items-baseline gap-3">
              <span aria-hidden="true" className={cn("w-3 shrink-0 text-center text-[13px] font-semibold", item.tone === "warn" ? "text-paper-flame-deep" : "text-paper-sage")}>
                {item.tone === "warn" ? "!" : "○"}
              </span>
              <Link to={`/finance?tab=${item.tab}`} className="min-w-0 rounded-sm text-[16px] leading-7 text-paper-char transition-colors duration-150 hover:text-paper-moss">
                {item.text}
              </Link>
            </li>
          ))}
          {data.attention.length > shown.length ? <li className="pl-6 text-[12.5px] text-paper-sage">+{data.attention.length - shown.length} more in Finance</li> : null}
        </ul>
      )}
    </PaperSection>
  );
}
