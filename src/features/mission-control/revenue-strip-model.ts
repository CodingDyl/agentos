/**
 * The Dashboard's revenue and pipeline strip, derived from Virtec / Traction /
 * Business / rebuilds. Every number is a number that already exists; a missing
 * source is an honest empty state, never a zero invented to fill the cell.
 */

export const MRR_GOAL_RAND = 100_000;

export type ConnectState = {
  kind: "connect";
  href: string;
  label: string;
};

export type MrrState =
  | ConnectState
  | { kind: "ready"; amount: number; goal: number; progress: number };

export type OverdueState =
  | ConnectState
  | { kind: "ready"; count: number; amount?: number };

export type WaitingState =
  | ConnectState
  | { kind: "ready"; leads?: number; rebuilds?: number };

export type FollowUpAction =
  | {
      kind: "draft";
      id: string;
      name: string;
      customerId?: string;
      email?: string;
      subject?: string;
      message?: string;
      sends: false;
    }
  | { kind: "list"; href: string; sends: false };

export type FollowUpSeed = {
  id: string;
  type?: string;
  amount?: number;
  overdue?: boolean;
  customerId?: string;
  customerName?: string;
  companyName?: string;
  customerEmail?: string;
  suggestedSubject?: string;
  suggestedMessage?: string;
};

export type RevenueStripInput = {
  virtecConfigured?: boolean;
  revenue?: { monthlyRecurringRevenue?: number; overdueInvoiceCount?: number };
  followUps?: readonly FollowUpSeed[];
  inboundWaiting?: number;
  rebuildsWaiting?: number;
};

export type RevenueStrip = {
  mrr: MrrState;
  overdue: OverdueState;
  waiting: WaitingState;
  sendInvoice: { href: string; sends: false };
  followUp: FollowUpAction;
};

const CONNECT_CRM: ConnectState = {
  kind: "connect",
  href: "/traction?tab=crm",
  label: "Connect Virtec",
};

function mrrProgress(amount: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.max(0, Math.min(amount / goal, 1));
}

function overdueAmount(followUps: readonly FollowUpSeed[] | undefined): number | undefined {
  const invoices = (followUps ?? []).filter((item) => item.type === "invoice_overdue" && item.amount !== undefined);
  if (invoices.length === 0) return undefined;
  return invoices.reduce((sum, item) => sum + (item.amount ?? 0), 0);
}

function firstDraft(followUps: readonly FollowUpSeed[] | undefined): FollowUpSeed | undefined {
  return (followUps ?? []).find((item) => item.suggestedMessage?.trim() || item.suggestedSubject?.trim());
}

export function selectRevenueStrip(input: RevenueStripInput): RevenueStrip {
  const crm = input.virtecConfigured === true;
  const mrrAmount = input.revenue?.monthlyRecurringRevenue;
  const overdueCount = input.revenue?.overdueInvoiceCount;

  const mrr: MrrState =
    crm && mrrAmount !== undefined
      ? { kind: "ready", amount: mrrAmount, goal: MRR_GOAL_RAND, progress: mrrProgress(mrrAmount, MRR_GOAL_RAND) }
      : crm
        ? { kind: "connect", href: "/traction?tab=crm", label: "No MRR reported" }
        : CONNECT_CRM;

  const overdue: OverdueState =
    crm && overdueCount !== undefined
      ? { kind: "ready", count: overdueCount, amount: overdueAmount(input.followUps) }
      : CONNECT_CRM;

  const hasLeads = crm && input.inboundWaiting !== undefined;
  const hasRebuilds = input.rebuildsWaiting !== undefined;
  const waiting: WaitingState =
    hasLeads || hasRebuilds
      ? {
          kind: "ready",
          leads: hasLeads ? input.inboundWaiting : undefined,
          rebuilds: hasRebuilds ? input.rebuildsWaiting : undefined,
        }
      : { kind: "connect", href: "/traction?tab=crm", label: "Connect Virtec" };

  const draft = firstDraft(input.followUps);
  const followUp: FollowUpAction = draft
    ? {
        kind: "draft",
        id: draft.id,
        name: draft.companyName ?? draft.customerName ?? "a client",
        customerId: draft.customerId,
        email: draft.customerEmail,
        subject: draft.suggestedSubject,
        message: draft.suggestedMessage,
        sends: false,
      }
    : { kind: "list", href: "/business?tab=follow-ups", sends: false };

  return {
    mrr,
    overdue,
    waiting,
    sendInvoice: { href: "/business?tab=invoices", sends: false },
    followUp,
  };
}
