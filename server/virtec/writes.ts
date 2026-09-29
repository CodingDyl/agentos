import type { VirtecSnapshot } from "../../shared/virtec-types";
import { patchVirtec, VirtecError, type InboundLeadWriteStatus, type MagnetEmailWrite } from "./client";
import { patchCachedSnapshot } from "./snapshot";

/**
 * The writes AgentOS makes to Virtec, and what the screen sees afterwards.
 *
 * Each is the consequence of one thing a person just did in AgentOS — marked
 * a follow-up done, snoozed it, imported a lead, called one not a fit. None
 * happens on a schedule or on inference.
 *
 * Every result is reported, never swallowed: the caller gets `{ ok: false,
 * error }` and shows it, because "marked done here but not in Virtec" is
 * something the operator needs to know to fix by hand.
 */

export type WriteOutcome = { ok: true } | { ok: false; error: string };

async function attempt(write: () => Promise<unknown>, label: string): Promise<WriteOutcome> {
  try {
    await write();
    return { ok: true };
  } catch (error) {
    const message = error instanceof VirtecError ? error.message : "Virtec could not be updated.";
    console.error(`[agentos] virtec write (${label}): ${message}`);
    return { ok: false, error: message };
  }
}

function updateFollowUp(snapshot: VirtecSnapshot, id: string, fields: { status: string; snoozedUntil?: string }): VirtecSnapshot {
  return { ...snapshot, followUps: snapshot.followUps.map((followUp) => (followUp.id === id ? { ...followUp, ...fields } : followUp)) };
}

export async function markFollowUpSent(id: string): Promise<WriteOutcome> {
  const outcome = await attempt(() => patchVirtec({ kind: "follow-up", id, body: { status: "sent" } }), `follow-up ${id} sent`);
  if (outcome.ok) patchCachedSnapshot((snapshot) => updateFollowUp(snapshot, id, { status: "sent" }));
  return outcome;
}

export async function dismissFollowUp(id: string): Promise<WriteOutcome> {
  const outcome = await attempt(() => patchVirtec({ kind: "follow-up", id, body: { status: "dismissed" } }), `follow-up ${id} dismissed`);
  if (outcome.ok) patchCachedSnapshot((snapshot) => updateFollowUp(snapshot, id, { status: "dismissed" }));
  return outcome;
}

export async function snoozeFollowUp(id: string, until: Date): Promise<WriteOutcome> {
  const snoozedUntil = until.toISOString();
  const outcome = await attempt(() => patchVirtec({ kind: "follow-up", id, body: { status: "snoozed", snoozedUntil } }), `follow-up ${id} snoozed`);
  if (outcome.ok) patchCachedSnapshot((snapshot) => updateFollowUp(snapshot, id, { status: "snoozed", snoozedUntil }));
  return outcome;
}

export async function setLeadStatus(id: string, status: "reviewing" | "disqualified"): Promise<WriteOutcome> {
  const outcome = await attempt(() => patchVirtec({ kind: "lead", id, body: { status } }), `lead ${id} ${status}`);
  if (outcome.ok) {
    patchCachedSnapshot((snapshot) => ({
      ...snapshot,
      leads: snapshot.leads.map((lead) => (lead.id === id ? { ...lead, status } : lead)),
    }));
  }
  return outcome;
}

export async function setInboundLeadStatus(id: string, status: InboundLeadWriteStatus): Promise<WriteOutcome> {
  const outcome = await attempt(() => patchVirtec({ kind: "inbound-lead", id, body: { status } }), `website lead ${id} ${status}`);
  if (outcome.ok) {
    patchCachedSnapshot((snapshot) => ({
      ...snapshot,
      inbound: snapshot.inbound.map((lead) => (lead.id === id ? { ...lead, status } : lead)),
    }));
  }
  return outcome;
}

export async function publishMagnetEmail(slug: string, email: MagnetEmailWrite): Promise<WriteOutcome> {
  return attempt(() => patchVirtec({ kind: "magnet-email", id: slug, body: email }), `lead magnet email ${slug} ${email.enabled ? "on" : "off"}`);
}
