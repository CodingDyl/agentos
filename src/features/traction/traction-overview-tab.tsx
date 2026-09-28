import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { chaseDate } from "@shared/traction-dates";
import type { TractionData, WeeklyTargets } from "@shared/traction-types";
import { formatRand } from "@shared/virtec-types";
import { CHANNEL_LABELS } from "@shared/traction-types";
import { Meter, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useSaveTargets } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { TractionIcpCard } from "./traction-icp-card";
import { TractionMailSuggestions } from "./traction-mail-suggestions";
import { formatShortDate, PIPELINE_STAGES, queueProgress, stageLabel, type TractionTab } from "./traction-model";
import { TractionQueue } from "./traction-queue";

/**
 * Traction's first screen.
 *
 * The top half says what to do — the goal and today's queue — and only then
 * what happened. It is not an analytics dashboard: every number on it is a
 * behaviour that leads to a customer conversation, with the target beside it.
 */
export function TractionOverviewTab({ data, onTab }: { data: TractionData; onTab: (tab: TractionTab) => void }) {
  const progress = queueProgress(data);

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <Goal data={data} />
        <ReviewNudge data={data} onOpen={() => onTab("review")} />
        <TractionMailSuggestions data={data} />

        <PaperSection
          label="Today"
          count={data.queue.length}
          action={
            progress.total > 0 ? (
              <span className="text-[12.5px] font-medium tracking-[0.04em] text-paper-sage uppercase tabular-nums" aria-live="polite">
                {progress.done} / {progress.total} complete
              </span>
            ) : null
          }
        >
          <TractionQueue data={data} />
        </PaperSection>

        <NeedsAttention data={data} />
      </div>

      <div className="min-w-0 space-y-12">
        <ThisWeek data={data} />
        <MoneySummary data={data} onOpen={() => onTab("crm")} />
        <WaitingSummary data={data} onOpen={() => onTab("waiting")} />
        <PipelineSummary data={data} onOpen={() => onTab("pipeline")} />
        <TractionIcpCard icp={data.icp} />
        <ActiveExperiments data={data} onOpen={() => onTab("experiments")} />
      </div>
    </div>
  );
}

/** The one number the whole module is for. */
function Goal({ data }: { data: TractionData }) {
  const target = data.targets.conversations;
  const done = data.week.conversations;

  return (
    <PaperCard className="bg-paper-cream p-5">
      <p className="text-[12px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Goal this week</p>
      <p className="mt-2 font-paper-display text-[22px] leading-7 font-bold tracking-[-0.01em] text-paper-moss">
        {target} new qualified {target === 1 ? "conversation" : "conversations"}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Meter value={target > 0 ? done / target : undefined} label="Conversations this week against the goal" tone={done >= target ? "green" : "amber"} size="md" />
        <span className="shrink-0 text-[13px] font-medium text-paper-char tabular-nums">
          {done} / {target}
        </span>
      </div>
    </PaperCard>
  );
}

