import type { LeadMagnet } from "../../shared/lead-magnet-types";
import { HermesError, sendToHermes } from "../hermes/client";
import { extractJson } from "../hermes/worker-review";
import { applyLeadMagnetDraft, readLeadMagnet } from "./lead-magnet-store";
import { buildLeadMagnetPacket, readLeadMagnetDraft } from "./lead-magnets";
import { readState } from "./store";

/** A whole resource plus its landing page is a long reply. */
const DRAFT_TIMEOUT_MS = 150_000;

export class LeadMagnetDraftError extends Error {}

/**
 * Asks Hermes to draft a lead magnet, and folds the answer into empty fields.
 *
 * Runs only when asked, writes only into AgentOS's own store, and never
 * replaces what a person wrote.
 */
export async function draftLeadMagnet(id: string): Promise<LeadMagnet> {
  const magnet = await readLeadMagnet(id);
  const state = await readState();
  const offer = magnet.offerId ? state.offers.find((entry) => entry.id === magnet.offerId) : undefined;

  let reply: string;
  try {
    reply = await sendToHermes(buildLeadMagnetPacket({ magnet, icp: state.icp, offer }), { operation: "other", timeoutMs: DRAFT_TIMEOUT_MS });
  } catch (error) {
    throw new LeadMagnetDraftError(error instanceof HermesError ? error.message : "Hermes could not be reached.");
  }

  const draft = readLeadMagnetDraft(extractJson(reply));
  if (!draft) throw new LeadMagnetDraftError("Hermes answered, but not with a lead magnet AgentOS could read.");

  return applyLeadMagnetDraft(id, draft);
}
