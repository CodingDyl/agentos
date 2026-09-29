import { useState } from "react";
import type { Debt, FinanceData, Finding } from "@shared/finance-types";
import { PaperButton, PaperSection, PAPER_INPUT, Tag } from "@/components/paper";
import { useAnalyse, useAskAnalyser } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { MiniBar, PayBadge, UtilisationBar } from "./finance-badges";
import { FoldCard, FoldControls } from "./finance-fold";
import { Line, MutationError } from "./finance-kit";
import { debtPayState, money, utilisationTone } from "./finance-model";
import { useFold } from "./finance-ui-hooks";

/**
 * The analyser.
 *
 * Two layers, kept apart on purpose. The checks are arithmetic against named
 * principles (pay yourself first, clear expensive debt first, an emergency
 * buffer, and so on), each with its evidence written out. Hermes then explains
 * them and turns them into a plan. It is given the findings and totals, never
 * merchants, account names or numbers, and it cannot move or change anything:
 * it replies with words.
 */

const STATUS: Record<Finding["status"], { label: string; tone: "flame" | "marigold" | "green" }> = {
  act: { label: "Act on this", tone: "flame" },
  watch: { label: "Keep an eye on", tone: "marigold" },
  good: { label: "Going well", tone: "green" },
};

export function FinanceAnalyserTab({ data }: { data: FinanceData }) {
  const { findings, focus } = data.analysis;
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const focused = focus.map((id) => byId.get(id)).filter((finding): finding is Finding => finding !== undefined);
  const rest = findings.filter((finding) => !focus.includes(finding.id));

  // What to act on starts open; what is going well starts folded. Debts open when they need attention.
  const fold = useFold(
    [...findings.map((finding) => finding.id), ...data.debts.map((debt) => `debt:${debt.accountId}`)],
    (id) => {
      if (id.startsWith("debt:")) {
        const debt = data.debts.find((entry) => `debt:${entry.accountId}` === id);
        return debt === undefined || debt.utilisation === undefined || utilisationTone(debt.utilisation) !== "good" || data.debts.length === 1;
      }
      return focus.includes(id);
    },
  );

  if (findings.length === 0) {
    return (
      <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
        There is not enough to analyse yet. Once a month of income and spending is in, the analyser checks it against a set of money principles and says what to look at first.
      </p>
    );
  }

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <PaperSection label="Look at first" count={focused.length}>
          {focused.length === 0 ? (
            <p className="text-[14px] leading-6 text-paper-char">Nothing needs action. Everything checked is going well.</p>
          ) : (
            <ol className="space-y-3">
              {focused.map((finding, index) => (
                <li key={finding.id}>
                  <FindingCard finding={finding} rank={index + 1} open={fold.isOpen(finding.id)} onToggle={() => fold.toggle(finding.id)} />
                </li>
              ))}
            </ol>
          )}
        </PaperSection>

        {data.debts.length > 0 ? (
          <PaperSection
            label="Debt"
            count={data.debts.length}
            action={<FoldControls count={data.debts.length} allOpen={data.debts.every((debt) => fold.isOpen(`debt:${debt.accountId}`))} onSetAll={(open) => fold.setAll(open, data.debts.map((debt) => `debt:${debt.accountId}`))} />}
          >
            <ul className="space-y-3">
              {data.debts.map((debt) => (
                <li key={debt.accountId}>
                  <DebtCard debt={debt} freeCashFlow={data.freeCashFlow} open={fold.isOpen(`debt:${debt.accountId}`)} onToggle={() => fold.toggle(`debt:${debt.accountId}`)} />
                </li>
              ))}
            </ul>
          </PaperSection>
        ) : null}

        <PaperSection
          label="Everything checked"
          count={findings.length}
          action={<FoldControls count={findings.length} allOpen={(focused.length > 0 ? rest : findings).every((finding) => fold.isOpen(finding.id))} onSetAll={(open) => fold.setAll(open, (focused.length > 0 ? rest : findings).map((finding) => finding.id))} />}
        >
          <ul className="space-y-3">
            {(focused.length > 0 ? rest : findings).map((finding) => (
              <li key={finding.id}>
                <FindingCard finding={finding} open={fold.isOpen(finding.id)} onToggle={() => fold.toggle(finding.id)} />
              </li>
            ))}
          </ul>
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-12">
        <HermesPanel data={data} />
      </div>
    </div>
  );
}

