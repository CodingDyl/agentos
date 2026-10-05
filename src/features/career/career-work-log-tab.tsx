import { useState } from "react";
import type { CareerData, WorkLogWeek } from "@shared/career-types";
import { PAPER_INPUT, PaperButton, PaperCard, PaperSection } from "@/components/paper";
import { useAddWorkLog, useDeleteWorkLog } from "@/lib/agentos/career";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, MemoryProposalButton } from "./career-kit";
import { formatDay, localToday, toLines, TEXTAREA } from "./career-model";

/**
 * Quick daily capture, then the same lines a week at a time — the material
 * for weekly summaries, reviews, CV achievements and promotion conversations.
 * A learning becomes memory only when proposed and saved by a person.
 */
export function CareerWorkLogTab({ data }: { data: CareerData }) {
  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <CaptureForm defaultClient={data.workLog[0]?.client ?? data.currentWork.project} />
        <PaperSection label="Entries" count={data.workLog.length}>
          {data.workLog.length === 0 ? (
            <p className="text-[15px] text-paper-char">Nothing logged yet.</p>
          ) : (
            <ul className="space-y-4">
              {data.workLog.slice(0, 30).map((entry) => (
                <li key={entry.id}>
                  <PaperCard>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">
                        {formatDay(entry.date)}
                        {entry.client ? <span className="ml-2 text-[13px] font-normal text-paper-sage">{entry.client}</span> : null}
                      </p>
                      <DeleteEntry id={entry.id} />
                    </div>
                    <LogLines label="Worked on" lines={entry.workedOn} />
                    <LogLines label="Learned" lines={entry.learned} />
                    <LogLines label="Blocked by" lines={entry.blockedBy} />
                    {entry.learned.length > 0 ? (
                      <div className="mt-2">
                        <MemoryProposalButton
                          defaultKind="lesson"
                          defaultTitle={entry.learned[0]}
                          defaultBody={entry.learned.map((line) => `- ${line}`).join("\n")}
                          source={`worklog:${entry.id}`}
                        />
                      </div>
                    ) : null}
                  </PaperCard>
                </li>
              ))}
            </ul>
          )}
        </PaperSection>
      </div>

      <PaperSection label="Weekly summaries">
        {data.weeks.length === 0 ? (
          <p className="text-[15px] text-paper-char">Weeks appear here as you log.</p>
        ) : (
          <ul className="space-y-6">
            {data.weeks.map((week) => (
              <WeekSummary key={week.weekStart} week={week} />
            ))}
          </ul>
        )}
      </PaperSection>
    </div>
  );
}

function LogLines({ label, lines }: { label: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[12px] font-medium tracking-[0.08em] text-paper-sage uppercase">{label}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[14.5px] leading-6 text-paper-char">
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function CaptureForm({ defaultClient }: { defaultClient: string }) {
  const [date, setDate] = useState(localToday());
  const [client, setClient] = useState(defaultClient);
  const [workedOn, setWorkedOn] = useState("");
  const [learned, setLearned] = useState("");
  const [blocked, setBlocked] = useState("");
  const add = useAddWorkLog();

  return (
    <PaperSection label="Today I worked on">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate(
            { date, client: client.trim() || undefined, workedOn: toLines(workedOn), learned: toLines(learned), blockedBy: toLines(blocked) },
            {
              onSuccess: () => {
                setWorkedOn("");
                setLearned("");
                setBlocked("");
              },
            },
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Date">
            <input type="date" required className={cn(PAPER_INPUT, "w-full")} value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Client / project">
            <input className={cn(PAPER_INPUT, "w-full")} value={client} maxLength={80} placeholder="Standard Bank" onChange={(event) => setClient(event.target.value)} />
          </Field>
        </div>
        <Field label="Worked on (one per line)">
          <textarea className={TEXTAREA} value={workedOn} placeholder={"Implemented X\nInvestigated Y"} onChange={(event) => setWorkedOn(event.target.value)} />
        </Field>
        <Field label="Learned">
          <textarea className={cn(TEXTAREA, "min-h-16")} value={learned} onChange={(event) => setLearned(event.target.value)} />
        </Field>
        <Field label="Blocked by">
          <textarea className={cn(TEXTAREA, "min-h-16")} value={blocked} onChange={(event) => setBlocked(event.target.value)} />
        </Field>
        <PaperButton type="submit" variant="amber" disabled={add.isPending || !(workedOn.trim() || learned.trim() || blocked.trim())}>
          {add.isPending ? "Saving…" : "Log it"}
        </PaperButton>
        <ErrorLine error={add.error} />
      </form>
    </PaperSection>
  );
}

function DeleteEntry({ id }: { id: string }) {
  const remove = useDeleteWorkLog();
  return (
    <PaperButton
      aria-label="Delete entry"
      disabled={remove.isPending}
      onClick={() => {
        if (window.confirm("Delete this work log entry?")) remove.mutate(id);
      }}
    >
      Delete
    </PaperButton>
  );
}

function weekText(week: WorkLogWeek): string {
  const section = (title: string, lines: string[]) => (lines.length ? `${title}\n${lines.map((line) => `- ${line}`).join("\n")}` : "");
  return [
    `Week of ${week.weekStart}${week.clients.length ? ` (${week.clients.join(", ")})` : ""}`,
    section("Worked on", week.workedOn),
    section("Learned", week.learned),
    section("Blocked by", week.blockedBy),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function WeekSummary({ week }: { week: WorkLogWeek }) {
  const [copied, setCopied] = useState(false);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">
          Week of {formatDay(week.weekStart)}
          <span className="ml-2 text-[12.5px] font-normal text-paper-sage">
            {week.days} {week.days === 1 ? "day" : "days"}
            {week.clients.length ? ` · ${week.clients.join(", ")}` : ""}
          </span>
        </p>
        <PaperButton
          onClick={() =>
            void navigator.clipboard?.writeText(weekText(week)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </PaperButton>
      </div>
      <p className="mt-1 text-[14px] leading-6 text-paper-char">
        {week.workedOn.length} done · {week.learned.length} learned · {week.blockedBy.length} blockers
      </p>
    </li>
  );
}
