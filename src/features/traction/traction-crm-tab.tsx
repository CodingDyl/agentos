import { Check, Download, Mail, PenLine, Phone, RefreshCw, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { daysBetween, isoDate } from "@shared/traction-dates";
import type { CrmView, TractionData } from "@shared/traction-types";
import { formatRand, inboundOrigin, type VirtecSource } from "@shared/virtec-types";
import { FieldLabel, Meter, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperPagination, PaperSection, SegmentedControl, Tag } from "@/components/paper";
import { useImportCrm, useLeadNotAFit, useProfileLeads, useRefreshCrm, useScanCandidates, useScanInfo, useSetCrmFollowUp, useSetInboundLead } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { crmFollowUpPrompt, formatShortDate, hermesHref, inboundReplyPrompt, mailtoHref, prospectHref } from "./traction-model";
import { usePagination } from "@/lib/use-pagination";

/**
 * Virtec, read live.
 *
 * What the CRM knows about money, clients and the leads our websites catch,
 * shown next to the acquisition work rather than instead of it. The actions
 * are the ones AgentOS owns (draft with Hermes, import into Traction), plus a
 * few status changes written back to Virtec when write-back is on.
 */

const SOURCE_LABELS: Record<VirtecSource, string> = {
  leads: "Leads",
  inbound: "Website leads",
  clients: "Clients",
  quotes: "Quotes",
  projects: "Projects",
  followUps: "Follow-ups",
  revenue: "Revenue",
};

export function TractionCrmTab({ data }: { data: TractionData }) {
  const crm = data.crm;

  if (!crm.configured) return <SetupNote problem={crm.problem} />;

  if (crm.pending) {
    return (
      <p className="text-[14px] leading-6 text-paper-char" aria-live="polite">
        Reading Virtec… The first read can take a few seconds; this screen fills in on its own.
      </p>
    );
  }

  return (
    <div className="space-y-12">
      <Status crm={crm} />
      <WebsiteLeads crm={crm} />
      <Money crm={crm} />
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        <FollowUps crm={crm} today={data.today} />
        <Quotes crm={crm} today={data.today} />
      </div>
      <Projects crm={crm} />
      <Leads crm={crm} icpName={data.icp?.name} />
      <Clients crm={crm} />
    </div>
  );
}

function SetupNote({ problem }: { problem?: string }) {
  return (
    <PaperCard className="max-w-2xl bg-paper-cream p-5">
      <h2 className="font-paper-display text-[17px] font-bold text-paper-moss">Connect Virtec</h2>
      <p className="mt-2 text-[14px] leading-6 text-paper-char">
        {problem ?? "Virtec is not configured."} Add these to AgentOS's <code className="rounded-[2px] bg-paper-stone px-1">.env</code> and restart the
        server:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-none bg-paper-stone px-3 py-2 text-[13px] text-paper-moss">
        {"VIRTEC_BASE_URL=https://your-virtec-deployment\nVIRTEC_API_KEY=<the value Virtec holds as AGENTOS_API_KEY>"}
      </pre>
      <p className="mt-3 text-[13px] leading-5 text-paper-sage">
        The key stays on the AgentOS server. It is never sent to the browser, and AgentOS only ever makes GET requests to Virtec.
      </p>
    </PaperCard>
  );
}

function Status({ crm }: { crm: CrmView }) {
  const refresh = useRefreshCrm();
  const failed = Object.entries(crm.sources ?? {}).filter(([, status]) => !status.ok) as [VirtecSource, { error?: string }][];
  const skipped = Object.values(crm.sources ?? {}).reduce((sum, status) => sum + (status.skipped ?? 0), 0);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="text-[13px] leading-5 text-paper-sage" aria-live="polite">
        <p>
          Read from Virtec{crm.fetchedAt ? ` at ${new Date(crm.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}. Refreshed at
          most every five minutes.{" "}
          {crm.writable
            ? "Write-back is on: follow-ups done here are marked in Virtec, and imported leads move to reviewing."
            : "Read-only. Set VIRTEC_WRITE_API_KEY to write follow-ups and lead statuses back."}
        </p>
        {failed.length > 0 ? (
          <p className="mt-1 text-paper-flame-deep">
            {failed.map(([source, status]) => `${SOURCE_LABELS[source]}: ${status.error ?? "unavailable"}`).join(" · ")}
          </p>
        ) : null}
        {skipped > 0 ? <p className="mt-1">{skipped} Virtec {skipped === 1 ? "record" : "records"} could not be read and were skipped.</p> : null}
      </div>
      <PaperButton variant="ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
        <RefreshCw className={cn("size-3.5", refresh.isPending && "motion-safe:animate-spin")} aria-hidden="true" />
        {refresh.isPending ? "Reading…" : "Refresh"}
      </PaperButton>
      {refresh.error ? (
        <p role="alert" className="w-full text-[13px] text-paper-flame-deep">
          {refresh.error.message}
        </p>
      ) : null}
    </div>
  );
}

function Money({ crm }: { crm: CrmView }) {
  const revenue = crm.revenue;
  if (!revenue) return null;

  const figures: { label: string; value: string; loud?: boolean }[] = [
    { label: "Monthly recurring", value: formatRand(revenue.monthlyRecurringRevenue) ?? "-" },
    { label: "Pending quotes", value: formatRand(revenue.pendingQuoteValue) ?? "-" },
    { label: "Accepted this month", value: formatRand(revenue.acceptedQuoteValueThisMonth) ?? "-" },
    { label: "Quote conversion", value: revenue.quoteConversionRate === undefined ? "-" : `${Math.round(revenue.quoteConversionRate)}%` },
    { label: "Maintenance clients", value: revenue.activeMaintenanceCustomers?.toString() ?? "-" },
    {
      label: "Overdue invoices",
      value: revenue.overdueInvoiceCount?.toString() ?? "-",
      loud: (revenue.overdueInvoiceCount ?? 0) > 0,
    },
  ];

  return (
    <PaperSection label="Money">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="text-[12px] font-semibold tracking-[0.06em] text-paper-sage uppercase">{figure.label}</dt>
            <dd className={cn("mt-1 font-paper-display text-[20px] font-bold tabular-nums", figure.loud ? "text-paper-flame-deep" : "text-paper-moss")}>
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
    </PaperSection>
  );
}

function FollowUps({ crm, today }: { crm: CrmView; today: string }) {
  const setFollowUp = useSetCrmFollowUp();
  const pager = usePagination(crm.followUps, "", 10);
  return (
    <PaperSection label="Follow-ups" count={crm.followUps.length}>
      {crm.followUps.length === 0 ? (
        <Empty>Virtec has nothing open to follow up.</Empty>
      ) : (
        <ul className="divide-y divide-paper-stone border-y border-paper-mist">
          {pager.pageItems.map((followUp) => {
            const due = followUp.dueAt?.slice(0, 10);
            const overdue = due !== undefined && due < today;
            return (
              <li key={followUp.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-paper-moss">
                      {followUp.companyName ?? followUp.customerName ?? "Client"}
                      {followUp.amount !== undefined ? <span className="ml-2 text-paper-sage tabular-nums">{formatRand(followUp.amount)}</span> : null}
                    </p>
                    {followUp.reason ? <p className="text-[13px] leading-5 text-paper-char">{followUp.reason}</p> : null}
                    <p className={cn("text-[12.5px]", overdue ? "font-semibold text-paper-amber-deep" : "text-paper-sage")}>
                      {due ? `${overdue ? "Was due" : "Due"} ${formatShortDate(due)}` : "No due date"}
                      {followUp.type ? ` · ${followUp.type.replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Link
                      to={hermesHref(crmFollowUpPrompt(followUp))}
                      className={cn(
                        "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-none px-3 text-[13.5px] font-semibold text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
                        PAPER_FOCUS,
                      )}
                      aria-label={`Draft a follow-up to ${followUp.companyName ?? followUp.customerName ?? "this client"}`}
                    >
                      <PenLine className="size-3.5" aria-hidden="true" />
                      Draft
                    </Link>
                    {crm.writable ? (
                      <>
                        <PaperButton
                          variant="ghost"
                          disabled={setFollowUp.isPending && setFollowUp.variables?.followUpId === followUp.id}
                          onClick={() => setFollowUp.mutate({ followUpId: followUp.id, status: "sent" })}
                          aria-label={`Mark the follow-up to ${followUp.companyName ?? followUp.customerName ?? "this client"} sent in Virtec`}
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          Sent
                        </PaperButton>
                        <PaperButton
                          disabled={setFollowUp.isPending && setFollowUp.variables?.followUpId === followUp.id}
                          onClick={() => setFollowUp.mutate({ followUpId: followUp.id, status: "dismissed" })}
                          aria-label={`Dismiss the follow-up to ${followUp.companyName ?? followUp.customerName ?? "this client"} in Virtec`}
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </PaperButton>
                      </>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PaperPagination pager={pager} label="Follow-up pages" />
      {crm.writable ? null : <p className="mt-2 text-[12px] text-paper-sage">Mark follow-ups as sent in Virtec; write-back is off.</p>}
      {setFollowUp.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {setFollowUp.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}

function Quotes({ crm, today }: { crm: CrmView; today: string }) {
  const pager = usePagination(crm.quotes, "", 10);
  return (
    <PaperSection label="Pending quotes" count={crm.quotes.length}>
      {crm.quotes.length === 0 ? (
        <Empty>No quotes waiting on an answer.</Empty>
      ) : (
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-paper-mist text-[12px] tracking-[0.06em] text-paper-sage uppercase">
              <th scope="col" className="py-2 text-left font-semibold">Client</th>
              <th scope="col" className="py-2 text-right font-semibold">Amount</th>
              <th scope="col" className="py-2 text-right font-semibold">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {pager.pageItems.map((quote) => {
              const age = quote.createdAt ? daysBetween(quote.createdAt, today) : undefined;
              return (
                <tr key={quote.id} className="border-b border-paper-stone">
                  <th scope="row" className="py-2 text-left font-normal text-paper-moss">
                    {quote.clientName ?? "Unknown client"}
                    {quote.projectType ? <span className="block text-[12px] text-paper-sage">{quote.projectType}</span> : null}
                  </th>
                  <td className="py-2 text-right tabular-nums">{formatRand(quote.totalAmount) ?? "-"}</td>
                  <td className={cn("py-2 text-right tabular-nums", age !== undefined && age >= 7 ? "font-semibold text-paper-amber-deep" : "text-paper-char")}>
                    {age === undefined ? "-" : `${age}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <PaperPagination pager={pager} label="Pending quote pages" />
    </PaperSection>
  );
}

function Projects({ crm }: { crm: CrmView }) {
  const pager = usePagination(crm.projects, "", 10);
  if (crm.projects.length === 0) return null;

  return (
    <PaperSection label="Active projects" count={crm.projects.length}>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pager.pageItems.map((project) => (
          <li key={project.id}>
            <PaperCard className="h-full">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[14px] font-medium text-paper-moss">{project.clientName ?? "Client"}</p>
                {project.agreementStatus && project.agreementStatus !== "signed" ? <Tag tone="marigold">Agreement {project.agreementStatus}</Tag> : null}
              </div>
              <p className="text-[12.5px] text-paper-sage">
                {[project.projectType, formatRand(project.amount), project.status].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Meter value={project.completion === undefined ? undefined : project.completion / 100} label={`${project.clientName ?? "Project"} completion`} />
                <span className="shrink-0 text-[12.5px] text-paper-char tabular-nums">{project.completion === undefined ? "-" : `${Math.round(project.completion)}%`}</span>
              </div>
            </PaperCard>
          </li>
        ))}
      </ul>
      <PaperPagination pager={pager} label="Active project pages" />
    </PaperSection>
  );
}

type Track = "virtara" | "jurivo" | "all";

/**
 * People who filled in a form on Virtara or Jurivo and are still waiting on
 * us. Unanswered ones are also at the top of the queue.
 */
function WebsiteLeads({ crm }: { crm: CrmView }) {
  const importLead = useImportCrm();
  const settle = useSetInboundLead();
  const failedToRead = crm.sources?.inbound && !crm.sources.inbound.ok;
  const pager = usePagination(crm.inbound, "", 10);

  return (
    <PaperSection label="Website leads" count={crm.inbound.length}>
      <p className="-mt-2 mb-4 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Forms filled in on Virtara and Jurivo that nobody has settled yet. Reply first; importing makes them a prospect in conversation.
      </p>
      {crm.inbound.length === 0 ? (
        <Empty>{failedToRead ? "Website leads could not be read from Virtec (see above)." : "No open website leads."}</Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {pager.pageItems.map((lead) => {
            const importing = importLead.isPending && importLead.variables?.id === lead.id;
            const settling = settle.isPending && settle.variables?.leadId === lead.id;
            return (
              <li key={lead.id}>
                <PaperCard className="h-full p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[15px] leading-6 font-semibold text-paper-moss">
                        {lead.name}
                        {lead.company ? <span className="font-normal text-paper-sage"> · {lead.company}</span> : null}
                      </h3>
                      <p className="text-[12.5px] text-paper-sage">
                        {inboundOrigin(lead)}
                        {lead.createdAt ? ` · ${formatShortDate(isoDate(new Date(lead.createdAt)))}` : ""}
                      </p>
                    </div>
                    <Tag tone={lead.status === "reviewing" ? "blue" : "flame"}>{lead.status === "reviewing" ? "Reviewing" : "New"}</Tag>
                  </div>

                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    {lead.email ? (
                      <a className={cn("inline-flex items-center gap-1 text-paper-blue hover:underline", PAPER_FOCUS)} href={mailtoHref(lead.email)}>
                        <Mail className="size-3.5" aria-hidden="true" />
                        {lead.email}
                      </a>
                    ) : null}
                    {lead.phone ? (
                      <a className={cn("inline-flex items-center gap-1 text-paper-blue hover:underline", PAPER_FOCUS)} href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
                        <Phone className="size-3.5" aria-hidden="true" />
                        {lead.phone}
                      </a>
                    ) : null}
                  </p>

                  {Object.keys(lead.details).length > 0 ? (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
                      {Object.entries(lead.details).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-paper-sage">{key}</dt>
                          <dd className="text-paper-char">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {lead.message ? <p className="mt-2 line-clamp-4 text-[13.5px] leading-5 whitespace-pre-wrap text-paper-char">{lead.message}</p> : null}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Link
                      to={hermesHref(inboundReplyPrompt(lead))}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1.5 rounded-none px-3 text-[13.5px] font-semibold text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
                        PAPER_FOCUS,
                      )}
                      aria-label={`Ask Hermes to draft a reply to ${lead.name}`}
                    >
                      <PenLine className="size-3.5" aria-hidden="true" />
                      Draft reply
                    </Link>
                    {lead.prospectId ? (
                      <Link
                        to={prospectHref(lead.prospectId)}
                        className={cn("inline-flex min-h-8 items-center rounded-none px-3 text-[13.5px] font-semibold text-paper-blue hover:bg-paper-stone", PAPER_FOCUS)}
                      >
                        Open prospect
                      </Link>
                    ) : (
                      <PaperButton variant="ghost" disabled={importing} onClick={() => importLead.mutate({ kind: "inbound", id: lead.id })} aria-label={`Import ${lead.name}`}>
                        <Download className="size-3.5" aria-hidden="true" />
                        {importing ? "Importing…" : "Import"}
                      </PaperButton>
                    )}
                    {crm.writable ? (
                      <>
                        <PaperButton disabled={settling} onClick={() => settle.mutate({ leadId: lead.id, status: "replied" })} aria-label={`Mark ${lead.name} replied in Virtec`}>
                          <Check className="size-3.5" aria-hidden="true" />
                          Replied
                        </PaperButton>
                        <PaperButton disabled={settling} onClick={() => settle.mutate({ leadId: lead.id, status: "not_a_fit" })} aria-label={`${lead.name} is not a fit`}>
                          Not a fit
                        </PaperButton>
                        <PaperButton disabled={settling} onClick={() => settle.mutate({ leadId: lead.id, status: "spam" })} aria-label={`Mark ${lead.name} as spam`}>
                          <X className="size-3.5" aria-hidden="true" />
                          Spam
                        </PaperButton>
                      </>
                    ) : null}
                  </div>
                </PaperCard>
              </li>
            );
          })}
        </ul>
      )}
      <PaperPagination pager={pager} label="Website lead pages" />
      {importLead.error ?? settle.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {(importLead.error ?? settle.error)?.message}
        </p>
      ) : null}
    </PaperSection>
  );
}

/**
 * Ask Virtec to scan an area for new candidates.
 *
 * Spends Google Places money, so it is deliberate: closed until opened, an
 * honest count of the requests a choice would make, a confirm before it
 * runs, and Virtec's own monthly cap behind all of it. Virtec refuses
 * outright until that cap is set.
 */
function FindCandidates({ track, writable }: { track: Track; writable: boolean }) {
  const [open, setOpen] = useState(false);
  const info = useScanInfo(open);
  const scan = useScanCandidates();
  const [area, setArea] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);

  const site = track === "jurivo" ? "jurivo" : "virtara";
  const data = info.data;
  const categories = [...new Set((data?.categories ?? []).filter((entry) => entry.track === site).map((entry) => entry.category))];
  const wanted = new Set((data?.categories ?? []).filter((entry) => entry.track === site && chosen.includes(entry.category)).flatMap((entry) => entry.types)).size;
  const budget = data?.budget;
  const cost = area && wanted > 0 ? wanted : 0;
  const over = budget?.remaining !== null && budget?.remaining !== undefined && cost > budget.remaining;
  const result = scan.data;

  const reason = !writable
    ? "Needs Virtec write-back (VIRTEC_WRITE_API_KEY)."
    : budget && budget.cap === null
      ? "Scans from here are off until PLACES_MONTHLY_REQUEST_CAP is set in Virtec: the most Places requests you are willing to pay for in a month."
      : undefined;

  return (
    <div className="mb-4">
      <PaperButton aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? "Close" : "Find more candidates"}
      </PaperButton>
      {open ? (
        <div className="mt-3 max-w-2xl rounded-none border border-paper-mist bg-paper-cream p-4">
          <p className="text-[13px] leading-5 text-paper-sage">
            Scans one area of Google Places for {site === "jurivo" ? "law firms" : "businesses"} and adds what it finds to this list. It costs money: each Places
            type searched is one request, and Virtec stops at your monthly limit.
          </p>
          {info.isPending ? <p className="mt-3 text-[13px] text-paper-sage">Reading Virtec…</p> : null}
          {info.error ? (
            <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
              {info.error.message}
            </p>
          ) : null}
          {data ? (
            <>
              <label className="mt-3 block">
                <FieldLabel>Area</FieldLabel>
                <select className={cn(PAPER_INPUT, "w-full max-w-xs")} value={area} onChange={(event) => setArea(event.target.value)}>
                  <option value="">Choose an area</option>
                  {data.areas.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="mt-3">
                <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">Categories ({site === "jurivo" ? "Jurivo" : "Virtara"})</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {categories.map((name) => (
                    <label key={name} className="flex cursor-pointer items-center gap-1.5 text-[13.5px] text-paper-char">
                      <input
                        type="checkbox"
                        checked={chosen.includes(name)}
                        onChange={(event) => setChosen((current) => (event.target.checked ? [...current, name] : current.filter((entry) => entry !== name)))}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="mt-3 text-[12.5px] text-paper-sage" role="status">
                {budget?.cap === null
                  ? `${budget.used} requests used this month, no limit set.`
                  : budget
                    ? `${budget.remaining} of ${budget.cap} requests left this month.`
                    : ""}
                {cost > 0 ? ` This scan: up to ${cost}.` : ""}
                {over ? " That is more than is left." : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <PaperButton
                  variant="amber"
                  disabled={scan.isPending || cost === 0 || over || Boolean(reason)}
                  title={reason}
                  onClick={() => {
                    if (!window.confirm(`This makes up to ${cost} Google Places requests, and you have ${budget?.remaining ?? "no limit on"} left this month. Continue?`)) return;
                    scan.mutate({ area, track: site, categories: chosen });
                  }}
                >
                  {scan.isPending ? "Scanning… (up to a minute)" : "Scan"}
                </PaperButton>
                {reason ? <span className="text-[12.5px] text-paper-sage">{reason}</span> : null}
              </div>
            </>
          ) : null}
          {scan.error ? (
            <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
              {scan.error.message}
            </p>
          ) : null}
          {result ? (
            <p className="mt-3 text-[13px] text-paper-char" role="status">
              Found {result.found} places ({result.requests} {result.requests === 1 ? "request" : "requests"}); those already in the list were updated, not doubled.{" "}
              {result.stoppedByCap ? (result.message ?? "Stopped at the monthly limit.") : "Score them against the ICP to see which fit."}
              {result.errors.length > 0 ? ` ${result.errors.length} search${result.errors.length === 1 ? "" : "es"} failed: ${result.errors[0]}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const FIT_WORDS = ["not a fit", "weak fit", "possible fit", "good fit", "strong fit"];

function Leads({ crm, icpName }: { crm: CrmView; icpName?: string }) {
  const tracks = new Set(crm.leads.map((lead) => lead.track).filter(Boolean));
  const [track, setTrack] = useState<Track>(tracks.has("virtara") ? "virtara" : "all");
  const importLead = useImportCrm();
  const notAFit = useLeadNotAFit();
  const profile = useProfileLeads();

  const shown = useMemo(() => crm.leads.filter((lead) => track === "all" || lead.track === track), [crm.leads, track]);
  const unscored = shown.filter((lead) => !lead.profile).length;
  const result = profile.data;

  return (
    <PaperSection
      label="Leads to import"
      count={shown.length}
      action={
        tracks.size > 1 ? (
          <SegmentedControl<Track>
            label="Track"
            value={track}
            onChange={setTrack}
            options={[
              { value: "virtara", label: "Virtara" },
              { value: "jurivo", label: "Jurivo" },
              { value: "all", label: "All" },
            ]}
          />
        ) : null
      }
    >
      <p className="-mt-2 mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Virtec's best-scored leads{icpName ? `. Import the ones that fit “${icpName}”` : ""}. Virtec's score is about its own signals. Scoring with Jev asks a
        different question: does this one look like your ICP? Good fits move to the top. It sends only public business details, never an email or phone number.
        Importing adds them to Traction's queue; you will still need a specific observation before outreach is drafted.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PaperButton
          variant="amber"
          disabled={profile.isPending || unscored === 0}
          onClick={() => profile.mutate(track === "all" ? undefined : track)}
          title="Scores up to 15 unscored candidates, and at most 60 a day"
        >
          {profile.isPending ? "Scoring with Jev…" : unscored === 0 ? "All scored" : `Score ${Math.min(unscored, 15)} against the ICP`}
        </PaperButton>
        {result ? (
          <span className="text-[12.5px] text-paper-sage" role="status">
            Scored {result.profiled}
            {result.failed > 0 ? `, ${result.failed} failed` : ""}. {result.left > 0 ? `${result.left} left; ` : ""}
            {result.remainingToday} more allowed today.
          </span>
        ) : null}
      </div>
      <FindCandidates track={track} writable={crm.writable} />
      {profile.error ?? result?.error ? (
        <p role="alert" className="mb-4 text-[13px] text-paper-flame-deep">
          {profile.error?.message ?? result?.error}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <Empty>No leads to import.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-paper-mist text-[12px] tracking-[0.06em] text-paper-sage uppercase">
                <th scope="col" className="py-2 text-left font-semibold">Business</th>
                <th scope="col" className="py-2 text-right font-semibold">Fit</th>
                <th scope="col" className="py-2 text-right font-semibold">Score</th>
                <th scope="col" className="py-2 pl-4 text-left font-semibold">Why</th>
                <th scope="col" className="py-2 text-right font-semibold">
                  <span className="sr-only">Import</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((lead) => {
                const pending = importLead.isPending && importLead.variables?.id === lead.id;
                return (
                  <tr key={lead.id} className="border-b border-paper-stone align-top">
                    <th scope="row" className="py-2.5 text-left font-normal">
                      <span className="font-medium text-paper-moss">{lead.name}</span>
                      <span className="block text-[12px] text-paper-sage">
                        {[lead.category, lead.area, lead.websiteSignal ? `website: ${lead.websiteSignal}` : undefined].filter(Boolean).join(" · ")}
                      </span>
                    </th>
                    <td className="py-2.5 text-right tabular-nums">
                      {lead.profile ? (
                        <span
                          title={`Jev: ${FIT_WORDS[Math.min(4, Math.round(lead.profile.fit))]}. ${lead.profile.gap ? "The data shows a checkable gap. " : ""}Confidence ${Math.round(lead.profile.confidence * 100)}%`}
                        >
                          <Tag tone={lead.profile.fit >= 3 ? "green" : lead.profile.fit >= 2 ? "marigold" : "muted"}>{lead.profile.fit.toFixed(1)} / 4</Tag>
                        </span>
                      ) : (
                        <span className="text-paper-ash">-</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-paper-display font-bold text-paper-moss tabular-nums">{lead.score ?? "-"}</td>
                    <td className="py-2.5 pl-4 text-paper-char">{lead.scoreReasons.slice(0, 2).join(" · ") || "-"}</td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex gap-1">
                        <PaperButton variant="ghost" disabled={pending} onClick={() => importLead.mutate({ kind: "lead", id: lead.id })} aria-label={`Import ${lead.name}`}>
                          <Download className="size-3.5" aria-hidden="true" />
                          {pending ? "Importing…" : "Import"}
                        </PaperButton>
                        {crm.writable ? (
                          <PaperButton
                            disabled={notAFit.isPending && notAFit.variables === lead.id}
                            onClick={() => notAFit.mutate(lead.id)}
                            aria-label={`${lead.name} is not a fit: mark disqualified in Virtec`}
                          >
                            Not a fit
                          </PaperButton>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {importLead.error ?? notAFit.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {(importLead.error ?? notAFit.error)?.message}
        </p>
      ) : null}
      {importLead.data?.virtec && !importLead.data.virtec.ok ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          Imported, but Virtec was not told: {importLead.data.virtec.error}
        </p>
      ) : null}
    </PaperSection>
  );
}

function Clients({ crm }: { crm: CrmView }) {
  const importClient = useImportCrm();
  const active = crm.clients.filter((client) => client.active !== false);
  if (active.length === 0) return null;

  return (
    <PaperSection label="Clients" count={active.length}>
      <p className="-mt-2 mb-4 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Bring a client into Traction to track referral asks and what they owe.
      </p>
      <ul className="divide-y divide-paper-stone border-y border-paper-mist">
        {active
          .slice()
          .sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0))
          .map((client) => {
            const pending = importClient.isPending && importClient.variables?.id === client.id;
            return (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-paper-moss">{client.companyName ?? client.name}</span>
                  <span className="block text-[12.5px] text-paper-sage">
                    {[client.companyName ? client.name : undefined, formatRand(client.totalSpent), client.maintenance ? "on maintenance" : undefined]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {client.prospectId ? (
                  <Link to={prospectHref(client.prospectId)} className={cn("text-[13px] font-medium text-paper-blue hover:underline", PAPER_FOCUS)}>
                    In Traction
                  </Link>
                ) : (
                  <PaperButton disabled={pending} onClick={() => importClient.mutate({ kind: "client", id: client.id })} aria-label={`Track ${client.companyName ?? client.name} in Traction`}>
                    <Download className="size-3.5" aria-hidden="true" />
                    {pending ? "Adding…" : "Track referrals"}
                  </PaperButton>
                )}
              </li>
            );
          })}
      </ul>
      {importClient.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {importClient.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-6 text-paper-char">{children}</p>;
}
