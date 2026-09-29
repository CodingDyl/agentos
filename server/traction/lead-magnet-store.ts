import {
  leadMagnetBlockers,
  LeadMagnetInputSchema,
  LeadMagnetSchema,
  slugFromTitle,
  type LeadMagnet,
  type LeadMagnetInput,
  type NewLeadMagnet,
} from "../../shared/lead-magnet-types";
import { ExperimentSchema, type Experiment } from "../../shared/traction-types";
import { compact, mutate, newId, readState, TractionConflictError, TractionNotFoundError, type TractionState } from "./store";

/**
 * Lead magnets in the Traction store. Same file, same write queue as the
 * rest of Traction; kept apart only so `store.ts` stays readable.
 */

function findMagnet(state: TractionState, id: string): LeadMagnet {
  const magnet = state.leadMagnets.find((entry) => entry.id === id);
  if (!magnet) throw new TractionNotFoundError(`No lead magnet ${id}`);
  return magnet;
}

export function readLeadMagnet(id: string): Promise<LeadMagnet> {
  return readState().then((state) => findMagnet(state, id));
}

/**
 * A slug no other magnet uses. Slugs are unique across both sites, because
 * the signup source `magnet-<slug>` is what tells magnets apart in Virtec.
 */
function freeSlug(state: TractionState, wanted: string, except?: string): string {
  const taken = new Set(state.leadMagnets.filter((magnet) => magnet.id !== except).map((magnet) => magnet.slug));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${wanted.slice(0, 32 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new TractionConflictError("No free slug; choose another");
}

/** Links point at records that exist, or at nothing. */
function checkedLinks(state: TractionState, input: { offerId?: string; experimentId?: string }) {
  return {
    offerId: input.offerId && state.offers.some((offer) => offer.id === input.offerId) ? input.offerId : undefined,
    experimentId: input.experimentId && state.experiments.some((experiment) => experiment.id === input.experimentId) ? input.experimentId : undefined,
  };
}

export function createLeadMagnet(input: NewLeadMagnet): Promise<LeadMagnet> {
  return mutate((state) => {
    const now = new Date().toISOString();
    const magnet = LeadMagnetSchema.parse(
      compact({
        id: newId("lm"),
        track: input.track,
        format: input.format,
        title: input.title,
        slug: freeSlug(state, input.slug ?? slugFromTitle(input.title)),
        status: "draft",
        ...checkedLinks(state, input),
        createdAt: now,
        updatedAt: now,
      }),
    );
    state.leadMagnets.push(magnet);
    return { result: magnet };
  });
}

/**
 * Replaces a magnet with what the editor holds.
 *
 * Ready and live need nothing blocking (`leadMagnetBlockers`). Once live, the
 * slug and site are fixed: both are in the published URL and in every
 * signup Virtec has recorded, so changing them would orphan both.
 */
export function replaceLeadMagnet(id: string, raw: LeadMagnetInput): Promise<LeadMagnet> {
  const input = LeadMagnetInputSchema.parse(raw);

  return mutate((state) => {
    const existing = findMagnet(state, id);

    if (existing.status === "live" && (input.slug !== existing.slug || input.track !== existing.track)) {
      throw new TractionConflictError("A live lead magnet keeps its slug and site; make a new one instead");
    }
    if (input.slug !== existing.slug && freeSlug(state, input.slug, id) !== input.slug) {
      throw new TractionConflictError(`Another lead magnet already uses the slug "${input.slug}"`);
    }

    const next = LeadMagnetSchema.parse(
      compact({
        ...input,
        ...checkedLinks(state, input),
        id,
        draftedAt: existing.draftedAt,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }),
    );

    if (next.status !== "draft") {
      const blockers = leadMagnetBlockers(next);
      if (blockers.length > 0) throw new TractionConflictError(`Not ready yet: ${blockers.join("; ")}`);
    }

    state.leadMagnets[state.leadMagnets.indexOf(existing)] = next;
    return { result: next };
  });
}

export type LeadMagnetDraft = Partial<
  Pick<LeadMagnet, "title" | "promise" | "audience" | "headline" | "subhead" | "cta" | "seoTitle" | "seoDescription" | "nextStep">
> & {
  bullets: string[];
  sections: LeadMagnet["sections"];
  missing: string[];
};

/**
 * Folds a Hermes draft into a magnet: into empty fields only.
 *
 * What a person wrote is never replaced. Bullets and sections are taken as a
 * set, only when the magnet has none, so a draft never interleaves with
 * someone's own outline. Missing facts are added to, never cleared.
 */
export function applyLeadMagnetDraft(id: string, draft: LeadMagnetDraft): Promise<LeadMagnet> {
  return mutate((state) => {
    const existing = findMagnet(state, id);
    const now = new Date().toISOString();
    const fill = (current: string | undefined, proposed: string | undefined) => (current && current.trim() ? current : proposed);

    const next = LeadMagnetSchema.parse(
      compact({
        ...existing,
        promise: fill(existing.promise, draft.promise),
        audience: fill(existing.audience, draft.audience),
        headline: fill(existing.headline, draft.headline),
        subhead: fill(existing.subhead, draft.subhead),
        cta: fill(existing.cta, draft.cta),
        seoTitle: fill(existing.seoTitle, draft.seoTitle),
        seoDescription: fill(existing.seoDescription, draft.seoDescription),
        nextStep: fill(existing.nextStep, draft.nextStep),
        bullets: existing.bullets.length > 0 ? existing.bullets : draft.bullets,
        sections: existing.sections.length > 0 ? existing.sections : draft.sections,
        missing: [...new Set([...existing.missing, ...draft.missing])].slice(0, 20),
        draftedAt: now,
        updatedAt: now,
      }),
    );

    state.leadMagnets[state.leadMagnets.indexOf(existing)] = next;
    return { result: next };
  });
}

export function deleteLeadMagnet(id: string): Promise<void> {
  return mutate((state) => {
    const magnet = findMagnet(state, id);
    if (magnet.status === "live") throw new TractionConflictError("Take it off the site and set it back to draft before deleting it");
    state.leadMagnets = state.leadMagnets.filter((entry) => entry.id !== id);
    return { result: undefined };
  });
}

/**
 * Starts an experiment that tracks this magnet, and links the two.
 *
 * The experiment is planned, on the content channel, with a hypothesis the
 * person is expected to sharpen. Signups taken into Traction are tagged with
 * it, so its contacted and conversation counts come from real prospects.
 */
export function startLeadMagnetExperiment(id: string): Promise<{ magnet: LeadMagnet; experiment: Experiment }> {
  return mutate((state) => {
    const magnet = findMagnet(state, id);
    const linked = magnet.experimentId ? state.experiments.find((entry) => entry.id === magnet.experimentId) : undefined;
    if (linked) return { result: { magnet, experiment: linked } };

    const now = new Date().toISOString();
    const experiment = ExperimentSchema.parse({
      id: newId("ex"),
      name: `Lead magnet: ${magnet.title}`.slice(0, 120),
      channel: "content",
      hypothesis: `If ${magnet.audience ?? "the people we serve"} can get "${magnet.title}" free, enough will download it and reply to a follow-up to start at least 3 conversations in 30 days.`.slice(0, 500),
      status: "planned",
      successConversations: 3,
      createdAt: now,
      updatedAt: now,
    });
    const next: LeadMagnet = { ...magnet, experimentId: experiment.id, updatedAt: now };

    state.experiments.push(experiment);
    state.leadMagnets[state.leadMagnets.indexOf(magnet)] = next;
    return { result: { magnet: next, experiment } };
  });
}
