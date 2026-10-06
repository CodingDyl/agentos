import { useState } from "react";
import type { BusinessAgreement, BusinessData, BusinessEntitySummary, BusinessFollowUp, BusinessQuote, BusinessRetainer } from "@shared/business-types";
import { PAPER_FOCUS, PaperButton, PaperPagination, PaperSection, SegmentedControl, Tag } from "@/components/paper";
import { useFollowUpAction } from "@/lib/agentos/business";
import { cn } from "@/lib/utils";
import { ClientDraftForm } from "./business-draft";
import { followUpMailto, formatRand } from "./business-model";
import { usePagination } from "@/lib/use-pagination";

/**
 * Quotes, agreements, maintenance and follow-ups.
 *
 * All four read Virtec's records; none creates one. Creating and sending a
 * quote or agreement is a Virtec write that does not exist yet, so these
 * screens show what is waiting and on whom, and the follow-ups are the one
 * place a person acts (by writing to the client, then marking it done).
 */

type Scoped = { entity: BusinessEntitySummary; data: BusinessData };

const forEntity = <T extends { entityId: string }>(items: readonly T[], entity: BusinessEntitySummary) => items.filter((item) => item.entityId === entity.id);

function Empty({ children }: { children: string }) {
  return <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">{children}</p>;
}

function Row({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-semibold">{title}</span>
        {detail ? <span className="block truncate text-[12.5px] text-paper-sage">{detail}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-[14px] text-paper-char">{children}</span>
    </li>
  );
}

const QUOTE_TONE = { accepted: "green", pending: "marigold", rejected: "muted" } as const;

type QuoteFilter = "all" | BusinessQuote["kind"];

export function QuotesSection({ entity, data }: Scoped) {
  const [filter, setFilter] = useState<QuoteFilter>("all");
  const all = forEntity(data.quotes, entity);
  const quotes = filter === "all" ? all : all.filter((quote) => quote.kind === filter);
  const pending = quotes.filter((quote) => quote.status === "pending");
  const pendingValue = pending.reduce((sum, quote) => sum + quote.totalAmount, 0);
  const pager = usePagination(quotes, filter);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Quote type"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All (${all.length})` },
            { value: "project", label: `Project (${all.filter((quote) => quote.kind === "project").length})` },
            { value: "maintenance", label: `Maintenance (${all.filter((quote) => quote.kind === "maintenance").length})` },
          ]}
        />
      </div>
      {quotes.length === 0 ? <Empty>No quotes of this type recorded.</Empty> : null}
      <p className="text-[14px] text-paper-char">
        {pending.length} waiting, worth <strong>{formatRand(pendingValue)}</strong>
        {data.revenue?.quoteConversionRate !== undefined ? <> · {Math.round(data.revenue.quoteConversionRate)}% of quotes accepted</> : null}.
      </p>
      {quotes.length > 0 ? (
      <PaperSection label="Quotes" count={quotes.length}>
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((quote: BusinessQuote) => (
            <Row key={quote.id} title={quote.clientName} detail={quote.projectType}>
              {quote.kind === "maintenance" ? <Tag tone="blue">Maintenance</Tag> : null}
              {quote.ageDays !== undefined ? <span>{quote.ageDays}d</span> : null}
              {quote.stale ? <Tag tone="flame">Gone quiet</Tag> : null}
              <span className="font-semibold">{formatRand(quote.totalAmount)}</span>
              {quote.status ? <Tag tone={QUOTE_TONE[quote.status as keyof typeof QUOTE_TONE] ?? "muted"}>{quote.status}</Tag> : null}
            </Row>
          ))}
        </ul>
        <PaperPagination pager={pager} label="Quote pages" />
      </PaperSection>
      ) : null}
    </div>
  );
}

const AGREEMENT_ORDER = ["pending", "approved", "declined", "signed"];
const AGREEMENT_TONE = { pending: "marigold", approved: "blue", declined: "flame", signed: "green" } as const;

export function AgreementsSection({ entity, data }: Scoped) {
  const agreements = forEntity(data.agreements, entity).sort((a, b) => AGREEMENT_ORDER.indexOf(a.status) - AGREEMENT_ORDER.indexOf(b.status));
  const pager = usePagination(agreements);
  if (agreements.length === 0) return <Empty>No letter agreements recorded.</Empty>;

  return (
    <PaperSection label="Letter agreements" count={agreements.length}>
      <ul className="divide-y divide-paper-mist border-y border-paper-mist">
        {pager.pageItems.map((agreement: BusinessAgreement) => (
          <Row key={agreement.projectId} title={agreement.clientName} detail={agreement.projectType}>
            {agreement.amount !== undefined ? <span className="font-semibold">{formatRand(agreement.amount)}</span> : null}
            <Tag tone={AGREEMENT_TONE[agreement.status as keyof typeof AGREEMENT_TONE] ?? "muted"}>{agreement.status}</Tag>
          </Row>
        ))}
      </ul>
      <PaperPagination pager={pager} label="Agreement pages" />
    </PaperSection>
  );
}