const FINDING_ACCENT = { act: "flame", watch: "amber", good: "green" } as const;

function FindingCard({ finding, rank, open, onToggle }: { finding: Finding; rank?: number; open: boolean; onToggle: () => void }) {
  const status = STATUS[finding.status];
  return (
    <FoldCard
      open={open}
      onToggle={onToggle}
      accent={FINDING_ACCENT[finding.status]}
      title={
        <>
          {rank ? <span className="mr-2 text-paper-sage tabular-nums">{rank}</span> : null}
          {finding.title}
        </>
      }
      meta={
        <>
          <Tag tone={status.tone}>{status.label}</Tag>
          <span>{finding.principle}</span>
          <span className="block basis-full pt-1 text-[14px] leading-6 text-paper-char">{finding.summary}</span>
        </>
      }
    >
      {finding.evidence.length > 0 ? (
        <ul className="space-y-1">
          {finding.evidence.map((line) => (
            <li key={line} className="text-[13.5px] leading-6 text-paper-char">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {finding.action ? (
        <p className={cn("text-[14px] leading-6 text-paper-moss", finding.evidence.length > 0 && "mt-3")}>
          <span className="font-semibold">What to do: </span>
          {finding.action}
        </p>
      ) : (
        <p className="text-[13.5px] leading-6 text-paper-sage">Nothing to do here.</p>
      )}
    </FoldCard>
  );
}

function DebtCard({ debt, freeCashFlow, open, onToggle }: { debt: Debt; freeCashFlow: number | undefined; open: boolean; onToggle: () => void }) {
  const pay = debtPayState(debt);
  const tone = debt.utilisation === undefined ? undefined : utilisationTone(debt.utilisation);
  // The stripe is the worst of the two signals: a heavily used limit, or a month with no payment.
  const accent = tone === "act" || pay.state === "late" ? "flame" : tone === "watch" ? "amber" : pay.state === "paid" ? "green" : "none";

  return (
    <FoldCard
      open={open}
      onToggle={onToggle}
      accent={accent}
      title={debt.name}
      meta={
        <>
          <PayBadge state={pay.state}>{pay.label}</PayBadge>
          <span>{debt.interestRate === undefined ? "No rate set" : `${(debt.interestRate * 100).toFixed(1).replace(/\.0$/, "")}% a year`}</span>
          {debt.utilisation !== undefined ? <MiniBar value={debt.utilisation} label={`${Math.round(debt.utilisation * 100)}% of the limit used`} tone={tone === "good" ? "green" : tone === "watch" ? "amber" : "flame"} /> : null}
        </>
      }
      figure={
        <>
          <span className="block font-paper-display text-[20px] leading-6 font-extrabold tracking-[-0.02em] text-paper-moss tabular-nums">{money(debt.owed)}</span>
          <span className="block text-[12px] text-paper-sage">owed</span>
        </>
      }
    >
      {debt.interestRate === undefined ? <p className="mb-3 text-[13.5px] leading-6 font-semibold text-paper-flame-deep">No interest rate set, so the cost below is understated.</p> : null}

      {debt.utilisation !== undefined && debt.creditLimit ? <UtilisationBar value={debt.utilisation} label={`Limit used (${money(debt.creditLimit)})`} /> : null}

      <dl className="mt-3 divide-y divide-paper-stone">
        {debt.monthlyInterest !== undefined ? <Line label="Interest added each month" value={money(debt.monthlyInterest)} /> : null}
        {debt.hasStatement ? <Line label="Paid into it this month" value={money(debt.paidThisMonth)} /> : null}
        {freeCashFlow !== undefined && freeCashFlow > 0 ? (
          <Line
            label={`At your free cash flow (${money(freeCashFlow)} a month)`}
            value={debt.monthsAtFreeCashFlow === undefined ? "Does not clear it" : `${debt.monthsAtFreeCashFlow} ${debt.monthsAtFreeCashFlow === 1 ? "month" : "months"}`}
          />
        ) : null}
      </dl>

      {!debt.hasStatement ? <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">Import this card's statement (Cash flow → Accounts → Manage) and Finance can show whether you have paid into it this month.</p> : null}

      <div className="mt-4 overflow-x-auto rounded-[4px] border border-paper-mist">
        <table className="w-full min-w-[22rem] text-left text-[14px]">
          <thead className="bg-paper-linen text-[12.5px] text-paper-char">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">To clear it in</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Pay each month</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Interest paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-stone tabular-nums">
            {debt.options.map((option) => (
              <tr key={option.months}>
                <th scope="row" className="px-4 py-2 font-medium text-paper-moss">{option.months} months</th>
                <td className="px-4 py-2 text-right font-semibold text-paper-moss">{money(option.monthly)}</td>
                <td className="px-4 py-2 text-right text-paper-char">{debt.interestRate === undefined ? "-" : money(option.interest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">
        An estimate: interest is worked out monthly at the rate you entered. Real cards work it out daily and may add fees, so the true cost is a little higher. Set the rate and limit under Cash flow → Accounts → Manage.
      </p>
    </FoldCard>
  );
}

function HermesPanel({ data }: { data: FinanceData }) {
  const analyse = useAnalyse();
  const ask = useAskAnalyser();
  const [question, setQuestion] = useState("");
  const { narrative, narrativeAt } = data.analysis;
  const sample = data.source.kind === "sample";

  return (
    <PaperSection label="Hermes">
      <p className="text-[14px] leading-6 text-paper-char">
        Hermes reads the findings and writes a plan in words. It is told to use only the figures it is given and never to name a product, or to tell you to buy, sell or cancel anything.
      </p>

      {narrative ? (
        <div className="mt-4">
          <p className="text-[14.5px] leading-7 whitespace-pre-line text-paper-moss">{narrative}</p>
          {narrativeAt ? <p className="mt-2 text-[12.5px] text-paper-sage">Written {new Date(narrativeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} from the checks on the left.</p> : null}
        </div>
      ) : null}

      <PaperButton variant="amber" className="mt-4" disabled={analyse.isPending || sample} onClick={() => analyse.mutate()}>
        {analyse.isPending ? "Asking Hermes…" : narrative ? "Analyse again" : "Analyse with Hermes"}
      </PaperButton>
      {sample ? <p className="mt-2 text-[12.5px] text-paper-sage">Not available on sample data.</p> : null}
      <MutationError error={analyse.error} />

      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim().length >= 3) ask.mutate(question.trim());
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-paper-char">Ask a question about your money</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Should I pay off the card before building my emergency fund?"
            className={`${PAPER_INPUT} w-full py-2 leading-6`}
          />
        </label>
        <PaperButton variant="ghost" type="submit" className="mt-2" disabled={ask.isPending || sample || question.trim().length < 3}>
          {ask.isPending ? "Asking…" : "Ask"}
        </PaperButton>
        <MutationError error={ask.error} />
      </form>
      {ask.data ? (
        <div className="mt-4 rounded-[4px] bg-paper-cream p-4" role="status">
          <p className="text-[14.5px] leading-7 whitespace-pre-line text-paper-moss">{ask.data.answer}</p>
        </div>
      ) : null}

      <div role="note" className="mt-8 rounded-[4px] bg-paper-linen p-4 text-[13px] leading-6 text-paper-char">
        <p className="font-semibold text-paper-moss">What Hermes sees</p>
        <p className="mt-1">Income, spending and saving totals, category totals, subscription counts, goal progress, and each debt's size (rounded to the nearest R100), rate and limit use. Debts are called Card A, Card B.</p>
        <p className="mt-2 font-semibold text-paper-moss">What it never sees</p>
        <p className="mt-1">Account numbers, account names, logins, individual merchants or payments, or your Investec credentials.</p>
        <p className="mt-2">This is a coach, not advice from a regulated adviser. The principles are general, and none is a rule for everyone.</p>
      </div>
    </PaperSection>
  );
}
