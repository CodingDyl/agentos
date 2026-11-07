import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { OWNER_HOURS_KINDS, type ClientOutcome, type OutcomesResponse, type OwnerHoursKind } from "@shared/outcomes-types";
import { PageLoader } from "@/components/os";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperSection } from "@/components/paper";
import { useEvalHistory } from "@/lib/agentos/evals";
import { useDeleteOwnerHours, useLogOwnerHours, useOutcomes } from "@/lib/agentos/outcomes";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DASH, formatMinutes, formatRandMinor, formatRate, formatUsd, monthLabel } from "./outcomes-model";

/**
 * Outcomes: did agent work earn money?
 *
 * Paid results against the monthly target, per client, beside the agent jobs
 * that landed and the owner's own hours. Every figure is read from the ledger,
 * the job store and the hours the owner logged; nothing is inferred. An
 * unknown figure is a dash, never R0.
 */

const CHIPS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: "15m" },
  { minutes: 30, label: "30m" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
];

const KIND_LABEL: Record<OwnerHoursKind, string> = {
  delivery: "Delivery",
  review: "Review",
  sales: "Sales",
  admin: "Admin",
  learning: "Learning",
};

export function OutcomesTab() {
  const outcomes = useOutcomes();

  if (outcomes.isPending) return <PageLoader variant="compact" />;
  if (!outcomes.data) {
    return <p className="text-[14px] text-paper-flame-deep">{outcomes.error?.message ?? "The scorecard could not be read."}</p>;
  }
  const data = outcomes.data;

  return (
    <div className="grid gap-10">
      <Headline data={data} />
      <Clients data={data} />
      <Hours data={data} />
      <EvalLine />
      {data.warnings.length > 0 ? (
        <ul className="grid gap-1 text-[13px] leading-5 text-paper-sage" aria-label="Things to know">
          {data.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-paper-char">{label}</p>
      <p className="mt-1 text-[24px] leading-[1.1] font-semibold tracking-[-0.02em] text-paper-moss tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-[13px] leading-5 text-paper-sage">{detail}</p> : null}
    </div>
  );
}

function Headline({ data }: { data: OutcomesResponse }) {
  return (
    <PaperSection label={`Paid in ${monthLabel(data.month)}`}>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <Stat
          label="Paid this month"
          value={formatRandMinor(data.paidMinor)}
          detail={data.target ? `of ${formatRandMinor(data.target.minor)} (${data.target.goalId})` : undefined}
        />
        <Stat
          label="Left to target"
          value={formatRandMinor(data.gapMinor)}
          detail={data.target ? undefined : "No monthly income target to measure against."}
        />
        <Stat
          label="3-month average"
          value={formatRandMinor(data.trailingAverageMinor)}
          detail={data.trailingAverageMinor === null ? "Nothing has been paid yet." : "The last three full months."}
        />
      </div>
      {data.target === null ? (
        <p className="mt-4 text-[14px] leading-6 text-paper-char">
          Set a monthly income goal with a rand target in{" "}
          <Link to="/compass" className={cn("rounded-sm font-medium text-paper-moss underline decoration-paper-gold underline-offset-4", PAPER_FOCUS)}>
            Compass
          </Link>{" "}
          to see the gap.
        </p>
      ) : null}
      <p className="mt-4 max-w-[64ch] text-[13px] leading-5 text-paper-sage">
        Client payments only: salary is not counted. AI cost is in dollars and is never converted to rand.
      </p>
    </PaperSection>
  );
}

function Clients({ data }: { data: OutcomesResponse }) {
  const { agentWork, unattributed } = data;
  return (
    <PaperSection label="By client" count={data.clients.length}>
      <p className="max-w-[64ch] text-[14px] leading-6 text-paper-char">
        {agentWork.landedJobs === 0
          ? "No agent jobs have landed this month."
          : `${agentWork.onPayingClients} of ${agentWork.landedJobs} landed agent ${agentWork.landedJobs === 1 ? "job was" : "jobs were"} for paying clients. ${formatRate(agentWork.firstPassRate)} landed first time.`}
      </p>
      <PaperCard className="mt-3 p-0">
        {data.clients.length === 0 ? (
          <p className="p-4 text-[14px] text-paper-sage">No client has a payment, a landed job or logged hours yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">Money, agent work and hours per client this month</caption>
              <thead>
                <tr className="border-b border-paper-stone text-paper-sage">
                  {["Client", "Paid", "90 days", "Jobs", "Send-backs", "AI cost", "Your hours", "Rand per hour"].map((heading, index) => (
                    <th key={heading} scope="col" className={cn("px-4 py-2 font-medium", index > 0 && "text-right")}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-stone">
                {data.clients.map((client) => (
                  <ClientRow key={client.clientId} client={client} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PaperCard>
      {unattributed.paidMinor > 0 || unattributed.landedJobs > 0 || unattributed.ownerMinutes > 0 ? (
        <p className="mt-3 max-w-[64ch] text-[13px] leading-5 text-paper-sage">
          Unattributed this month: {formatRandMinor(unattributed.paidMinor)} paid, {unattributed.landedJobs} landed{" "}
          {unattributed.landedJobs === 1 ? "job" : "jobs"}, {formatMinutes(unattributed.ownerMinutes)} of your hours. Link a client to a workspace in Business to place them.
        </p>
      ) : null}
    </PaperSection>
  );
}

function ClientRow({ client }: { client: ClientOutcome }) {
  const cell = "px-4 py-2 text-right tabular-nums text-paper-moss";
  return (
    <tr>
      <th scope="row" className="px-4 py-2 font-medium text-paper-moss">
        {client.name}
        {client.workspace ? <span className="block font-normal text-paper-sage">{client.workspace}</span> : null}
      </th>
      <td className={cell}>{formatRandMinor(client.paidMinor)}</td>
      <td className={cell}>{formatRandMinor(client.paidTrailing90Minor)}</td>
      <td className={cell}>{client.landedJobs}</td>
      <td className={cell}>{client.sendBacks}</td>
      <td className={cell}>{formatUsd(client.aiCostUsd)}</td>
      <td className={cell}>{client.ownerMinutes > 0 ? formatMinutes(client.ownerMinutes) : DASH}</td>
      <td className={cell}>{formatRandMinor(client.randPerHourMinor)}</td>
    </tr>
  );
}

function Hours({ data }: { data: OutcomesResponse }) {
  const log = useLogOwnerHours();
  const remove = useDeleteOwnerHours();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [clientId, setClientId] = useState("");
  const [kind, setKind] = useState<OwnerHoursKind>("delivery");
  const hours = data.ownerHours;

  const submit = () => {
    if (minutes === null) return;
    const client = data.choices.clients.find((candidate) => candidate.id === clientId);
    log.mutate(
      {
        // Local date, as the owner means it: today is today on their clock.
        on: new Date().toLocaleDateString("en-CA"),
        minutes,
        kind,
        ...(client ? { clientId: client.id } : {}),
      },
      { onSuccess: () => setMinutes(null) },
    );
  };

  return (
    <PaperSection label="Your hours">
      <form
        aria-label="Log your hours"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="grid max-w-[720px] gap-4"
      >
        <div>
          <FieldLabel>How long</FieldLabel>
          <div role="group" aria-label="How long" className="flex flex-wrap gap-2">
            {CHIPS.map((chip) => (
              <button
                key={chip.minutes}
                type="button"
                aria-pressed={minutes === chip.minutes}
                onClick={() => setMinutes(minutes === chip.minutes ? null : chip.minutes)}
                className={cn(
                  "min-h-9 min-w-14 cursor-pointer rounded-md border px-3 text-[14px] font-medium tabular-nums transition-colors duration-150",
                  PAPER_FOCUS,
                  minutes === chip.minutes
                    ? "border-paper-moss bg-paper-moss text-paper-white"
                    : "border-paper-ash bg-paper-linen text-paper-moss hover:bg-paper-cream",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0">
            <FieldLabel>For</FieldLabel>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)} className={cn(PAPER_INPUT, "w-full cursor-pointer pr-8")}>
              <option value="">No one in particular</option>
              {data.choices.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <FieldLabel>Kind of work</FieldLabel>
            <select value={kind} onChange={(event) => setKind(event.target.value as OwnerHoursKind)} className={cn(PAPER_INPUT, "w-full cursor-pointer pr-8")}>
              {OWNER_HOURS_KINDS.map((option) => (
                <option key={option} value={option}>
                  {KIND_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PaperButton type="submit" variant="ghost" disabled={minutes === null || log.isPending}>
            {log.isPending ? "Saving…" : "Log hours"}
          </PaperButton>
          {log.isError ? (
            <p role="alert" className="text-[13px] text-paper-flame-deep">
              {log.error.message}
            </p>
          ) : null}
        </div>
      </form>

      {hours.entries.length === 0 ? (
        <p className="mt-6 max-w-[64ch] text-[14px] leading-6 text-paper-sage">
          No hours logged this month. Rand per hour stays blank until you log some: it is never worked out for you.
        </p>
      ) : (
        <div className="mt-6">
          <p className="text-[14px] leading-6 text-paper-char" aria-live="polite">
            <span className="font-semibold tabular-nums text-paper-moss">{formatMinutes(hours.monthMinutes)}</span> this month ·{" "}
            <span className="tabular-nums">{formatMinutes(hours.weekMinutes)}</span> this week
            {Object.keys(hours.byKind).length > 0
              ? ` · ${Object.entries(hours.byKind)
                  .map(([name, total]) => `${KIND_LABEL[name as OwnerHoursKind] ?? name} ${formatMinutes(total)}`)
                  .join(", ")}`
              : ""}
          </p>
          <ul className="mt-3 divide-y divide-paper-mist border-y border-paper-mist">
            {hours.entries.slice(0, 8).map((entry) => {
              const client = data.choices.clients.find((candidate) => candidate.id === entry.clientId);
              return (
                <li key={entry.id} className="flex items-center gap-3 py-2 text-[13px] leading-5">
                  <span className="w-20 shrink-0 text-paper-sage tabular-nums">{entry.on}</span>
                  <span className="w-14 shrink-0 font-medium text-paper-moss tabular-nums">{formatMinutes(entry.minutes)}</span>
                  <span className="min-w-0 flex-1 truncate text-paper-char">
                    {KIND_LABEL[entry.kind]}
                    {client ? ` · ${client.name}` : entry.workspace ? ` · ${entry.workspace}` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${formatMinutes(entry.minutes)} ${KIND_LABEL[entry.kind]} on ${entry.on}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(entry.id)}
                    className={cn("inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-paper-sage hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
                  >
                    <X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PaperSection>
  );
}

/**
 * One quiet line: how the mail triage eval last scored. It only ever reads the
 * history; running an eval is a command, because it spends credits.
 */
function EvalLine() {
  const history = useEvalHistory("mail");
  if (history.isPending || history.isError) return null;
  const { latest, comparison } = history.data;

  return (
    <p className="max-w-[64ch] text-[13px] leading-5 text-paper-sage" aria-label="Mail triage eval">
      {latest ? (
        <>
          Mail triage eval: <span className="tabular-nums text-paper-char">{comparison.line}</span> Ran {formatRelativeTime(latest.at)}.
        </>
      ) : (
        <>
          Mail triage eval: no runs yet. Start one with <code className="font-mono text-[12px] text-paper-char">npm run eval:mail</code>.
        </>
      )}
    </p>
  );
}
