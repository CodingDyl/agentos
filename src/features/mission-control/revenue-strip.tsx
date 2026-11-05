import { TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Meter, PAPER_FOCUS, PaperButton, PaperSection } from "@/components/paper";
import { ClientDraftForm } from "@/features/business/business-draft";
import { followUpMailto, formatRand } from "@/features/business/business-model";
import { useBusiness } from "@/lib/agentos/business";
import { useMissionControl } from "@/lib/agentos/queries";
import { useTraction } from "@/lib/agentos/traction";
import { usePitches } from "@/lib/agentos/pitch";
import { pitchesReady } from "@shared/pitch-types";
import { cn } from "@/lib/utils";
import { MRR_GOAL_RAND, selectRevenueStrip } from "./revenue-strip-model";

const NEUTRAL_LINK =
  "inline-flex min-h-[var(--control-height)] items-center rounded-md border border-paper-mist bg-paper-linen px-3.5 text-[14px] leading-5 font-medium text-paper-moss transition-colors duration-150 hover:bg-paper-stone";

/**
 * Full-width money and pipeline, below the day's work. Numbers come
 * from Virtec / Traction / Business / the inbox; a missing source says so.
 * Send invoice and Follow up open existing flows. Nothing here sends.
 */
export function RevenueStrip({ className }: { className?: string }) {
  const traction = useTraction();
  const business = useBusiness();
  const mission = useMissionControl();
  const pitches = usePitches();
  const [followOpen, setFollowOpen] = useState(false);

  const crm = traction.data?.crm;
  const strip = selectRevenueStrip({
    virtecConfigured: crm?.configured ?? business.data?.virtecConfigured,
    revenue: crm?.revenue ?? business.data?.revenue,
    followUps: crm?.followUps ?? business.data?.followUps,
    inboundWaiting: crm?.configured
      ? crm.inbound.filter((lead) => lead.status === "new" || lead.status === "reviewing" || !lead.status).length
      : undefined,
    rebuildsWaiting: mission.data ? mission.data.attention.filter((item) => item.source === "rebuild").length : undefined,
    pitchesReady: pitchesReady(pitches.data),
  });

  const mail =
    strip.followUp.kind === "draft" ? followUpMailto(strip.followUp.email, strip.followUp.subject, strip.followUp.message) : undefined;

  return (
    <PaperSection
      label="Business pulse"
      className={className}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Link to={strip.sendInvoice.href} className={cn(NEUTRAL_LINK, PAPER_FOCUS)}>
            Send invoice
          </Link>
          {strip.followUp.kind === "list" ? (
            <Link to={strip.followUp.href} className={cn(NEUTRAL_LINK, PAPER_FOCUS)}>
              Follow up
            </Link>
          ) : (
            <PaperButton variant="ghost" onClick={() => setFollowOpen((open) => !open)} aria-expanded={followOpen}>
              Follow up
            </PaperButton>
          )}
        </div>
      }
    >
      <div className="qt-pulse">
        <MrrCell state={strip.mrr} />
        <OverdueCell state={strip.overdue} href={strip.sendInvoice.href} />
        <WaitingCell state={strip.waiting} />
      </div>
      {followOpen && strip.followUp.kind === "draft" ? (
        <div className="mt-4 border-t border-paper-mist pt-4">
          <p className="text-[14px] leading-[22px] text-paper-char">
            Draft to {strip.followUp.name}. Nothing is sent until you send it from Gmail.
          </p>
          {strip.followUp.customerId ? (
            <div className="mt-2">
              <ClientDraftForm
                request={{ clientId: strip.followUp.customerId, followUpId: strip.followUp.id }}
                initialSubject={strip.followUp.subject}
                initialBody={strip.followUp.message}
                showSubject
                onClose={() => setFollowOpen(false)}
              />
            </div>
          ) : mail ? (
            <a href={mail} className={cn("mt-2 inline-flex rounded-sm text-[14px] leading-[22px] font-medium text-paper-moss hover:underline", PAPER_FOCUS)}>
              Open drafted message in mail
            </a>
          ) : (
            <Link to="/business?tab=follow-ups" className={cn("mt-2 inline-flex rounded-sm text-[14px] leading-[22px] font-medium text-paper-moss hover:underline", PAPER_FOCUS)}>
              Open follow-ups
            </Link>
          )}
        </div>
      ) : null}
    </PaperSection>
  );
}

