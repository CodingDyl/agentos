import { PaperPagination } from "@/components/paper";
import type { FinanceData } from "@shared/finance-types";
import { PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useRemoveCorrection, useRestoreAlert, useSyncInvestec } from "@/lib/agentos/finance";
import { MutationError } from "./finance-kit";
import { usePagination } from "@/lib/use-pagination";

const PRIVACY: readonly string[] = [
  "Investec credentials are read by the server only. They are never sent to the browser or written to disk.",
  "The ledger lives in a local database on this machine, never in Markdown or the vault.",
  "Account numbers are cut to the last four digits on the way in.",
  "Jev sees a merchant, an amount, a rhythm and a price history. Hermes sees monthly totals, category totals and balances rounded to the nearest R100 (for the analyser). Neither sees account numbers, account names, logins or individual payments.",
  "The Investec connection is read-only. No part of AgentOS can pay, transfer or add a beneficiary.",
  "No autonomous transfers and no autonomous purchases, of anything.",
];

export function FinanceSettingsTab({ data }: { data: FinanceData }) {
  const sync = useSyncInvestec();
  const remove = useRemoveCorrection();
  const restore = useRestoreAlert();
  const { source } = data;
  const corrections = usePagination(data.corrections, "", 10);

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
      <div className="min-w-0 space-y-12">
        <PaperSection label="Investec">
          <PaperCard className="p-5">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-paper-moss">
              {source.configured ? <Tag tone="green">Credentials set</Tag> : <Tag tone="marigold">Not connected</Tag>}
              {source.kind === "investec" ? "Reading your accounts" : source.kind === "sample" ? "Showing sample data" : "No accounts read yet"}
            </p>

            {source.configured ? (
              <>
                <p className="mt-2 text-[13.5px] leading-6 text-paper-char">
                  {source.lastSyncedAt ? `Last synced ${new Date(source.lastSyncedAt).toLocaleString("en-GB")}.` : "Not synced yet."} The server refreshes on its own about every half hour when the page is open.
                </p>
                {source.error ? <p role="alert" className="mt-2 text-[13.5px] leading-6 text-paper-flame-deep">Last attempt failed: {source.error}</p> : null}
                <PaperButton variant="amber" className="mt-4" disabled={sync.isPending} onClick={() => sync.mutate()}>
                  {sync.isPending ? "Reading Investec…" : "Sync now"}
                </PaperButton>
                <MutationError error={sync.error} />
              </>
            ) : (
              <div className="mt-3 text-[13.5px] leading-6 text-paper-char">
                {source.missing.length > 0 && source.missing.length < 3 ? (
                  <p role="alert" className="mb-3 font-semibold text-paper-flame-deep">
                    Still missing: {source.missing.join(", ")}. All three are needed.
                  </p>
                ) : null}
                <p>Create API credentials in Investec's Programmable Banking portal, add them to the server's <code className="font-mono text-[12.5px]">.env</code> and <strong>restart the data server</strong> (it reads <code className="font-mono text-[12.5px]">.env</code> once, at startup):</p>
                <pre className="mt-3 overflow-x-auto rounded-none bg-paper-linen p-3 font-mono text-[12.5px] leading-6 text-paper-moss">
{`INVESTEC_CLIENT_ID=...
INVESTEC_SECRET=...
INVESTEC_API_KEY=...`}
                </pre>
                <p className="mt-3">
                  Never prefix them with <code className="font-mono text-[12.5px]">VITE_</code>. Anything with that prefix is bundled into the browser, where a secret is a public secret.
                </p>
              </div>
            )}
          </PaperCard>
        </PaperSection>

        <PaperSection label="Categories you taught it" count={data.corrections.length}>
          {data.corrections.length === 0 ? (
            <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">None yet. Change a payment's category on the Spending tab and Finance remembers it for that merchant, past and future.</p>
          ) : (
            <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
              {corrections.pageItems.map((correction) => (
                <li key={correction.merchant} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14.5px]">
                  <span className="min-w-0 truncate text-paper-moss">
                    {correction.merchant} <span className="text-paper-sage">→</span> {correction.category}
                  </span>
                  <PaperButton disabled={remove.isPending} onClick={() => remove.mutate(correction.merchant)} aria-label={`Forget ${correction.merchant}`}>
                    Forget
                  </PaperButton>
                </li>
              ))}
            </ul>
          )}
          <PaperPagination label="Categories you taught it pages" pager={corrections} />
          <MutationError error={remove.error} />
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-12">
      <PaperSection label="Dismissed alerts" count={data.dismissedAlerts.length}>
        {data.dismissedAlerts.length === 0 ? (
          <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">None. Dismiss an alert that is not relevant to you and it waits here until you bring it back.</p>
        ) : (
          <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
            {data.dismissedAlerts.map((alert) => (
              <li key={alert.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14.5px]">
                <span className="min-w-0 text-paper-moss">
                  <Tag>{alert.source}</Tag> {alert.text}
                  <span className="block text-[12.5px] text-paper-sage">{alert.scope === "always" ? "Hidden for good" : "Hidden until next month"}</span>
                </span>
                <PaperButton disabled={restore.isPending} onClick={() => restore.mutate(alert.id)} aria-label={`Bring back: ${alert.text}`}>
                  Bring back
                </PaperButton>
              </li>
            ))}
          </ul>
        )}
        <MutationError error={restore.error} />
      </PaperSection>

      <PaperSection label="Privacy">
        <ul className="space-y-3">
          {PRIVACY.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-[14.5px] leading-6 text-paper-char">
              <span aria-hidden="true" className="mt-[0.15em] shrink-0 font-semibold text-paper-green">✓</span>
              {line}
            </li>
          ))}
        </ul>
      </PaperSection>
      </div>
    </div>
  );
}
