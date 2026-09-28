import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_WEEKLY_TARGETS,
  ExperimentSchema,
  IcpSchema,
  OfferSchema,
  ProspectSchema,
  SnoozeSchema,
  TractionEventSchema,
  WeeklyTargetsSchema,
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
  type WeeklyTargets,
} from "../../shared/traction-types";
import { uiStateDir } from "../agentos/session-store";
import { addDays } from "./engine";

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
  return { version: 1, offers: [], prospects: [], experiments: [], targets: DEFAULT_WEEKLY_TARGETS, snoozes: [] };
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
 */
function mutate<T>(change: (state: TractionState) => { result: T; events?: TractionEvent[] }): Promise<T> {
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

function newId(prefix: string): string {
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
function compact<T extends object>(value: T): T {
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

export function createProspect(input: ProspectInput & { stage: ProspectStage }): Promise<Prospect> {
  return mutate((state) => {
    const now = new Date().toISOString();
    const prospect = ProspectSchema.parse(
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
    return { result: undefined };
  });
}

// ─── The daily queue ───────────────────────────────────────────────────────

const QUEUE_ITEM = /^(due|follow_up|referral|contact):(pr_[A-Za-z0-9]{4,64})$/;

export function parseQueueItemId(itemId: string): { kind: QueueItemKind; prospectId: string } | undefined {
  const match = QUEUE_ITEM.exec(itemId);
  return match ? { kind: match[1] as QueueItemKind, prospectId: match[2] } : undefined;
}

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
 * - `referral`  → the ask is recorded, so it is not asked twice.
 *
 * This is the only place the queue changes a stage, and only `target →
 * contacted`, only because the operator said they made contact.
 */
export function completeQueueItem(itemId: string): Promise<Prospect> {
  const parsed = parseQueueItemId(itemId);
  if (!parsed) return Promise.reject(new TractionNotFoundError(`No queue item ${itemId}`));

  return mutate((state) => {
    const prospect = findProspect(state, parsed.prospectId);
    const now = new Date().toISOString();
    const next: Prospect = { ...prospect, updatedAt: now };
    let events: TractionEvent[];

    // A due action on a target is first contact; on anyone else it is a follow-up.
    const kind = parsed.kind === "due" ? (prospect.stage === "target" ? "contact" : "follow_up") : parsed.kind;
    if (parsed.kind === "due") {
      delete next.nextAction;
      delete next.nextActionDate;
    }

    switch (kind) {
      case "contact":
        next.lastTouchAt = now;
        if (prospect.stage === "target") {
          next.stage = "contacted";
          next.stageChangedAt = now;
          events = stageEvents(next, "target", "contacted", true);
        } else {
          events = [event(prospect.id, "followed_up", { viaQueue: true })];
        }
        break;
      case "follow_up":
        next.lastTouchAt = now;
        events = [event(prospect.id, "followed_up", { viaQueue: true })];
        break;
      case "referral":
        next.referralAskedAt = now;
        events = [event(prospect.id, "referral_asked", { viaQueue: true })];
        break;
    }

    state.prospects[state.prospects.indexOf(prospect)] = next;
    state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== itemId);
    return { result: next, events };
  });
}

/** Puts an item off. It comes back on `today + days`; old snoozes are swept on the way. */
export function snoozeQueueItem(itemId: string, today: string, days = 1): Promise<void> {
  const parsed = parseQueueItemId(itemId);
  if (!parsed) return Promise.reject(new TractionNotFoundError(`No queue item ${itemId}`));

  return mutate((state) => {
    findProspect(state, parsed.prospectId);
    state.snoozes = [
      ...state.snoozes.filter((snooze) => snooze.itemId !== itemId && snooze.until > today),
      { itemId, until: addDays(today, days) },
    ];
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
