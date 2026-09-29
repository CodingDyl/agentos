import { LeadMagnetSchema } from "../../shared/lead-magnet-types";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CaseStudySchema,
  CaseStudySourceSchema,
  DEFAULT_WEEKLY_TARGETS,
  ExperimentSchema,
  IcpSchema,
  MailLinkSchema,
  OfferSchema,
  ProspectSchema,
  SnoozeSchema,
  TractionEventSchema,
  WaitingOnSchema,
  WeeklyTargetsSchema,
  type CaseStudy,
  type CaseStudyInput,
  type ConfirmMailLink,
  type Experiment,
  type ExperimentInput,
  type Icp,
  type IcpInput,
  type Offer,
  type OfferInput,
  type Prospect,
  type ProspectInput,
  type ProspectPatch,
  type ProspectStage,
  type QueueItemKind,
  type TractionEvent,
  type TractionEventKind,
  type WaitingOn,
  type WaitingOnInput,
  type WeeklyTargets,
} from "../../shared/traction-types";
import { uiStateDir } from "../agentos/session-store";
import { addDays, isoDate, WAITING_RECHASE_DAYS } from "./engine";

/**
 * The local Traction store — V1's CRM.
 *
 * `~/.agentos-ui/traction`, outside the vault. Prospects are business records,
 * but they are not project truth written by Hermes, and they are expected to
 * move to Virtec: this store is the stand-in behind `CrmProvider` until then.
 *
 * Two files:
 *
 * - `state.json` — the current record (ICP, offers, prospects, experiments,
 *   targets, snoozes), written atomically.
 * - `events.jsonl` — append-only history. The weekly figures are counted from
 *   it, so nothing can revise last week's outreach downward.
 *
 * Every write goes through one in-process queue, so two clicks a moment apart
 * cannot read the same state and lose one another's change.
 *
 * No credentials live here. A prospect holds a contact's name and business
 * email, never a password, token or login.
 */

const StateSchema = z.object({
  version: z.literal(1),
  icp: IcpSchema.optional(),
  offers: z.array(OfferSchema).default([]),
  prospects: z.array(ProspectSchema).default([]),
  experiments: z.array(ExperimentSchema).default([]),
  targets: WeeklyTargetsSchema.default(DEFAULT_WEEKLY_TARGETS),
  snoozes: z.array(SnoozeSchema).default([]),
  waiting: z.array(WaitingOnSchema).default([]),
  mailLinks: z.array(MailLinkSchema).default([]),
  /** Thread ids a person said were not a prospect's. */
  dismissedMail: z.array(z.string()).default([]),
  caseStudies: z.array(CaseStudySchema).default([]),
  /** Finished projects a person said do not need a case study. */
  dismissedOpportunities: z.array(z.string()).default([]),
  leadMagnets: z.array(LeadMagnetSchema).default([]),
});

export type TractionState = z.infer<typeof StateSchema>;

function tractionDir(): string {
  return path.join(uiStateDir(), "traction");
}

function stateFile(): string {
  return path.join(tractionDir(), "state.json");
}

function eventsFile(): string {
  return path.join(tractionDir(), "events.jsonl");
}

function emptyState(): TractionState {
  return {
    version: 1,
    offers: [],
    prospects: [],
    experiments: [],
    targets: DEFAULT_WEEKLY_TARGETS,
    snoozes: [],
    waiting: [],
    mailLinks: [],
    dismissedMail: [],
    caseStudies: [],
    dismissedOpportunities: [],
    leadMagnets: [],
  };
}

export class TractionNotFoundError extends Error {}

/**
 * The current record.
 *
 * A missing file is an empty record. An unreadable one is an error, not an
 * empty record: silently starting over would look exactly like every prospect
 * having been deleted, and the next write would make that true.
 */