export function MaintenanceSection({ entity, data }: Scoped) {
  const retainers = forEntity(data.retainers, entity);
  const monthly = retainers.reduce((sum, retainer) => sum + retainer.monthlyEquivalent, 0);
  const pager = usePagination(retainers);
  if (retainers.length === 0) return <Empty>No live maintenance retainers.</Empty>;

  return (
    <div className="grid gap-6">
      <p className="text-[14px] text-paper-char">
        {retainers.length} live retainer{retainers.length === 1 ? "" : "s"}, <strong>{formatRand(monthly)}</strong> a month from their schedules
        {data.revenue?.monthlyRecurringRevenue !== undefined ? <> (Virtec reports {formatRand(data.revenue.monthlyRecurringRevenue)})</> : null}.
        {data.revenue?.overdueInvoiceCount ? <> {data.revenue.overdueInvoiceCount} overdue invoice{data.revenue.overdueInvoiceCount === 1 ? "" : "s"} in Virtec.</> : null}
      </p>
      <PaperSection label="Retainers" count={retainers.length}>
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((retainer: BusinessRetainer) => (
            <Row key={retainer.projectId} title={retainer.clientName} detail={[retainer.projectType, retainer.serviceSku].filter(Boolean).join(" · ") || undefined}>
              <span>{formatRand(retainer.amount)}</span>
              <Tag>{retainer.frequency}</Tag>
            </Row>
          ))}
        </ul>
        <PaperPagination pager={pager} label="Retainer pages" />
      </PaperSection>
    </div>
  );
}

const FOLLOW_UP_LABEL: Record<string, string> = {
  quote_pending: "Quote pending",
  agreement_pending: "Agreement pending",
  invoice_overdue: "Invoice overdue",
  maintenance_renewal: "Renewal",
  project_stale: "Project stale",
};

export function FollowUpsSection({ entity, data }: Scoped) {
  const followUps = forEntity(data.followUps, entity);
  const pager = usePagination(followUps);
  if (followUps.length === 0) return <Empty>Nothing to follow up.</Empty>;

  return (
    <PaperSection label="Follow-ups" count={followUps.length}>
      {!data.virtecWritable ? (
        <p role="status" className="mb-3 text-[13px] text-paper-char">Marking these done needs <code>VIRTEC_WRITE_API_KEY</code>; until then they can be read and emailed, not closed.</p>
      ) : null}
      <ul className="divide-y divide-paper-mist border-y border-paper-mist">
        {pager.pageItems.map((followUp) => (
          <FollowUpRow key={followUp.id} followUp={followUp} writable={data.virtecWritable} />
        ))}
      </ul>
      <PaperPagination pager={pager} label="Follow-up pages" />
    </PaperSection>
  );
}

function FollowUpRow({ followUp, writable }: { followUp: BusinessFollowUp; writable: boolean }) {
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const act = useFollowUpAction();
  const mail = followUpMailto(followUp.customerEmail, followUp.suggestedSubject, followUp.suggestedMessage);
  const name = followUp.companyName ?? followUp.customerName;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={cn("min-w-0 cursor-pointer text-left", PAPER_FOCUS)}>
          <span className="block truncate text-[14.5px] font-semibold">{name}</span>
          <span className="block truncate text-[12.5px] text-paper-sage">{followUp.reason ?? followUp.projectName}</span>
        </button>
        <span className="flex flex-wrap items-center gap-2">
          {followUp.amount ? <span className="text-[14px] font-semibold">{formatRand(followUp.amount)}</span> : null}
          {followUp.overdue ? <Tag tone="flame">Overdue</Tag> : null}
          {followUp.type ? <Tag>{FOLLOW_UP_LABEL[followUp.type] ?? followUp.type}</Tag> : null}
        </span>
      </div>

      {open ? (
        <div className="mt-3 grid gap-3">
          {followUp.suggestedMessage ? <p className="max-w-[70ch] border-l-2 border-paper-mist pl-3 text-[13.5px] leading-6 whitespace-pre-wrap text-paper-char">{followUp.suggestedMessage}</p> : null}
          {drafting && followUp.customerId ? (
            <ClientDraftForm
              request={{ clientId: followUp.customerId, followUpId: followUp.id }}
              initialSubject={followUp.suggestedSubject}
              initialBody={followUp.suggestedMessage}
              showSubject
              onClose={() => setDrafting(false)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {followUp.customerId && !drafting ? (
              <PaperButton variant="ghost" onClick={() => setDrafting(true)}>
                Draft in Gmail
              </PaperButton>
            ) : null}
            {mail ? (
              <a href={mail} className={cn("inline-flex min-h-8 items-center border-[1.5px] border-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen", PAPER_FOCUS)}>
                Open in mail app
              </a>
            ) : null}
            <PaperButton variant="amber" disabled={!writable || act.isPending} onClick={() => act.mutate({ id: followUp.id, action: "sent" })}>
              I handled it
            </PaperButton>
            <PaperButton variant="ghost" disabled={!writable || act.isPending} onClick={() => act.mutate({ id: followUp.id, action: "snooze", days: 3 })}>
              Snooze 3 days
            </PaperButton>
            <PaperButton variant="quiet" disabled={!writable || act.isPending} onClick={() => act.mutate({ id: followUp.id, action: "dismiss" })}>
              Dismiss
            </PaperButton>
          </div>
          {act.error ? <p role="alert" className="text-[13px] text-paper-flame-deep">{act.error.message}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
