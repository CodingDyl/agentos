import type { FinanceData } from "@shared/finance-types";
import { PaperCard, PaperSection } from "@/components/paper";
import { Figure } from "./finance-kit";
import { money } from "./finance-model";

/**
 * Investments, conservatively.
 *
 * A portfolio view and a research workspace. Deliberately not a recommendation
 * engine: the right choice depends on time horizon, existing holdings,
 * liquidity needs and risk tolerance, and AgentOS knows none of that well
 * enough to say "buy". Research and recommendation are kept apart.
 */

const RESEARCH_AREAS: readonly { name: string; note: string }[] = [
  { name: "Broad SA equity", note: "Local market exposure in one fund: what it holds, and how concentrated the top holdings are." },
  { name: "Global equity", note: "Offshore diversification: currency exposure, regional split, and how much is one country." },
  { name: "Technology", note: "A sector bet, not a broad one: how much it overlaps with a global fund you may already hold." },
  { name: "Dividend", note: "Income characteristics: yield, payout consistency, and what the yield is made of." },
  { name: "Emerging markets", note: "Higher volatility and a wide spread of outcomes: fees and country weights matter most." },
];

const COMPARE: readonly string[] = ["Fees (total expense ratio)", "Geographic exposure", "Sector concentration", "Historical volatility", "Top holdings", "Dividend characteristics"];

export function FinanceInvestmentsTab({ data }: { data: FinanceData }) {
  const { portfolioValue, monthlyContribution } = data.investments;

  return (
    <div className="space-y-12">
      <PaperCard className="bg-paper-cream p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <Figure label="Portfolio value" value={portfolioValue === undefined ? "-" : money(portfolioValue)} note={portfolioValue === undefined ? "No investment account found. Investec's read-only API only shows accounts it can see." : "Investment accounts Investec reports."} />
          <Figure label="Monthly contribution" value={monthlyContribution === undefined ? "-" : money(monthlyContribution)} note="Money moved to an investment platform this month, when the description says so." />
        </div>
      </PaperCard>

      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        <PaperSection label="Research areas">
          <p className="mb-4 max-w-[60ch] text-[14px] leading-6 text-paper-char">Start with diversified exposure, and learn what each is before choosing one.</p>
          <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
            {RESEARCH_AREAS.map((area) => (
              <li key={area.name} className="px-4 py-3">
                <p className="font-paper-display text-[15px] font-bold text-paper-moss">{area.name}</p>
                <p className="mt-0.5 text-[13.5px] leading-6 text-paper-char">{area.note}</p>
              </li>
            ))}
          </ul>
        </PaperSection>

        <PaperSection label="What to compare">
          <ul className="space-y-2">
            {COMPARE.map((item) => (
              <li key={item} className="flex items-baseline gap-2.5 text-[14.5px] leading-6 text-paper-moss">
                <span aria-hidden="true" className="size-1.5 shrink-0 translate-y-[-0.15em] rounded-full border border-paper-amber-deep" />
                {item}
              </li>
            ))}
          </ul>
          <div role="note" className="mt-6 rounded-[4px] bg-paper-linen p-4 text-[13.5px] leading-6 text-paper-char">
            <p className="font-semibold text-paper-moss">Research is not a recommendation.</p>
            <p className="mt-1">
              AgentOS will not tell you to buy a company or a fund, and it cannot buy or move anything. Watchlists and fund comparisons are the next step once you know what you want from this page.
            </p>
          </div>
        </PaperSection>
      </div>
    </div>
  );
}
