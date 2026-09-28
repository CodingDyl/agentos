import { Download, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { daysBetween } from "@shared/traction-dates";
import type { CrmView, TractionData } from "@shared/traction-types";
import { formatRand, type VirtecSource } from "@shared/virtec-types";
import { Meter, PAPER_FOCUS, PaperButton, PaperCard, PaperSection, SegmentedControl, Tag } from "@/components/paper";
import { useImportCrm, useRefreshCrm } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { crmFollowUpPrompt, formatShortDate, hermesHref, prospectHref } from "./traction-model";

/**
 * Virtec, read live.
 *
 * What the CRM knows about money and clients, shown next to the acquisition
 * work rather than instead of it. Nothing here writes to Virtec — its API to
 * AgentOS is read-only — so the actions are the ones AgentOS owns: draft a
 * follow-up with Hermes, or import a lead or client into Traction so stages,
 * observations and referral asks can be recorded against it.
 */

const SOURCE_LABELS: Record<VirtecSource, string> = {
  leads: "Leads",
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
      <pre className="mt-3 overflow-x-auto rounded-[4px] bg-paper-stone px-3 py-2 text-[13px] text-paper-moss">
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
          most every five minutes.
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
    { label: "Monthly recurring", value: formatRand(revenue.monthlyRecurringRevenue) ?? "—" },
    { label: "Pending quotes", value: formatRand(revenue.pendingQuoteValue) ?? "—" },
    { label: "Accepted this month", value: formatRand(revenue.acceptedQuoteValueThisMonth) ?? "—" },
    { label: "Quote conversion", value: revenue.quoteConversionRate === undefined ? "—" : `${Math.round(revenue.quoteConversionRate)}%` },
    { label: "Maintenance clients", value: revenue.activeMaintenanceCustomers?.toString() ?? "—" },
    {
      label: "Overdue invoices",
      value: revenue.overdueInvoiceCount?.toString() ?? "—",
      loud: (revenue.overdueInvoiceCount ?? 0) > 0,
    },
  ];

  return (
    <PaperSection label="Money">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="text-[11.5px] font-semibold tracking-[0.06em] text-paper-sage uppercase">{figure.label}</dt>
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
  return (
    <PaperSection label="Follow-ups" count={crm.followUps.length}>
      {crm.followUps.length === 0 ? (
        <Empty>Virtec has nothing open to follow up.</Empty>
      ) : (
        <ul className="divide-y divide-paper-stone border-y border-paper-mist">
          {crm.followUps.slice(0, 12).map((followUp) => {
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
                  <Link
                    to={hermesHref(crmFollowUpPrompt(followUp))}
                    className={cn(
                      "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-[4px] px-3 text-[13.5px] font-semibold text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
                      PAPER_FOCUS,
                    )}
                    aria-label={`Draft a follow-up to ${followUp.companyName ?? followUp.customerName ?? "this client"}`}
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    Draft
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-paper-sage">Mark follow-ups as sent in Virtec — AgentOS cannot write to it.</p>
    </PaperSection>
  );
}

function Quotes({ crm, today }: { crm: CrmView; today: string }) {
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
            {crm.quotes.slice(0, 12).map((quote) => {
              const age = quote.createdAt ? daysBetween(quote.createdAt, today) : undefined;
              return (
                <tr key={quote.id} className="border-b border-paper-stone">
                  <th scope="row" className="py-2 text-left font-normal text-paper-moss">
                    {quote.clientName ?? "Unknown client"}
                    {quote.projectType ? <span className="block text-[12px] text-paper-sage">{quote.projectType}</span> : null}
                  </th>
                  <td className="py-2 text-right tabular-nums">{formatRand(quote.totalAmount) ?? "—"}</td>
                  <td className={cn("py-2 text-right tabular-nums", age !== undefined && age >= 7 ? "font-semibold text-paper-amber-deep" : "text-paper-char")}>
                    {age === undefined ? "—" : `${age}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </PaperSection>
  );
}

function Projects({ crm }: { crm: CrmView }) {
  if (crm.projects.length === 0) return null;

  return (
    <PaperSection label="Active projects" count={crm.projects.length}>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {crm.projects.slice(0, 12).map((project) => (
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
                <span className="shrink-0 text-[12.5px] text-paper-char tabular-nums">{project.completion === undefined ? "—" : `${Math.round(project.completion)}%`}</span>
              </div>
            </PaperCard>
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}

type Track = "virtara" | "jurivo" | "all";

function Leads({ crm, icpName }: { crm: CrmView; icpName?: string }) {
  const tracks = new Set(crm.leads.map((lead) => lead.track).filter(Boolean));
  const [track, setTrack] = useState<Track>(tracks.has("virtara") ? "virtara" : "all");
  const importLead = useImportCrm();

  const shown = useMemo(() => crm.leads.filter((lead) => track === "all" || lead.track === track), [crm.leads, track]);

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
      <p className="-mt-2 mb-4 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Virtec's best-scored leads{icpName ? `. Import the ones that fit “${icpName}”` : ""} — importing adds them to Traction's queue. Virtec's score is not a
        specific observation, so you will still need one before outreach is drafted.
      </p>
      {shown.length === 0 ? (
        <Empty>No leads to import.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-paper-mist text-[12px] tracking-[0.06em] text-paper-sage uppercase">
                <th scope="col" className="py-2 text-left font-semibold">Business</th>
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
                    <td className="py-2.5 text-right font-paper-display font-bold text-paper-moss tabular-nums">{lead.score ?? "—"}</td>
                    <td className="py-2.5 pl-4 text-paper-char">{lead.scoreReasons.slice(0, 2).join(" · ") || "—"}</td>
                    <td className="py-2.5 text-right">
                      <PaperButton variant="ghost" disabled={pending} onClick={() => importLead.mutate({ kind: "lead", id: lead.id })} aria-label={`Import ${lead.name}`}>
                        <Download className="size-3.5" aria-hidden="true" />
                        {pending ? "Importing…" : "Import"}
                      </PaperButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {importLead.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {importLead.error.message}
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