export async function readState(): Promise<TractionState> {
  let raw: string;

  try {
    raw = await fs.readFile(stateFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }

  return StateSchema.parse(JSON.parse(raw));
}

async function writeState(state: TractionState): Promise<void> {
  await fs.mkdir(tractionDir(), { recursive: true });
  const target = stateFile();
  const temporary = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

/** Every recorded event, oldest first. An unreadable line is skipped, not fatal. */
export async function readEvents(): Promise<TractionEvent[]> {
  let raw: string;

  try {
    raw = await fs.readFile(eventsFile(), "utf8");
  } catch {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = TractionEventSchema.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
}

async function appendEvents(events: readonly TractionEvent[]): Promise<void> {
  if (events.length === 0) return;
  await fs.mkdir(tractionDir(), { recursive: true });
  await fs.appendFile(eventsFile(), events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs one read-modify-write, after every earlier one has finished.
 *
 * State is written before events: if the process dies between the two, the
 * record is right and one event is missing, which undercounts a week by one.
 * The other order could count outreach that never landed in the record.
 * Every change goes through here, `lead-magnet-store.ts` included.
 */
export function mutate<T>(change: (state: TractionState) => { result: T; events?: TractionEvent[] }): Promise<T> {
  const run = queue.then(async () => {
    const state = await readState();
    const { result, events = [] } = change(state);
    await writeState(state);
    await appendEvents(events);
    return result;
  });

  queue = run.catch(() => undefined);
  return run;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function event(
  prospectId: string,
  kind: TractionEventKind,
  extra: Partial<Pick<TractionEvent, "from" | "to" | "viaQueue">> = {},
): TractionEvent {
  return { id: newId("ev"), at: new Date().toISOString(), prospectId, kind, ...extra };
}

/** Removes `undefined` keys so a stored record never carries empty fields. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function findProspect(state: TractionState, id: string): Prospect {
  const prospect = state.prospects.find((entry) => entry.id === id);
  if (!prospect) throw new TractionNotFoundError(`No prospect ${id}`);
  return prospect;
}

/**
 * The events a stage move implies.
 *
 * Leaving `target` for the first time is outreach, whichever stage it lands
 * on — someone who replied to a message was, necessarily, contacted.
 */
function stageEvents(prospect: Prospect, from: ProspectStage, to: ProspectStage, viaQueue?: boolean): TractionEvent[] {
  if (from === to) return [];
  // One queue completion is one done item: only the first event carries the flag.
  if (from === "target" && to !== "lost") {
    return [event(prospect.id, "contacted", { viaQueue }), event(prospect.id, "stage_changed", { from, to })];
  }
  return [event(prospect.id, "stage_changed", { from, to, viaQueue })];
}

// ─── Prospects ─────────────────────────────────────────────────────────────

function newProspect(input: ProspectInput & { stage: ProspectStage }, now: string): Prospect {
  return ProspectSchema.parse(
    compact({
      ...input,
      id: newId("pr"),
      stageChangedAt: now,
      // Anything past target was reached somehow, even if not through here.
      lastTouchAt: input.stage === "target" ? undefined : now,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export function createProspect(input: ProspectInput & { stage: ProspectStage }): Promise<Prospect> {
  return mutate((state) => {
    const prospect = newProspect(input, new Date().toISOString());
    state.prospects.push(prospect);
    return { result: prospect, events: [event(prospect.id, "created")] };
  });
}

export function updateProspect(id: string, patch: ProspectPatch): Promise<Prospect> {
  return mutate((state) => {
    const existing = findProspect(state, id);
    const now = new Date().toISOString();

    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (value === null) delete merged[key];
      else merged[key] = value;
    }

    const stageMoved = patch.stage !== undefined && patch.stage !== existing.stage;
    if (stageMoved) {
      merged.stageChangedAt = now;
      if (existing.stage === "target") merged.lastTouchAt = now;
    }
    merged.updatedAt = now;

    const next = ProspectSchema.parse(merged);
    state.prospects[state.prospects.indexOf(existing)] = next;

    return { result: next, events: stageMoved ? stageEvents(next, existing.stage, next.stage) : [] };
  });
}

export function deleteProspect(id: string): Promise<void> {
  return mutate((state) => {
    findProspect(state, id);
    state.prospects = state.prospects.filter((prospect) => prospect.id !== id);
    state.snoozes = state.snoozes.filter((snooze) => !snooze.itemId.endsWith(`:${id}`));
    state.mailLinks = state.mailLinks.filter((link) => link.prospectId !== id);
    // What they owed is still owed; it just stops pointing at a record that is gone.
    state.waiting = state.waiting.map((item) => (item.prospectId === id ? { ...item, prospectId: undefined } : item));
    return { result: undefined };
  });
}

// ─── The daily queue ───────────────────────────────────────────────────────

const QUEUE_ITEM =
  /^(?:(due|follow_up|referral|contact):(pr_[A-Za-z0-9]{4,64})|waiting:(wo_[A-Za-z0-9]{4,64})|crm:([A-Za-z0-9_-]{1,128})|case_study:(.+)|inbound:([A-Za-z0-9_-]{1,128}))$/;

type ParsedQueueItem =
  | { kind: Exclude<QueueItemKind, "waiting" | "crm" | "case_study" | "inbound">; prospectId: string }
  | { kind: "inbound"; inboundLeadId: string }
  | { kind: "waiting"; waitingId: string }
  | { kind: "crm"; followUpId: string }
  | { kind: "case_study"; source: string };

export function parseQueueItemId(itemId: string): ParsedQueueItem | undefined {
  const match = QUEUE_ITEM.exec(itemId);
  if (!match) return undefined;
  if (match[3]) return { kind: "waiting", waitingId: match[3] };
  if (match[4]) return { kind: "crm", followUpId: match[4] };
  if (match[6]) return { kind: "inbound", inboundLeadId: match[6] };
  if (match[5]) {
    const source = CaseStudySourceSchema.safeParse(match[5]);
    return source.success ? { kind: "case_study", source: source.data } : undefined;
  }
  return { kind: match[1] as Exclude<QueueItemKind, "waiting" | "crm" | "case_study" | "inbound">, prospectId: match[2] };
}

/** After a Virtec follow-up is handled here, how long before it may reappear if Virtec still has it open. */
export const CRM_HANDLED_DAYS = 3;

/**
 * Marks a queue item done — which means a person did the thing.
 *
 * Each kind has one natural consequence, applied here so the item does not
 * come back tomorrow:
 *
 * - `contact`   → the prospect is now contacted.
 * - `follow_up` → the silence clock restarts.
 * - `due`       → the promised action is cleared, and it counts as first
 *                 contact for a target or a follow-up for anyone further on.
 * - `waiting`   → they were chased; the next chase is set a few days out.
 *                 The item stays open until a person marks it resolved.
 * - `referral`  → the ask is recorded, so it is not asked twice.
 * - `crm`       → a Virtec follow-up was sent. Virtec cannot be written to,
 *                 so it is held off the queue for a few days; mark it sent in
 *                 Virtec and it will not come back.
 *
 * This is the only place the queue changes a stage, and only `target →
 * contacted`, only because the operator said they made contact.
 */
export type QueueCompletion = { prospect?: Prospect; waiting?: WaitingOn };

export function completeQueueItem(itemId: string, today: string = isoDate(new Date())): Promise<QueueCompletion> {
  const parsed = parseQueueItemId(itemId);
  if (!parsed) return Promise.reject(new TractionNotFoundError(`No queue item ${itemId}`));

  return mutate<QueueCompletion>((state) => {
    const now = new Date().toISOString();
    state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== itemId);

    if (parsed.kind === "case_study") {
      // Starting a case study needs the opportunity's details, which live in
      // Virtec and the vault — the route creates it with `startCaseStudy`.
      throw new TractionNotFoundError("Start a case study from its opportunity");
    }

    if (parsed.kind === "inbound") {
      // Replying needs the lead's details from Virtec: the route does it with `replyToInboundLead`.
      throw new TractionNotFoundError("Reply to a website lead through its queue item");
    }

    if (parsed.kind === "crm") {
      state.snoozes.push({ itemId, until: addDays(today, CRM_HANDLED_DAYS) });
      const handled: TractionEvent = { id: newId("ev"), at: now, kind: "followed_up", crmFollowUpId: parsed.followUpId, viaQueue: true };
      return { result: {}, events: [handled] };
    }

    if (parsed.kind === "waiting") {
      const item = findWaiting(state, parsed.waitingId);
      const next: WaitingOn = { ...item, nextFollowUp: addDays(today, WAITING_RECHASE_DAYS), updatedAt: now };
      state.waiting[state.waiting.indexOf(item)] = next;

      const chased: TractionEvent = { id: newId("ev"), at: now, prospectId: item.prospectId, waitingId: item.id, kind: "chased", viaQueue: true };

      // Chasing a prospect is also a follow-up with them, and counts as one.
      const prospect = item.prospectId ? state.prospects.find((entry) => entry.id === item.prospectId) : undefined;
      if (!prospect) return { result: { waiting: next }, events: [chased] };

      const touched: Prospect = { ...prospect, lastTouchAt: now, updatedAt: now };
      state.prospects[state.prospects.indexOf(prospect)] = touched;
      return { result: { waiting: next, prospect: touched }, events: [chased, event(prospect.id, "followed_up")] };
    }

    const prospect = findProspect(state, parsed.prospectId);
    const next: Prospect = { ...prospect, updatedAt: now };

    // A due action on a target is first contact; on anyone else it is a follow-up.
    const kind = parsed.kind === "due" ? (prospect.stage === "target" ? "contact" : "follow_up") : parsed.kind;
    if (parsed.kind === "due") {
      delete next.nextAction;
      delete next.nextActionDate;
    }

    let events: TractionEvent[];

    if (kind === "referral") {
      next.referralAskedAt = now;
      events = [event(prospect.id, "referral_asked", { viaQueue: true })];
    } else if (kind === "contact" && prospect.stage === "target") {
      next.lastTouchAt = now;
      next.stage = "contacted";
      next.stageChangedAt = now;
      events = stageEvents(next, "target", "contacted", true);
    } else {
      next.lastTouchAt = now;
      events = [event(prospect.id, "followed_up", { viaQueue: true })];
    }

    state.prospects[state.prospects.indexOf(prospect)] = next;
    return { result: { prospect: next }, events };
  });
}

/** Puts an item off. It comes back on `today + days`; old snoozes are swept on the way. */
export function snoozeQueueItem(itemId: string, today: string, days = 1): Promise<void> {
  const parsed = parseQueueItemId(itemId);
  if (!parsed) return Promise.reject(new TractionNotFoundError(`No queue item ${itemId}`));

  return mutate((state) => {
    // Virtec follow-ups and case-study opportunities are not held here, so
    // there is nothing local to check.
    if (parsed.kind === "waiting") findWaiting(state, parsed.waitingId);
    else if (parsed.kind !== "crm" && parsed.kind !== "case_study" && parsed.kind !== "inbound") findProspect(state, parsed.prospectId);

    state.snoozes = [
      ...state.snoozes.filter((snooze) => snooze.itemId !== itemId && snooze.until > today),
      { itemId, until: addDays(today, days) },
    ];
    return { result: undefined };
  });
}

// ─── Waiting on ────────────────────────────────────────────────────────────

function findWaiting(state: TractionState, id: string): WaitingOn {
  const item = state.waiting.find((entry) => entry.id === id);
  if (!item) throw new TractionNotFoundError(`No waiting item ${id}`);
  return item;
}

/** A link to a prospect that does not exist is refused, not stored dangling. */
function assertProspectLink(state: TractionState, prospectId: string | undefined): void {
  if (prospectId) findProspect(state, prospectId);
}

export function createWaiting(input: WaitingOnInput): Promise<WaitingOn> {
  return mutate((state) => {
    assertProspectLink(state, input.prospectId);
    const now = new Date().toISOString();
    const item = WaitingOnSchema.parse(compact({ ...input, id: newId("wo"), createdAt: now, updatedAt: now }));
    state.waiting.push(item);
    return { result: item };
  });
}

/** Replaces an item's content. Resolution is its own call, so an edit cannot reopen or close one. */
export function replaceWaiting(id: string, input: WaitingOnInput): Promise<WaitingOn> {
  return mutate((state) => {
    const existing = findWaiting(state, id);
    assertProspectLink(state, input.prospectId);
    const next = WaitingOnSchema.parse(
      compact({ ...input, id, resolvedAt: existing.resolvedAt, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }),
    );
    state.waiting[state.waiting.indexOf(existing)] = next;
    return { result: next };
  });
}

/** It landed. Kept, not deleted, so "how long did the deposit take?" stays answerable. */
export function resolveWaiting(id: string): Promise<WaitingOn> {
  return mutate((state) => {
    const existing = findWaiting(state, id);
    const now = new Date().toISOString();
    const next: WaitingOn = { ...existing, resolvedAt: existing.resolvedAt ?? now, updatedAt: now };
    state.waiting[state.waiting.indexOf(existing)] = next;
    state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== `waiting:${id}`);
    return { result: next };
  });
}

export function deleteWaiting(id: string): Promise<void> {
  return mutate((state) => {
    findWaiting(state, id);
    state.waiting = state.waiting.filter((entry) => entry.id !== id);
    state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== `waiting:${id}`);
    return { result: undefined };
  });
}

// ─── Gmail links ───────────────────────────────────────────────────────────

/**
 * A person said "yes, this thread is theirs" — and, separately, whether to
 * move the stage. The move is only ever what they confirmed; this never
 * infers one.
 */
export function confirmMailLink(input: ConfirmMailLink): Promise<Prospect> {
  return mutate((state) => {
    const prospect = findProspect(state, input.prospectId);
    const now = new Date().toISOString();

    state.mailLinks = [
      ...state.mailLinks.filter((link) => link.threadId !== input.threadId),
      { threadId: input.threadId, prospectId: prospect.id, linkedAt: now },
    ];
    state.dismissedMail = state.dismissedMail.filter((threadId) => threadId !== input.threadId);

    if (!input.moveTo || input.moveTo === prospect.stage) return { result: prospect };

    const next: Prospect = {
      ...prospect,
      stage: input.moveTo,
      stageChangedAt: now,
      lastTouchAt: prospect.stage === "target" ? now : prospect.lastTouchAt,
      updatedAt: now,
    };
    state.prospects[state.prospects.indexOf(prospect)] = next;
    return { result: next, events: stageEvents(next, prospect.stage, input.moveTo) };
  });
}

/** "Not theirs." Remembered, so the same thread is not suggested again. */
export function dismissMailSuggestion(threadId: string): Promise<void> {
  return mutate((state) => {
    if (!state.dismissedMail.includes(threadId)) state.dismissedMail.push(threadId);
    // Bounded: old dismissals of threads long gone from the Inbox are worth nothing.
    state.dismissedMail = state.dismissedMail.slice(-2000);
    return { result: undefined };
  });
}

export function unlinkMailThread(threadId: string): Promise<void> {
  return mutate((state) => {
    state.mailLinks = state.mailLinks.filter((link) => link.threadId !== threadId);
    return { result: undefined };
  });
}

// ─── ICP, offers, experiments, targets ─────────────────────────────────────

export function saveIcp(input: IcpInput): Promise<Icp> {
  return mutate((state) => {
    state.icp = IcpSchema.parse(compact({ ...input, updatedAt: new Date().toISOString() }));
    return { result: state.icp };
  });
}

export function createOffer(input: OfferInput): Promise<Offer> {
  return mutate((state) => {
    const now = new Date().toISOString();
    const offer = OfferSchema.parse(compact({ ...input, id: newId("of"), createdAt: now, updatedAt: now }));
    state.offers.push(offer);
    return { result: offer };
  });
}

/** Replaces an offer's content. A whole form is sent, so a cleared field is cleared. */
export function replaceOffer(id: string, input: OfferInput): Promise<Offer> {
  return mutate((state) => {
    const existing = state.offers.find((offer) => offer.id === id);
    if (!existing) throw new TractionNotFoundError(`No offer ${id}`);
    const { createdAt } = existing;
    const next = OfferSchema.parse(compact({ ...input, id, createdAt, updatedAt: new Date().toISOString() }));
    state.offers[state.offers.indexOf(existing)] = next;
    return { result: next };
  });
}

/** Removes an offer and unlinks it from every prospect that pitched it. */
export function deleteOffer(id: string): Promise<void> {
  return mutate((state) => {
    if (!state.offers.some((offer) => offer.id === id)) throw new TractionNotFoundError(`No offer ${id}`);
    state.offers = state.offers.filter((offer) => offer.id !== id);
    state.prospects = state.prospects.map((prospect) => (prospect.offerId === id ? { ...prospect, offerId: undefined } : prospect));
    return { result: undefined };
  });
}

export function createExperiment(input: ExperimentInput): Promise<Experiment> {
  return mutate((state) => {
    const now = new Date().toISOString();
    const experiment = ExperimentSchema.parse(compact({ ...input, id: newId("ex"), createdAt: now, updatedAt: now }));
    state.experiments.push(experiment);
    return { result: experiment };
  });
}

/** Replaces an experiment's content, the same way offers are. */
export function replaceExperiment(id: string, input: ExperimentInput): Promise<Experiment> {
  return mutate((state) => {
    const existing = state.experiments.find((experiment) => experiment.id === id);
    if (!existing) throw new TractionNotFoundError(`No experiment ${id}`);
    const { createdAt } = existing;
    const next = ExperimentSchema.parse(compact({ ...input, id, createdAt, updatedAt: new Date().toISOString() }));
    state.experiments[state.experiments.indexOf(existing)] = next;
    return { result: next };
  });
}

export function deleteExperiment(id: string): Promise<void> {
  return mutate((state) => {
    if (!state.experiments.some((experiment) => experiment.id === id)) throw new TractionNotFoundError(`No experiment ${id}`);
    state.experiments = state.experiments.filter((experiment) => experiment.id !== id);
    state.prospects = state.prospects.map((prospect) => (prospect.experimentId === id ? { ...prospect, experimentId: undefined } : prospect));
    return { result: undefined };
  });
}

export function saveTargets(targets: WeeklyTargets): Promise<WeeklyTargets> {
  return mutate((state) => {
    state.targets = targets;
    return { result: targets };
  });
}

/**
 * Imports a Virtec lead or client as a prospect, once.
 *
 * The record comes from the adapter's own Virtec read, never from the request,
 * so a caller can name what to import but cannot supply its contents. The
 * duplicate check runs inside the write queue, so two quick clicks import once.
 */
export function importCrmProspect(input: ProspectInput & { crmId: string }): Promise<Prospect> {
  return mutate((state) => {
    if (state.prospects.some((prospect) => prospect.crmId === input.crmId)) {
      throw new TractionConflictError("Already imported");
    }
    const prospect = newProspect({ ...input, stage: input.stage ?? "target" }, new Date().toISOString());
    state.prospects.push(prospect);
    return { result: prospect, events: [event(prospect.id, "created")] };
  });
}

/**
 * "I replied" to a website lead, from the queue.
 *
 * The lead becomes a prospect in conversation (or, if it was already
 * imported, that prospect is used), with the reply counted as today's
 * follow-up. The queue item goes away because the lead is now imported; the
 * route also tells Virtec it was replied to.
 */
export function replyToInboundLead(input: ProspectInput & { crmId: string }, itemId: string): Promise<Prospect> {
  return mutate((state) => {
    const now = new Date().toISOString();
    state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== itemId);

    const existing = state.prospects.find((prospect) => prospect.crmId === input.crmId);
    const events: TractionEvent[] = [];
    let prospect: Prospect;

    if (existing) {
      prospect = { ...existing, lastTouchAt: now, updatedAt: now };
      state.prospects[state.prospects.indexOf(existing)] = prospect;
    } else {
      prospect = { ...newProspect({ ...input, stage: input.stage ?? "conversation" }, now), lastTouchAt: now };
      state.prospects.push(prospect);
      events.push(event(prospect.id, "created"));
    }

    events.push(event(prospect.id, "followed_up", { viaQueue: true }));
    return { result: prospect, events };
  });
}

export class TractionConflictError extends Error {}

// ─── Case studies ──────────────────────────────────────────────────────────

function findCaseStudy(state: TractionState, id: string): CaseStudy {
  const study = state.caseStudies.find((entry) => entry.id === id);
  if (!study) throw new TractionNotFoundError(`No case study ${id}`);
  return study;
}

export function readCaseStudy(id: string): Promise<CaseStudy> {
  return readState().then((state) => findCaseStudy(state, id));
}

/**
 * Starts a case study — from an opportunity, or from nothing.
 *
 * One per source: a finished project gets one case study, and a second
 * request for the same project returns the first rather than a duplicate.
 */
export function startCaseStudy(input: CaseStudyInput, options: { autoTitle?: boolean } = {}): Promise<CaseStudy> {
  return mutate((state) => {
    const existing = input.source ? state.caseStudies.find((study) => study.source === input.source) : undefined;
    if (existing) return { result: existing };

    const now = new Date().toISOString();
    const study = CaseStudySchema.parse(
      compact({ ...input, status: input.status ?? "draft", autoTitle: options.autoTitle || undefined, id: newId("cs"), createdAt: now, updatedAt: now }),
    );
    state.caseStudies.push(study);
    if (input.source) state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== `case_study:${input.source}`);
    return { result: study };
  });
}

/**
 * Replaces a case study's content with what the editor holds.
 *
 * "Ready" and "published" need nothing missing: a study that still says
 * `[NEEDS DATA]` somewhere is not evidence yet, however good the rest reads.
 */
export function replaceCaseStudy(id: string, input: CaseStudyInput): Promise<CaseStudy> {
  return mutate((state) => {
    const existing = findCaseStudy(state, id);
    const next = CaseStudySchema.parse(
      compact({
        ...input,
        status: input.status ?? existing.status,
        id,
        source: existing.source,
        // Once a person has changed the title, it is theirs.
        autoTitle: existing.autoTitle && input.title === existing.title ? true : undefined,
        draftedAt: existing.draftedAt,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }),
    );

    if (next.status !== "draft" && (next.missing.length > 0 || hasGaps(next))) {
      throw new TractionConflictError("A case study with missing data cannot be marked ready or published");
    }

    state.caseStudies[state.caseStudies.indexOf(existing)] = next;
    return { result: next };
  });
}

const GAP = /\[NEEDS DATA/i;

/** Whether any section still holds a `[NEEDS DATA: …]` marker. */
export function hasGaps(study: Pick<CaseStudy, "problem" | "solution" | "implementation" | "result">): boolean {
  return [study.problem, study.solution, study.implementation, study.result].some((section) => section && GAP.test(section));
}

/**
 * Folds a Hermes draft into a case study — into empty sections only.
 *
 * What a person already wrote is never overwritten — the title included,
 * which a draft replaces only while it is still the automatic working title.
 * The draft's list of
 * missing facts is added to, not replaced, so a gap someone noted by hand
 * survives a redraft.
 */
export function applyCaseStudyDraft(
  id: string,
  draft: Partial<Pick<CaseStudy, "title" | "problem" | "solution" | "implementation" | "result">> & { missing: string[] },
): Promise<CaseStudy> {
  return mutate((state) => {
    const existing = findCaseStudy(state, id);
    const now = new Date().toISOString();
    const fill = (current: string | undefined, proposed: string | undefined) => (current && current.trim() ? current : proposed);

    const next = CaseStudySchema.parse(
      compact({
        ...existing,
        title: existing.autoTitle && draft.title ? draft.title : existing.title,
        autoTitle: existing.autoTitle && draft.title ? undefined : existing.autoTitle,
        problem: fill(existing.problem, draft.problem),
        solution: fill(existing.solution, draft.solution),
        implementation: fill(existing.implementation, draft.implementation),
        result: fill(existing.result, draft.result),
        missing: [...new Set([...existing.missing, ...draft.missing])].slice(0, 20),
        draftedAt: now,
        updatedAt: now,
      }),
    );

    state.caseStudies[state.caseStudies.indexOf(existing)] = next;
    return { result: next };
  });
}

export function deleteCaseStudy(id: string): Promise<void> {
  return mutate((state) => {
    findCaseStudy(state, id);
    state.caseStudies = state.caseStudies.filter((study) => study.id !== id);
    return { result: undefined };
  });
}

/** "This one does not need a case study." Remembered, so it is not raised again. */
export function dismissOpportunity(source: string): Promise<void> {
  return mutate((state) => {
    if (!state.dismissedOpportunities.includes(source)) state.dismissedOpportunities.push(source);
    state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== `case_study:${source}`);
    return { result: undefined };
  });
}
