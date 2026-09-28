import { z } from "zod";

/**
 * Traction — the customer-acquisition record.
 *
 * One question shapes everything here: **how many qualified customer
 * conversations did AgentOS help create this week?** Nothing in this file
 * measures impressions, views or likes. The figures it produces are behaviours
 * that move toward revenue — prospects found, people contacted, follow-ups
 * sent, conversations, proposals, wins.
 *
 * Two rules.
 *
 * **Deterministic numbers.** Every count, queue item and warning is computed
 * from the stored record by plain code. Hermes may interpret the numbers; it
 * never produces them.
 *
 * **No silent sales state.** A prospect only changes stage because a person
 * did something — edited it, or marked a queue item done. Nothing inferred
 * (a Gmail reply, a model's reading of one) moves a prospect on its own.
 */

/** The ISO calendar date, `YYYY-MM-DD`. Dates without times, so "today" never drifts across a timezone. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * A website is rendered as a link, so it must be a real web address.
 *
 * Anything else — `javascript:`, `data:`, a bare word — is refused at the
 * boundary rather than escaped at render time, so no screen can forget to.
 */
export const WebsiteSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Must be an http(s) address");

const Text = (max: number) => z.string().trim().min(1).max(max);

export const ProspectStageSchema = z.enum([
  "target",
  "contacted",
  "conversation",
  "proposal",
  "won",
  "lost",
]);

export const ProspectSourceSchema = z.enum([
  "outbound",
  "referral",
  "website",
  "linkedin",
  "network",
  "other",
]);

export const ProspectFitSchema = z.enum(["high", "medium", "low"]);

/** How warm the relationship is — what decides whether a referral ask is timely. */
export const RelationshipSchema = z.enum(["strong", "active", "cold"]);

/**
 * A prospect, kept deliberately light.
 *
 * This is not a CRM record. It is enough to decide the next action and to say
 * something specific when taking it. `crmId` is the seam for Virtec: when a
 * prospect comes from there, this is its id in that system.
 */