function MetricLabel({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-5 text-paper-sage">{children}</p>;
}

function MrrCell({ state }: { state: ReturnType<typeof selectRevenueStrip>["mrr"] }) {
  if (state.kind === "connect") {
    return <ConnectCell label="Revenue target" href={state.href} detail={state.label} />;
  }
  const over = state.amount >= state.goal;
  return (
    <div className="min-w-0">
      <MetricLabel>MRR against {formatRand(MRR_GOAL_RAND)} a month</MetricLabel>
      <p className="mt-0.5 text-[24px] leading-8 font-semibold text-paper-moss tabular-nums">{formatRand(state.amount)}</p>
      <div className="mt-1.5 max-w-60">
        <Meter value={state.progress} label={`Monthly recurring towards ${formatRand(MRR_GOAL_RAND)}`} tone={over ? "green" : "amber"} />
      </div>
    </div>
  );
}

function OverdueCell({ state, href }: { state: ReturnType<typeof selectRevenueStrip>["overdue"]; href: string }) {
  if (state.kind === "connect") {
    return <ConnectCell label="Overdue invoices" href={state.href} detail={state.label} />;
  }
  const overdue = state.count > 0;
  return (
    <div className="min-w-0">
      <MetricLabel>Overdue invoices</MetricLabel>
      <Link to={href} className={cn("group mt-0.5 block w-fit rounded-sm", PAPER_FOCUS)}>
        <span className="block text-[24px] leading-8 font-semibold text-paper-moss tabular-nums group-hover:underline">{state.count}</span>
        <span className={cn("flex items-center gap-1 text-[13px] leading-5 tabular-nums", overdue ? "text-paper-marigold" : "text-paper-sage")}>
          {overdue ? <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" /> : null}
          {overdue ? (state.amount !== undefined ? `${formatRand(state.amount)} overdue` : "Overdue") : "Nothing overdue"}
        </span>
      </Link>
    </div>
  );
}

function WaitingCell({ state }: { state: ReturnType<typeof selectRevenueStrip>["waiting"] }) {
  if (state.kind === "connect") {
    return <ConnectCell label="Pipeline waiting on you" href={state.href} detail={state.label} />;
  }
  const parts = [
    state.leads !== undefined ? `${state.leads} ${state.leads === 1 ? "lead" : "leads"}` : undefined,
    state.rebuilds !== undefined ? `${state.rebuilds} ${state.rebuilds === 1 ? "rebuild" : "rebuilds"}` : undefined,
    state.pitches ? `${state.pitches} ${state.pitches === 1 ? "pitch" : "pitches"} ready` : undefined,
  ].filter(Boolean);
  return (
    <div className="min-w-0">
      <MetricLabel>Pipeline waiting on you</MetricLabel>
      <p className="mt-0.5 text-[14px] leading-[22px] font-medium text-paper-moss tabular-nums">{parts.join(" · ") || "Nothing queued"}</p>
    </div>
  );
}

function ConnectCell({ label, href, detail }: { label: string; href: string; detail: string }) {
  return (
    <div className="min-w-0">
      <MetricLabel>{label}</MetricLabel>
      <Link to={href} className={cn("mt-0.5 block w-fit rounded-sm text-[14px] leading-[22px] font-medium text-paper-moss hover:underline", PAPER_FOCUS)}>
        {detail}
      </Link>
    </div>
  );
}
