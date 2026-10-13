import { useState } from "react";
import { Link } from "react-router-dom";
import { Meter, PAPER_FOCUS, PaperButton } from "@/components/paper";
import { ClientDraftForm } from "@/features/business/business-draft";
import { followUpMailto, formatRand } from "@/features/business/business-model";
import { useBusiness } from "@/lib/agentos/business";
import { useMissionControl } from "@/lib/agentos/queries";
import { useTraction } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { dashboardCardClass } from "./dashboard-layout";
import { MRR_GOAL_RAND, selectRevenueStrip } from "./revenue-strip-model";

/**
 * Full-width money and pipeline, at the top of the Dashboard. Numbers come
 * from Virtec / Traction / Business / the inbox; a missing source says so.
 * Send invoice and Follow up open existing flows. Nothing here sends.
 */
export function RevenueStrip({ className }: { className?: string }) {
  const traction = useTraction();
  const business = useBusiness();
  const mission = useMissionControl();
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
  });

  const mail =
    strip.followUp.kind === "draft" ? followUpMailto(strip.followUp.email, strip.followUp.subject, strip.followUp.message) : undefined;

  return (
    <section aria-label="Revenue and pipeline" className={cn(dashboardCardClass("revenue"), "min-w-0", className)}>
      <div className="dashboard-revenue-grid">
        <MrrCell state={strip.mrr} />
        <OverdueCell state={strip.overdue} />
        <WaitingCell state={strip.waiting} />
        <div className="flex min-w-0 flex-wrap items-center gap-2 self-center">
          <Link
            to={strip.sendInvoice.href}
            className={cn(
              "inline-flex min-h-8 items-center border-[1.5px] border-paper-blue px-3 font-paper-utility text-[12px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen",
              PAPER_FOCUS,
            )}
          >
            Send invoice
          </Link>
          {strip.followUp.kind === "list" ? (
            <Link
              to={strip.followUp.href}
              className={cn(
                "inline-flex min-h-8 items-center border-[1.5px] border-paper-mist px-3 font-paper-utility text-[12px] font-medium tracking-[0.1em] text-paper-moss uppercase hover:bg-paper-linen",
                PAPER_FOCUS,
              )}
            >
              Follow up
            </Link>
          ) : (
            <PaperButton variant="ghost" onClick={() => setFollowOpen((open) => !open)} aria-expanded={followOpen}>
              Follow up
            </PaperButton>
          )}
        </div>
      </div>
      {followOpen && strip.followUp.kind === "draft" ? (
        <div className="mt-3 border-t border-paper-mist pt-3">
          <p className="text-[13px] text-paper-char">
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
            <a href={mail} className={cn("mt-2 inline-flex text-[13px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
              Open drafted message in mail
            </a>
          ) : (
            <Link to="/business?tab=follow-ups" className={cn("mt-2 inline-flex text-[13px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
              Open follow-ups
            </Link>
          )}
        </div>
      ) : null}
    </section>
  );
}

function MrrCell({ state }: { state: ReturnType<typeof selectRevenueStrip>["mrr"] }) {
  if (state.kind === "connect") {
    return (
      <ConnectCell label="MRR" href={state.href} detail={state.label} />
    );
  }
  const over = state.amount >= state.goal;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-[0.04em] text-paper-sage uppercase">MRR vs R100k/month</p>
      <p className="mt-0.5 text-[16px] font-semibold text-paper-moss tabular-nums">
        {formatRand(state.amount)} <span className="text-[12px] font-medium text-paper-sage">/ {formatRand(MRR_GOAL_RAND)}</span>
      </p>
      <div className="mt-1.5">
        <Meter value={state.progress} label="Monthly recurring towards R100,000" tone={over ? "green" : "amber"} />
      </div>
    </div>
  );
}

function OverdueCell({ state }: { state: ReturnType<typeof selectRevenueStrip>["overdue"] }) {
  if (state.kind === "connect") {
    return <ConnectCell label="Overdue invoices" href={state.href} detail={state.label} />;
  }
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-[0.04em] text-paper-sage uppercase">Overdue invoices</p>
      <p className={cn("mt-0.5 text-[16px] font-semibold tabular-nums", state.count > 0 ? "text-paper-flame-deep" : "text-paper-moss")}>
        {state.count}{" "}
        <span className="text-[12px] font-medium text-paper-sage">
          {state.count === 1 ? "invoice" : "invoices"}
          {state.amount !== undefined ? ` · ${formatRand(state.amount)}` : ""}
        </span>
      </p>
    </div>
  );
}

function WaitingCell({ state }: { state: ReturnType<typeof selectRevenueStrip>["waiting"] }) {
  if (state.kind === "connect") {
    return <ConnectCell label="Waiting on you" href={state.href} detail={state.label} />;
  }
  const parts = [
    state.leads !== undefined ? `${state.leads} ${state.leads === 1 ? "lead" : "leads"}` : undefined,
    state.rebuilds !== undefined ? `${state.rebuilds} ${state.rebuilds === 1 ? "rebuild" : "rebuilds"}` : undefined,
  ].filter(Boolean);
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-[0.04em] text-paper-sage uppercase">Waiting on you</p>
      <p className="mt-0.5 text-[16px] font-semibold text-paper-moss">{parts.join(" · ") || "Nothing queued"}</p>
    </div>
  );
}

function ConnectCell({ label, href, detail }: { label: string; href: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-[0.04em] text-paper-sage uppercase">{label}</p>
      <Link to={href} className={cn("mt-0.5 block text-[13.5px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
        {detail}
      </Link>
    </div>
  );
}