export const ProspectSchema = z.object({
  id: z.string(),
  company: Text(120),
  contact: Text(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  website: WebsiteSchema.optional(),
  segment: Text(80).optional(),
  fit: ProspectFitSchema.optional(),

  stage: ProspectStageSchema,
  source: ProspectSourceSchema,

  nextAction: Text(200).optional(),
  nextActionDate: IsoDateSchema.optional(),

  /** Why this lead, in a few short lines. What makes it worth a message. */
  reasons: z.array(Text(200)).max(6).default([]),
  /**
   * One genuinely specific thing noticed about them — "no viewing-enquiry CTA
   * on mobile property pages". Outreach is not drafted without it.
   */
  observation: Text(500).optional(),
  /** The angle to open with. */
  angle: Text(300).optional(),
  offerId: z.string().optional(),
  experimentId: z.string().optional(),
  notes: z.string().trim().max(4000).optional(),

  relationship: RelationshipSchema.optional(),
  referralAskedAt: z.string().optional(),

  /** The last time a person reached out to them — outreach or follow-up. */
  lastTouchAt: z.string().optional(),
  stageChangedAt: z.string(),

  workspace: z.string().optional(),
  crmId: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

/** What a person may set. Ids, timestamps and history are the server's. */
export const ProspectInputSchema = ProspectSchema.omit({
  id: true,
  stageChangedAt: true,
  createdAt: true,
  updatedAt: true,
  lastTouchAt: true,
  referralAskedAt: true,
}).extend({
  stage: ProspectStageSchema.default("target"),
  source: ProspectSourceSchema.default("outbound"),
});

/**
 * A patch. `null` clears an optional field — `undefined` leaves it alone —
 * because "remove the next action" and "don't touch the next action" are
 * different requests.
 */
export const ProspectPatchSchema = z
  .object({
    company: Text(120),
    contact: Text(120).nullable(),
    email: z.string().trim().email().max(200).nullable(),
    website: WebsiteSchema.nullable(),
    segment: Text(80).nullable(),
    fit: ProspectFitSchema.nullable(),
    stage: ProspectStageSchema,
    source: ProspectSourceSchema,
    nextAction: Text(200).nullable(),
    nextActionDate: IsoDateSchema.nullable(),
    reasons: z.array(Text(200)).max(6),
    observation: Text(500).nullable(),
    angle: Text(300).nullable(),
    offerId: z.string().nullable(),
    experimentId: z.string().nullable(),
    notes: z.string().trim().max(4000).nullable(),
    relationship: RelationshipSchema.nullable(),
    workspace: z.string().nullable(),
    crmId: z.string().nullable(),
  })
  .partial();

/**
 * The one customer profile being tested.
 *
 * Singular on purpose. "Every company that needs software" is not an ICP, and
 * a list of five would let prospecting drift across all of them at once.
 */
export const IcpSchema = z.object({
  name: Text(120),
  offer: Text(400),
  geography: Text(120).optional(),
  idealProspect: z.array(Text(200)).max(8).default([]),
  updatedAt: z.string(),
});

export const IcpInputSchema = IcpSchema.omit({ updatedAt: true });

/** Something Virtara actually sells. Hermes pitches from these and nothing else. */
export const OfferSchema = z.object({
  id: z.string(),
  name: Text(120),
  target: Text(200).optional(),
  problem: Text(500).optional(),
  offer: Text(500),
  /** Free text — "R45,000", "from R12k/month". Not parsed, not summed. */
  startingPrice: Text(60).optional(),
  upsells: z.array(Text(80)).max(10).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const OfferInputSchema = OfferSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const ExperimentStatusSchema = z.enum(["planned", "running", "concluded"]);

export const ExperimentChannelSchema = z.enum([
  "cold_email",
  "linkedin",
  "referrals",
  "seo",
  "partnerships",
  "ads",
  "cold_calling",
  "networking",
  "free_audits",
  "case_studies",
  "content",
  "other",
]);

/**
 * A channel under test.
 *
 * Progress is never typed in. "Contacted" and "conversations" are counted from
 * the prospects tagged with this experiment, so the board cannot disagree with
 * the pipeline — and a channel cannot be declared dead on a feeling.
 */
export const ExperimentSchema = z.object({
  id: z.string(),
  name: Text(120),
  channel: ExperimentChannelSchema,
  hypothesis: Text(500),
  status: ExperimentStatusSchema,
  /** Free text — "R0", "R2,000/month". */
  budget: Text(60).optional(),
  startedOn: IsoDateSchema.optional(),
  endsOn: IsoDateSchema.optional(),
  /** How many people the experiment means to reach. */
  targetContacts: z.number().int().min(0).max(100_000).optional(),
  /** Conversations that would count as success. */
  successConversations: z.number().int().min(0).max(100_000).optional(),
  verdict: Text(500).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ExperimentInputSchema = ExperimentSchema.omit({ id: true, createdAt: true, updatedAt: true });

/** The week's commitment. Behaviours, not vanity metrics. */
export const WeeklyTargetsSchema = z.object({
  newProspects: z.number().int().min(0).max(1000),
  outreach: z.number().int().min(0).max(1000),
  followUps: z.number().int().min(0).max(1000),
  conversations: z.number().int().min(0).max(1000),
  proposals: z.number().int().min(0).max(1000),
});

export const DEFAULT_WEEKLY_TARGETS: WeeklyTargets = {
  newProspects: 25,
  outreach: 20,
  followUps: 10,
  conversations: 5,
  proposals: 2,
};

/**
 * One thing that happened to a prospect. Append-only.
 *
 * The weekly figures are counted from these rather than from current stages,
 * because "3 conversations this week" is about what happened this week — a
 * prospect that reached conversation on Tuesday and proposal on Thursday
 * counts toward both.
 */
export const TractionEventKindSchema = z.enum([
  "created",
  "contacted",
  "followed_up",
  "stage_changed",
  "referral_asked",
  /** A Waiting On item was chased. Counts toward today's queue, not the sales figures. */
  "chased",
]);

export const TractionEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  /** Absent only for a chase of a Waiting On item with no prospect. */
  prospectId: z.string().optional(),
  waitingId: z.string().optional(),
  kind: TractionEventKindSchema,
  from: ProspectStageSchema.optional(),
  to: ProspectStageSchema.optional(),
  /** Done from the daily queue, so today's "3 / 5 complete" can count it. */
  viaQueue: z.boolean().optional(),
});

/** A queue item put off. It reappears on `until`. */
export const SnoozeSchema = z.object({
  itemId: z.string(),
  until: IsoDateSchema,
});

/**
 * Something someone else owes — a deposit, feedback, a reply to a proposal.
 *
 * Not only prospects: a client's deposit is as much a thing to chase as a
 * quote. Either link is optional. When `nextFollowUp` arrives, the item joins
 * the daily queue as a chase; a person marks it resolved when it lands.
 */
export const WaitingOnSchema = z.object({
  id: z.string(),
  /** The person or company. */
  who: Text(120),
  /** What is owed. */
  what: Text(200),
  since: IsoDateSchema,
  nextFollowUp: IsoDateSchema.optional(),
  prospectId: z.string().optional(),
  workspace: z.string().optional(),
  resolvedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WaitingOnInputSchema = z.object({
  who: Text(120),
  what: Text(200),
  since: IsoDateSchema,
  nextFollowUp: IsoDateSchema.optional(),
  prospectId: z.string().optional(),
  workspace: z.string().optional(),
});

/** A Gmail thread a person confirmed belongs to a prospect. */
export const MailLinkSchema = z.object({
  threadId: z.string(),
  prospectId: z.string(),
  linkedAt: z.string(),
});

/** Gmail thread ids are opaque, but always short and URL-safe. */
export const ThreadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const ConfirmMailLinkSchema = z.object({
  threadId: ThreadIdSchema,
  prospectId: z.string(),
  /** A stage move the person confirmed alongside the link. Never inferred server-side. */
  moveTo: ProspectStageSchema.optional(),
});

export const DismissMailSuggestionSchema = z.object({ threadId: ThreadIdSchema });

// ─── Derived: what the server computes and the screen reads ────────────────

export const QueueItemKindSchema = z.enum(["due", "follow_up", "waiting", "referral", "contact"]);

/** One piece of revenue-generating work for today. */
export const QueueItemSchema = z.object({
  /** `${kind}:${prospectId}` (or `waiting:${waitingId}`) — stable across reads, so a snooze sticks. */
  id: z.string(),
  kind: QueueItemKindSchema,
  /** The prospect it is about. Absent only for a Waiting On item with no prospect. */
  prospectId: z.string().optional(),
  waitingId: z.string().optional(),
  title: z.string(),
  /** The one or two plain facts that make it worth doing today. */
  detail: z.array(z.string()),
});

export const AttentionKindSchema = z.enum([
  "uncontacted_targets",
  "stale_proposals",
  "uncontacted_referrals",
  "stalled_conversations",
]);

export const TractionAttentionSchema = z.object({
  kind: AttentionKindSchema,
  count: z.number().int(),
  message: z.string(),
  prospectIds: z.array(z.string()),
});

export const PipelineSchema = z.object({
  target: z.number().int(),
  contacted: z.number().int(),
  conversation: z.number().int(),
  proposal: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
});

export const WeekProgressSchema = z.object({
  /** Monday, `YYYY-MM-DD`. */
  weekOf: IsoDateSchema,
  newProspects: z.number().int(),
  outreach: z.number().int(),
  followUps: z.number().int(),
  conversations: z.number().int(),
  proposals: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  referralsAsked: z.number().int(),
});

export const ExperimentProgressSchema = z.object({
  experimentId: z.string(),
  prospects: z.number().int(),
  contacted: z.number().int(),
  conversations: z.number().int(),
});

/** Where leads come from, and how far they get. */
export const SourceResultSchema = z.object({
  source: ProspectSourceSchema,
  leads: z.number().int(),
  conversations: z.number().int(),
  proposals: z.number().int(),
});

export const ExperimentReviewSchema = z.object({
  experimentId: z.string(),
  name: z.string(),
  contacted: z.number().int(),
  conversations: z.number().int(),
  proposals: z.number().int(),
  /** Conversations over contacted. Undefined when nobody was contacted — not zero. */
  conversationRate: z.number().optional(),
  proposalRate: z.number().optional(),
});

/**
 * The Friday review. Numbers only, all counted — Hermes may read them, it
 * never produces them.
 */
export const WeeklyReviewSchema = z.object({
  week: WeekProgressSchema,
  /** Leads created in the last four weeks, by source. Four weeks, because one week of leads is too few to compare. */
  sources: z.array(SourceResultSchema),
  /** The source with the best conversation rate, from at least two leads. */
  bestSource: ProspectSourceSchema.optional(),
  experiments: z.array(ExperimentReviewSchema),
});

/**
 * A Gmail thread that looks like it belongs to a prospect.
 *
 * A suggestion, never an action: it is shown with a question and changes
 * nothing until a person confirms it.
 */
export const MailSuggestionSchema = z.object({
  threadId: z.string(),
  prospectId: z.string(),
  company: z.string(),
  subject: z.string(),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  messageDate: z.string(),
  /** How it was matched: the prospect's own address, or their website's domain. */
  match: z.enum(["email", "domain"]),
  /** The stage move to offer, when a reply implies one. */
  moveFrom: ProspectStageSchema.optional(),
  moveTo: ProspectStageSchema.optional(),
});

export const LinkedThreadSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  messageDate: z.string(),
  fromName: z.string().optional(),
});

/** Why a prospect cannot have outreach drafted yet. Empty means it can. */
export const OutreachGapSchema = z.enum(["icp", "offer", "website", "observation"]);

export const TractionDataSchema = z.object({
  generatedAt: z.string(),
  today: IsoDateSchema,
  /** Where the prospects came from — `local` until Virtec provides them. */
  provider: z.string(),

  icp: IcpSchema.optional(),
  offers: z.array(OfferSchema),
  prospects: z.array(ProspectSchema),
  experiments: z.array(ExperimentSchema),
  targets: WeeklyTargetsSchema,

  queue: z.array(QueueItemSchema),
  /** Queue items finished today, for "2 / 5 complete". */
  doneToday: z.number().int(),
  attention: z.array(TractionAttentionSchema),
  pipeline: PipelineSchema,
  week: WeekProgressSchema,
  experimentProgress: z.array(ExperimentProgressSchema),
  /** Per prospect: what is missing before outreach may be drafted. */
  outreachGaps: z.record(z.string(), z.array(OutreachGapSchema)),

  /** Open Waiting On items, soonest chase first. Resolved ones are not sent. */
  waiting: z.array(WaitingOnSchema),
  /** Gmail threads that look like prospects' — awaiting a person's yes or no. */
  mailSuggestions: z.array(MailSuggestionSchema),
  /** Per prospect: the Gmail threads confirmed as theirs. */
  mailThreads: z.record(z.string(), z.array(LinkedThreadSchema)),
  reviews: z.object({ thisWeek: WeeklyReviewSchema, lastWeek: WeeklyReviewSchema }),
});

export const QueueActionSchema = z.object({
  action: z.enum(["done", "snooze"]),
  /** Days to put it off. One by default: it comes back tomorrow. */
  days: z.number().int().min(1).max(30).optional(),
});

export type ProspectStage = z.infer<typeof ProspectStageSchema>;
export type ProspectSource = z.infer<typeof ProspectSourceSchema>;
export type ProspectFit = z.infer<typeof ProspectFitSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type Prospect = z.infer<typeof ProspectSchema>;
export type ProspectInput = z.input<typeof ProspectInputSchema>;
export type ProspectPatch = z.infer<typeof ProspectPatchSchema>;
export type Icp = z.infer<typeof IcpSchema>;
export type IcpInput = z.input<typeof IcpInputSchema>;
export type Offer = z.infer<typeof OfferSchema>;
export type OfferInput = z.input<typeof OfferInputSchema>;
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type ExperimentChannel = z.infer<typeof ExperimentChannelSchema>;
export type Experiment = z.infer<typeof ExperimentSchema>;
export type ExperimentInput = z.input<typeof ExperimentInputSchema>;
export type WeeklyTargets = z.infer<typeof WeeklyTargetsSchema>;
export type TractionEventKind = z.infer<typeof TractionEventKindSchema>;
export type TractionEvent = z.infer<typeof TractionEventSchema>;
export type Snooze = z.infer<typeof SnoozeSchema>;
export type QueueItemKind = z.infer<typeof QueueItemKindSchema>;
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type TractionAttention = z.infer<typeof TractionAttentionSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type WeekProgress = z.infer<typeof WeekProgressSchema>;
export type ExperimentProgress = z.infer<typeof ExperimentProgressSchema>;
export type OutreachGap = z.infer<typeof OutreachGapSchema>;
export type WaitingOn = z.infer<typeof WaitingOnSchema>;
export type WaitingOnInput = z.infer<typeof WaitingOnInputSchema>;
export type MailLink = z.infer<typeof MailLinkSchema>;
export type ConfirmMailLink = z.infer<typeof ConfirmMailLinkSchema>;
export type MailSuggestion = z.infer<typeof MailSuggestionSchema>;
export type LinkedThread = z.infer<typeof LinkedThreadSchema>;
export type SourceResult = z.infer<typeof SourceResultSchema>;
export type ExperimentReview = z.infer<typeof ExperimentReviewSchema>;
export type WeeklyReview = z.infer<typeof WeeklyReviewSchema>;
export type TractionData = z.infer<typeof TractionDataSchema>;
export type QueueAction = z.infer<typeof QueueActionSchema>;

export const STAGE_LABELS: Record<ProspectStage, string> = {
  target: "Target",
  contacted: "Contacted",
  conversation: "Conversation",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const SOURCE_LABELS: Record<ProspectSource, string> = {
  outbound: "Outbound",
  referral: "Referral",
  website: "Website",
  linkedin: "LinkedIn",
  network: "Network",
  other: "Other",
};

export const CHANNEL_LABELS: Record<ExperimentChannel, string> = {
  cold_email: "Cold email",
  linkedin: "LinkedIn",
  referrals: "Referral asks",
  seo: "SEO landing pages",
  partnerships: "Partnership outreach",
  ads: "Paid ads",
  cold_calling: "Cold calling",
  networking: "Local networking",
  free_audits: "Free audits",
  case_studies: "Case studies",
  content: "Content / lead magnets",
  other: "Other",
};

export const OUTREACH_GAP_LABELS: Record<OutreachGap, string> = {
  icp: "No active ICP",
  offer: "No offer chosen",
  website: "No website on record",
  observation: "No specific observation",
};
