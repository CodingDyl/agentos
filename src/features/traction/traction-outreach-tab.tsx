import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CASE_STAGE_LABEL, caseStage, type CaseStage, type OutreachCase } from "@shared/outreach-case";
import { playById, PLAYS, type OutreachStats, type Rate, type SentEmail } from "@shared/outreach-plays";
import type { Prospect, TractionData } from "@shared/traction-types";
import { Meter, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperEmpty, PaperError, PaperPagination, PaperSection, SegmentedControl, Tag } from "@/components/paper";
import { useOutreachStats } from "@/lib/agentos/outreach";
import { useOutreachCases } from "@/lib/agentos/outreach-cases";
import { cn } from "@/lib/utils";
import { formatShortDate } from "./traction-model";
import { OutreachCaseView } from "./traction-outreach-case";
import { usePagination } from "@/lib/use-pagination";

/**
 * Outreach: pick a business, get to know it, decide the offer, send one
 * email. Results (what was sent, who replied, what works) sit behind the
 * second switch, so the first screen is only about the next email.
 */

type View = "write" | "results";
type ListFilter = "to_email" | "emailed" | "all";

const OPEN = new Set(["target", "contacted", "conversation", "proposal"]);

export function TractionOutreachTab({
  data,
  prospectId,
  onCompose,
  onOpenProspect,
}: {
  data: TractionData;
  prospectId: string | undefined;
  onCompose: (prospectId: string | undefined) => void;
  onOpenProspect: (prospectId: string) => void;
}) {
  const [view, setView] = useState<View>("write");
  const stats = useOutreachStats();
  const cases = useOutreachCases();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<View>
          label="Outreach view"
          value={view}
          onChange={setView}
          options={[
            { value: "write", label: "Write emails" },
            { value: "results", label: `Results${stats.data ? ` · ${stats.data.sent.all} sent` : ""}` },
          ]}
        />
        {stats.data && stats.data.followUpsDue.length > 0 ? (
          <button type="button" onClick={() => setView("results")} className={cn("cursor-pointer text-[13px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
            {stats.data.followUpsDue.length} follow-up{stats.data.followUpsDue.length === 1 ? "" : "s"} due
          </button>
        ) : null}
      </div>

      {stats.error ? <PaperError title="Outreach results could not be read." detail={stats.error.message} headingLevel="h2" isRetrying={stats.isFetching} onRetry={() => void stats.refetch()} /> : null}
      {cases.error ? <PaperError title="Outreach cases could not be read." detail={cases.error.message} headingLevel="h2" isRetrying={cases.isFetching} onRetry={() => void cases.refetch()} /> : null}

      {view === "write" ? (
        <WriteView data={data} cases={cases.data ?? {}} stats={stats.data} prospectId={prospectId} onSelect={onCompose} />
      ) : stats.data ? (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-10">
            <Headline stats={stats.data} />
            <FollowUps
              stats={stats.data}
              onWrite={(id) => {
                onCompose(id);
                setView("write");
              }}
            />
            <SentList emails={stats.data.sentEmails} onOpen={onOpenProspect} />
          </div>
          <div className="min-w-0 space-y-10">
            <WhatWorks stats={stats.data} />
            <FieldRules />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WriteView({
  data,
  cases,
  stats,
  prospectId,
  onSelect,
}: {
  data: TractionData;
  cases: Record<string, OutreachCase>;
  stats: OutreachStats | undefined;
  prospectId: string | undefined;
  onSelect: (prospectId: string | undefined) => void;
}) {
  const [filter, setFilter] = useState<ListFilter>("to_email");
  const [search, setSearch] = useState("");

  const stageOf = useMemo(() => {
    const sent = new Set(stats?.sentEmails.filter((email) => email.status !== "draft").map((email) => email.prospectId));
    const replied = new Set(stats?.sentEmails.filter((email) => email.status === "replied").map((email) => email.prospectId));
    return (prospect: Prospect): CaseStage => caseStage(cases[prospect.id], sent.has(prospect.id), replied.has(prospect.id));
  }, [cases, stats]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.prospects
      .filter((prospect) => OPEN.has(prospect.stage))
      .filter((prospect) => {
        const stage = stageOf(prospect);
        if (filter === "to_email") return stage !== "sent" && stage !== "replied";
        if (filter === "emailed") return stage === "sent" || stage === "replied";
        return true;
      })
      .filter((prospect) => !term || `${prospect.company} ${prospect.segment ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => FIT_ORDER[a.fit ?? "none"] - FIT_ORDER[b.fit ?? "none"] || a.company.localeCompare(b.company));
  }, [data.prospects, filter, search, stageOf]);
  const pager = usePagination(rows, `${filter}|${search}`, 10);

  const selected = data.prospects.find((prospect) => prospect.id === prospectId);
  const entry = selected ? (cases[selected.id] ?? blankCase(selected.id)) : undefined;

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <nav aria-label="Businesses" className="min-w-0">
        <div className="space-y-2">
          <SegmentedControl<ListFilter>
            label="Which businesses"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "to_email", label: "To email" },
              { value: "emailed", label: "Emailed" },
              { value: "all", label: "All" },
            ]}
          />
          <label className="relative block">
            <span className="sr-only">Search businesses</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper-sage" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className={cn(PAPER_INPUT, "w-full pl-8")} />
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="mt-4 text-[13px] text-paper-sage">{filter === "emailed" ? "Nobody emailed yet." : "No businesses here. Profile some in the Virtec tab."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-paper-mist border-y border-paper-mist">
            {pager.pageItems.map((prospect) => {
              const stage = stageOf(prospect);
              const active = prospect.id === prospectId;
              return (
                <li key={prospect.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(prospect.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-start justify-between gap-2 px-2 py-2.5 text-left transition-colors duration-150",
                      active ? "bg-paper-white" : "hover:bg-paper-linen",
                      PAPER_FOCUS,
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn("block truncate text-[14px] text-paper-moss", active && "font-semibold")}>{prospect.company}</span>
                      <span className="block truncate text-[12.5px] text-paper-sage">{CASE_STAGE_LABEL[stage]}{prospect.segment ? ` · ${prospect.segment}` : ""}</span>
                    </span>
                    {prospect.fit ? <Tag tone={prospect.fit === "high" ? "green" : prospect.fit === "medium" ? "marigold" : "muted"}>{prospect.fit}</Tag> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <PaperPagination pager={pager} label="Business pages" />
      </nav>

      <div className="min-w-0">
        {selected && entry ? (
          <OutreachCaseView key={selected.id} prospect={selected} entry={entry} />
        ) : (
          <PaperCard className="bg-paper-cream p-6">
            <p className="font-paper-display text-[18px] font-bold text-paper-moss">Choose a business to start.</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-6 text-paper-char">
              <li>Get to know them: Hermes reads their website and briefs you.</li>
              <li>Decide: build their site first and charge monthly, or pitch a custom build.</li>
              <li>Write the email: choose the company it is from, let Hermes draft it, edit, review, send.</li>
            </ol>
          </PaperCard>
        )}
      </div>
    </div>
  );
}

const FIT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

function blankCase(prospectId: string): OutreachCase {
  return {
    prospectId,
    about: "",
    findings: [],
    howWeHelp: "",
    hook: "",
    pathReason: "",
    framing: [],
    offer: "",
    previewUrl: "",
    monthlyPrice: "",
    setupPrice: "",
    projectPrice: "",
    senderId: "",
    notes: "",
    filledBy: {},
    updatedAt: "",
  };
}

const percent = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value * 100)}%`);

function Headline({ stats }: { stats: OutreachStats }) {
  const rate = stats.overall;
  return (
    <section aria-label="Results">
      <dl className="grid grid-cols-2 gap-px bg-paper-mist sm:grid-cols-4">
        <Figure label="Sent" value={String(stats.sent.all)} note={`${stats.sent.last7} this week · ${stats.sent.last30} in 30 days`} />
        <Figure label="Reply rate" value={percent(rate.replyRate)} note={`${rate.replied} of ${rate.contacted} people replied`} />
        <Figure label="Conversations" value={String(rate.positive)} note="Moved on to a conversation, proposal or win" />
        <Figure
          label="First reply"
          value={stats.medianReplyDays === undefined ? "–" : `${stats.medianReplyDays}d`}
          note={stats.medianReplyDays === undefined ? "No replies yet" : "Median days to a reply"}
        />
      </dl>
      {rate.bounced + rate.optedOut > 0 ? (
        <p className="mt-2 text-[12.5px] text-paper-sage">
          {rate.bounced} bounced · {rate.optedOut} asked not to be contacted. Both are on the do-not-contact list.
        </p>
      ) : null}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-paper-cream px-4 py-4">
      <dt className="text-[12px] font-semibold tracking-[0.08em] text-paper-sage uppercase">{label}</dt>
      <dd className="mt-1 font-paper-display text-[28px] leading-8 font-bold tracking-[-0.02em] text-paper-moss tabular-nums">{value}</dd>
      <dd className="mt-1 text-[12.5px] leading-5 text-paper-char">{note}</dd>
    </div>
  );
}

function FollowUps({ stats, onWrite }: { stats: OutreachStats; onWrite: (prospectId: string) => void }) {
  const pager = usePagination(stats.followUpsDue, "", 10);
  return (
    <PaperSection label="Follow-ups due" count={stats.followUpsDue.length}>
      {stats.followUpsDue.length === 0 ? (
        <p className="text-[13.5px] leading-6 text-paper-sage">
          Nothing due. Most replies come to the second or third email, so each unanswered email gets a follow-up after 3 days, then one more after 4.
        </p>
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((due) => (
            <li key={due.prospectId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block font-semibold text-paper-moss">{due.company}</span>
                <span className="block text-[12.5px] text-paper-sage">
                  {due.touch === 2 ? "First follow-up" : "Last follow-up"} · last emailed {formatShortDate(due.lastAt)}
                </span>
              </span>
              <PaperButton variant="ghost" onClick={() => onWrite(due.prospectId)}>
                Write follow-up
              </PaperButton>
            </li>
          ))}
        </ul>
      )}
      <PaperPagination pager={pager} label="Follow-up pages" />
    </PaperSection>
  );
}

const STATUS: Record<SentEmail["status"], { label: string; tone: "green" | "muted" | "flame" | "blue" | "marigold" }> = {
  replied: { label: "Replied", tone: "green" },
  awaiting: { label: "No reply yet", tone: "muted" },
  bounced: { label: "Bounced", tone: "flame" },
  opted_out: { label: "Opted out", tone: "flame" },
  draft: { label: "Gmail draft", tone: "blue" },
};

function SentList({ emails, onOpen }: { emails: SentEmail[]; onOpen: (prospectId: string) => void }) {
  const pager = usePagination(emails);
  return (
    <PaperSection label="Emails" count={emails.length}>
      {emails.length === 0 ? (
        <PaperEmpty description="Nothing sent yet. Emails sent or saved as Gmail drafts from AgentOS show here, with whether they were answered." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-paper-moss text-[12px] tracking-[0.06em] text-paper-sage uppercase">
                <th scope="col" className="py-2 pr-3 font-semibold">Sent</th>
                <th scope="col" className="py-2 pr-3 font-semibold">To</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Play</th>
                <th scope="col" className="py-2 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((email) => (
                <tr key={email.id} className="border-b border-paper-mist align-top">
                  <td className="py-2.5 pr-3 whitespace-nowrap text-paper-char tabular-nums">{formatShortDate(email.at)}</td>
                  <td className="py-2.5 pr-3">
                    <button type="button" onClick={() => onOpen(email.prospectId)} className={cn("cursor-pointer text-left font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
                      {email.company}
                    </button>
                    <span className="block max-w-[38ch] truncate text-[12.5px] text-paper-sage" title={email.subject}>
                      {email.touch > 1 ? `Follow-up ${email.touch - 1} · ` : ""}
                      {email.subject}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-paper-char">{email.play ? playById(email.play).name : "Written by hand"}</td>
                  <td className="py-2.5">
                    <Tag tone={STATUS[email.status].tone}>{STATUS[email.status].label}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaperPagination pager={pager} label="Sent email pages" />
    </PaperSection>
  );
}

/** Below this many people, a rate is shown but called early. */
const EARLY = 20;

function WhatWorks({ stats }: { stats: OutreachStats }) {
  const rows = PLAYS.map((play) => ({ name: play.name, rate: stats.byPlay.find((row) => row.play === play.id) })).filter(
    (row): row is { name: string; rate: Rate & { play: string } } => Boolean(row.rate),
  );
  const unlabelled = stats.byPlay.find((row) => row.play === "unlabelled");

  return (
    <PaperSection label="What works">
      {rows.length === 0 && !unlabelled ? (
        <p className="text-[13.5px] leading-6 text-paper-sage">
          Reply rates per play appear here once emails are sent from the composer. Compare plays after about {EARLY} emails each; before that, a single reply swings the rate.
        </p>
      ) : (
        <ul className="space-y-4">
          {[...rows, ...(unlabelled ? [{ name: "Written by hand", rate: unlabelled }] : [])].map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className="font-semibold text-paper-moss">{row.name}</span>
                <span className="text-paper-char tabular-nums">
                  {percent(row.rate.replyRate)} · {row.rate.replied}/{row.rate.contacted}
                </span>
              </div>
              <div className="mt-1.5">
                <Meter value={row.rate.replyRate} label={`${row.name} reply rate`} tone={row.rate.replyRate !== undefined && row.rate.replyRate >= 0.1 ? "green" : "ink"} />
              </div>
              {row.rate.contacted < EARLY ? <p className="mt-1 text-[12px] text-paper-sage">Early: {row.rate.contacted} sent so far.</p> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[12px] leading-5 text-paper-sage">
        A rough guide: cold email to small businesses commonly gets low single-digit reply rates; specific, personal emails like these should beat that.
      </p>
    </PaperSection>
  );
}

function FieldRules() {
  const rules = [
    ["Lead with them", "The first line is the thing you noticed, not who you are."],
    ["Short", "Under 125 words. It is read on a phone between customers."],
    ["One ask", "End with one easy question. Ask for interest, not a meeting."],
    ["Show, don't pitch", "For tiny businesses, a built preview beats any description of one."],
    ["Follow up twice", "Most replies come to the second or third email. Then stop."],
    ["Protect the mailbox", "Plain text, few links, 10 a day while it is new."],
  ];
  return (
    <PaperCard className="bg-paper-cream p-5">
      <p className="text-[12px] font-semibold tracking-[0.08em] text-paper-sage uppercase">How cold email gets answered</p>
      <dl className="mt-3 space-y-2.5">
        {rules.map(([title, line]) => (
          <div key={title}>
            <dt className="text-[13.5px] font-semibold text-paper-moss">{title}</dt>
            <dd className="text-[13px] leading-5 text-paper-char">{line}</dd>
          </div>
        ))}
      </dl>
    </PaperCard>
  );
}