function NeedsAttention({ data }: { data: TractionData }) {
  // The good day is the expected state: no section at all, not an empty one.
  if (data.attention.length === 0) return null;

  return (
    <PaperSection label="Needs attention">
      <ul className="space-y-2">
        {data.attention.map((flag) => (
          <li key={flag.kind} className="flex items-start gap-2.5 text-[14px] leading-6 text-paper-moss">
            <AlertTriangle className="mt-1 size-4 shrink-0 text-paper-amber-deep" aria-hidden="true" />
            <span>{flag.message}</span>
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}

const TARGET_ROWS: readonly { key: keyof WeeklyTargets; label: string; actual: (data: TractionData) => number }[] = [
  { key: "newProspects", label: "New prospects", actual: (data) => data.week.newProspects },
  { key: "outreach", label: "Personal outreach", actual: (data) => data.week.outreach },
  { key: "followUps", label: "Follow-ups", actual: (data) => data.week.followUps },
  { key: "conversations", label: "Conversations", actual: (data) => data.week.conversations },
  { key: "proposals", label: "Proposals", actual: (data) => data.week.proposals },
];

/** The weekly commitment. Behaviours that move toward revenue; no vanity metrics. */
function ThisWeek({ data }: { data: TractionData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WeeklyTargets>(data.targets);
  const save = useSaveTargets();

  const weekOf = new Date(`${data.week.weekOf}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <PaperSection
      label="This week"
      action={
        editing ? null : (
          <PaperButton
            onClick={() => {
              setDraft(data.targets);
              setEditing(true);
            }}
          >
            Edit targets
          </PaperButton>
        )
      }
    >
      <p className="-mt-2 mb-4 text-[12.5px] text-paper-sage">From Monday {weekOf}</p>

      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft, { onSuccess: () => setEditing(false) });
          }}
        >
          {TARGET_ROWS.map((row) => (
            <label key={row.key} className="flex items-center justify-between gap-3">
              <span className="text-[14px] text-paper-char">{row.label}</span>
              <input
                type="number"
                min={0}
                max={1000}
                inputMode="numeric"
                className={cn(PAPER_INPUT, "w-24 text-right tabular-nums")}
                value={draft[row.key]}
                onChange={(event) => setDraft({ ...draft, [row.key]: Math.max(0, Number(event.target.value) || 0) })}
              />
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <PaperButton type="submit" variant="amber" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save targets"}
            </PaperButton>
            <PaperButton onClick={() => setEditing(false)}>Cancel</PaperButton>
          </div>
          {save.error ? <p role="alert" className="text-[13px] text-paper-flame-deep">{save.error.message}</p> : null}
        </form>
      ) : (
        <ul className="space-y-3.5">
          {TARGET_ROWS.map((row) => {
            const actual = row.actual(data);
            const target = data.targets[row.key];
            return (
              <li key={row.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="text-paper-char">{row.label}</span>
                  <span className="font-medium text-paper-moss tabular-nums">
                    {actual} <span className="text-paper-ash">/ {target}</span>
                  </span>
                </div>
                <Meter value={target > 0 ? actual / target : undefined} label={`${row.label}: ${actual} of ${target}`} tone={actual >= target && target > 0 ? "green" : "ink"} />
              </li>
            );
          })}
        </ul>
      )}
    </PaperSection>
  );
}

function PipelineSummary({ data, onOpen }: { data: TractionData; onOpen: () => void }) {
  return (
    <PaperSection
      label="Pipeline"
      action={
        <PaperButton onClick={onOpen} aria-label="Open the pipeline">
          Open
        </PaperButton>
      }
    >
      <dl className="divide-y divide-paper-stone border-y border-paper-mist">
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage} className="flex items-baseline justify-between py-2 text-[14px]">
            <dt className="text-paper-char">{stageLabel(stage)}</dt>
            <dd className="font-paper-display font-bold text-paper-moss tabular-nums">{data.pipeline[stage]}</dd>
          </div>
        ))}
      </dl>
      {data.provider !== "local" ? <p className="mt-2 text-[12px] text-paper-sage">Read from {data.provider}</p> : null}
    </PaperSection>
  );
}

function ActiveExperiments({ data, onOpen }: { data: TractionData; onOpen: () => void }) {
  const shown = data.experiments.filter((experiment) => experiment.status !== "concluded");

  return (
    <PaperSection
      label="Active experiments"
      action={
        <PaperButton onClick={onOpen} aria-label="Open experiments">
          {shown.length === 0 ? "Plan one" : "Open"}
        </PaperButton>
      }
    >
      {shown.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">
          No channel under test. Pick one channel, one hypothesis, two weeks — not nineteen at once.
        </p>
      ) : (
        <ul className="divide-y divide-paper-stone border-y border-paper-mist">
          {shown.map((experiment) => (
            <li key={experiment.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-paper-moss">{experiment.name}</span>
                <span className="text-[12.5px] text-paper-sage">{CHANNEL_LABELS[experiment.channel]}</span>
              </span>
              <Tag tone={experiment.status === "running" ? "green" : "muted"}>{experiment.status === "running" ? "Running" : "Planned"}</Tag>
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

/** Friday to Sunday: the week is nearly done, so its review is worth ten minutes. */
function ReviewNudge({ data, onOpen }: { data: TractionData; onOpen: () => void }) {
  const [year, month, day] = data.today.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  if (weekday !== 5 && weekday !== 6 && weekday !== 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-paper-gold px-4 py-3">
      <p className="text-[14px] text-paper-moss">
        <span className="font-semibold">Weekly review.</span> {data.week.conversations} of {data.targets.conversations} conversations this week — look at what
        worked before Monday.
      </p>
      <PaperButton variant="ghost" onClick={onOpen}>
        Open review
      </PaperButton>
    </div>
  );
}

/** What others owe, soonest chase first. The whole list lives in its own tab. */
function WaitingSummary({ data, onOpen }: { data: TractionData; onOpen: () => void }) {
  const shown = data.waiting.slice(0, 4);

  return (
    <PaperSection
      label="Waiting on"
      count={data.waiting.length || undefined}
      action={<PaperButton onClick={onOpen}>{data.waiting.length === 0 ? "Add" : "Open"}</PaperButton>}
    >
      {shown.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">Nothing outstanding. Deposits, feedback and replies you are waiting for go here.</p>
      ) : (
        <ul className="divide-y divide-paper-stone border-y border-paper-mist">
          {shown.map((item) => {
            const chase = chaseDate(item);
            return (
              <li key={item.id} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-paper-moss">{item.who}</span>
                  <span className="block truncate text-[12.5px] text-paper-sage">{item.what}</span>
                </span>
                <span className={chase <= data.today ? "shrink-0 text-[12.5px] font-semibold text-paper-amber-deep" : "shrink-0 text-[12.5px] text-paper-sage"}>
                  {chase <= data.today ? "Chase today" : `Chase ${formatShortDate(chase)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </PaperSection>
  );
}

/** Three lines from Virtec — enough to know whether money needs chasing. The rest is one click away. */
function MoneySummary({ data, onOpen }: { data: TractionData; onOpen: () => void }) {
  const revenue = data.crm.revenue;
  if (!data.crm.configured || !revenue) return null;

  const rows = [
    { label: "Monthly recurring", value: formatRand(revenue.monthlyRecurringRevenue) },
    { label: "Pending quotes", value: formatRand(revenue.pendingQuoteValue) },
    { label: "Overdue invoices", value: revenue.overdueInvoiceCount?.toString(), loud: (revenue.overdueInvoiceCount ?? 0) > 0 },
  ];

  return (
    <PaperSection label="Money" action={<PaperButton onClick={onOpen}>Virtec</PaperButton>}>
      <dl className="divide-y divide-paper-stone border-y border-paper-mist">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between py-2 text-[14px]">
            <dt className="text-paper-char">{row.label}</dt>
            <dd className={row.loud ? "font-paper-display font-bold text-paper-flame-deep tabular-nums" : "font-paper-display font-bold text-paper-moss tabular-nums"}>
              {row.value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
    </PaperSection>
  );
}
