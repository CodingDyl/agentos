import express from "express";
import {
  CaseStudyInputSchema,
  StartFromOpportunitySchema,
  DismissOpportunitySchema,
  CrmImportSchema,
  ScanCandidatesSchema,
  ConfirmMailLinkSchema,
  DismissMailSuggestionSchema,
  ExperimentInputSchema,
  IcpInputSchema,
  OfferInputSchema,
  ProspectInputSchema,
  ProspectPatchSchema,
  QueueActionSchema,
  ThreadIdSchema,
  WaitingOnInputSchema,
  WeeklyTargetsSchema,
} from "../../shared/traction-types";
import { readThreadSummary } from "../mail/store";
import { isVirtecConfigured, isVirtecWritable } from "../virtec/client";
import { dismissFollowUp, markFollowUpSent, setInboundLeadStatus, setLeadStatus, snoozeFollowUp, type WriteOutcome } from "../virtec/writes";
import { getVirtecSnapshot } from "../virtec/snapshot";
import { getScanInfo, requestsFor, runScan } from "../virtec/scan";
import { buildCrmView, clientToProspect, currentProfile, inboundToProspect, leadToProspect } from "./crm";
import { icpKey, PROFILE_BATCH, PROFILE_DAILY_CAP, profilingBlocker, runProfiling } from "./lead-profile";
import { CaseStudySiteError, readCaseStudyWebsite } from "./case-study-site";
import { draftCaseStudy } from "./case-study-draft";
import { magnetForLead } from "./lead-magnets";
import { leadMagnetRouter } from "./lead-magnet-routes";
import { fail, parse } from "./route-helpers";
import { caseStudyFiles, exportFilename } from "./case-study-export";
import { buildZip } from "./zip";
import { findStoredAsset } from "../designs/library";
import { currentOpportunities } from "./traction";
import { isoDate } from "./engine";
import {
  completeQueueItem,
  confirmMailLink,
  deleteCaseStudy,
  dismissOpportunity,
  readCaseStudy,
  replaceCaseStudy,
  startCaseStudy,
  createExperiment,
  createOffer,
  createProspect,
  createWaiting,
  deleteExperiment,
  deleteOffer,
  deleteProspect,
  deleteWaiting,
  dismissMailSuggestion,
  replaceExperiment,
  replaceOffer,
  replaceWaiting,
  resolveWaiting,
  saveIcp,
  saveTargets,
  snoozeQueueItem,
  importCrmProspect,
  readState,
  replyToInboundLead,
  saveLeadProfiles,
  unlinkMailThread,
  updateProspect,
} from "./store";
import { getTraction } from "./traction";

/**
 * `/api/traction`.
 *
 * A separate router rather than more lines in `server/index.ts`: Traction is
 * a module with its own store, and its routes belong beside it.
 *
 * Every body is parsed with the shared schema before it reaches the store, and
 * every id in a path is matched against records the store already holds —
 * nothing a request sends becomes a file path.
 *
 * Nothing here sends anything. Outreach is drafted and sent by a person; these
 * routes only record what they did.
 */
export const tractionRouter = express.Router();

tractionRouter.use("/lead-magnets", leadMagnetRouter);



tractionRouter.get("/", async (_request, response) => {
  try {
    response.json(await getTraction());
  } catch (error) {
    fail(response, error, "read Traction");
  }
});

tractionRouter.post("/prospects", async (request, response) => {
  const input = parse(ProspectInputSchema, request.body, response, "prospect");
  if (!input) return;

  try {
    response.status(201).json({ prospect: await createProspect(input) });
  } catch (error) {
    fail(response, error, "add the prospect");
  }
});

tractionRouter.patch("/prospects/:id", async (request, response) => {
  const patch = parse(ProspectPatchSchema, request.body, response, "prospect change");
  if (!patch) return;

  try {
    response.json({ prospect: await updateProspect(request.params.id, patch) });
  } catch (error) {
    fail(response, error, "update the prospect");
  }
});

tractionRouter.delete("/prospects/:id", async (request, response) => {
  try {
    await deleteProspect(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the prospect");
  }
});

function crmFollowUpId(itemId: string): string | undefined {
  const match = /^crm:([A-Za-z0-9_-]{1,128})$/.exec(itemId);
  return match?.[1];
}

/** The start of the day the snooze ends on — when AgentOS's own snooze lets the item back. */
function snoozeEnd(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

/** A person did the thing (`done`), or put it off (`snooze`). */
tractionRouter.post("/queue/:itemId", async (request, response) => {
  const action = parse(QueueActionSchema, request.body, response, "queue action");
  if (!action) return;

  try {
    if (action.action === "done" && request.params.itemId.startsWith("case_study:")) {
      // "Done" on an opportunity means "start it": the study is created from
      // the opportunity as it stands now, never from anything in the request.
      const source = request.params.itemId.slice("case_study:".length);
      const opportunity = (await currentOpportunities()).find((entry) => entry.source === source);
      if (!opportunity) {
        response.status(404).json({ error: "No such case-study opportunity" });
        return;
      }
      response.json({ caseStudy: await startFromOpportunity(opportunity) });
    } else if (action.action === "done" && /^(inbound|second_touch):/.test(request.params.itemId)) {
      // "Done" on a website lead means a person wrote to them: a reply, or
      // the second touch after a lead magnet. Either way they become a
      // prospect built from Virtec's copy of the lead, and Virtec is told.
      const secondTouch = request.params.itemId.startsWith("second_touch:");
      const id = request.params.itemId.slice(request.params.itemId.indexOf(":") + 1);
      const lead = (await getVirtecSnapshot()).inbound.find((entry) => entry.id === id);
      if (!lead) {
        response.status(404).json({ error: "No such website lead in Virtec" });
        return;
      }
      const magnet = magnetForLead((await readState()).leadMagnets, lead);
      const mapped = inboundToProspect(lead, isoDate(new Date()), true, magnet);
      const prospect = await replyToInboundLead({ ...mapped, crmId: mapped.crmId as string }, request.params.itemId, secondTouch ? "second_touch" : "reply");
      const virtec = isVirtecWritable() ? await setInboundLeadStatus(lead.id, "replied") : undefined;
      response.json({ prospect, virtec });
    } else if (action.action === "done") {
      const result = await completeQueueItem(request.params.itemId);
      // A Virtec follow-up handled here is marked sent there too, when
      // write-back is on. Its outcome is reported, never swallowed.
      const followUpId = crmFollowUpId(request.params.itemId);
      const virtec = followUpId && isVirtecWritable() ? await markFollowUpSent(followUpId) : undefined;
      response.json({ ...result, virtec });
    } else {
      const days = action.days ?? 1;
      await snoozeQueueItem(request.params.itemId, isoDate(new Date()), days);
      const followUpId = crmFollowUpId(request.params.itemId);
      const virtec = followUpId && isVirtecWritable() ? await snoozeFollowUp(followUpId, snoozeEnd(days)) : undefined;
      response.json({ ok: true, virtec });
    }
  } catch (error) {
    fail(response, error, "update the queue");
  }
});

tractionRouter.put("/icp", async (request, response) => {
  const input = parse(IcpInputSchema, request.body, response, "ICP");
  if (!input) return;

  try {
    response.json({ icp: await saveIcp(input) });
  } catch (error) {
    fail(response, error, "save the ICP");
  }
});

tractionRouter.put("/targets", async (request, response) => {
  const input = parse(WeeklyTargetsSchema, request.body, response, "weekly targets");
  if (!input) return;

  try {
    response.json({ targets: await saveTargets(input) });
  } catch (error) {
    fail(response, error, "save the weekly targets");
  }
});

tractionRouter.post("/offers", async (request, response) => {
  const input = parse(OfferInputSchema, request.body, response, "offer");
  if (!input) return;

  try {
    response.status(201).json({ offer: await createOffer(input) });
  } catch (error) {
    fail(response, error, "add the offer");
  }
});

tractionRouter.put("/offers/:id", async (request, response) => {
  const input = parse(OfferInputSchema, request.body, response, "offer");
  if (!input) return;

  try {
    response.json({ offer: await replaceOffer(request.params.id, input) });
  } catch (error) {
    fail(response, error, "update the offer");
  }
});

tractionRouter.delete("/offers/:id", async (request, response) => {
  try {
    await deleteOffer(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the offer");
  }
});

tractionRouter.post("/experiments", async (request, response) => {
  const input = parse(ExperimentInputSchema, request.body, response, "experiment");
  if (!input) return;

  try {
    response.status(201).json({ experiment: await createExperiment(input) });
  } catch (error) {
    fail(response, error, "add the experiment");
  }
});

tractionRouter.put("/experiments/:id", async (request, response) => {
  const input = parse(ExperimentInputSchema, request.body, response, "experiment");
  if (!input) return;

  try {
    response.json({ experiment: await replaceExperiment(request.params.id, input) });
  } catch (error) {
    fail(response, error, "update the experiment");
  }
});

tractionRouter.delete("/experiments/:id", async (request, response) => {
  try {
    await deleteExperiment(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the experiment");
  }
});

tractionRouter.post("/waiting", async (request, response) => {
  const input = parse(WaitingOnInputSchema, request.body, response, "waiting item");
  if (!input) return;

  try {
    response.status(201).json({ waiting: await createWaiting(input) });
  } catch (error) {
    fail(response, error, "add the waiting item");
  }
});

tractionRouter.put("/waiting/:id", async (request, response) => {
  const input = parse(WaitingOnInputSchema, request.body, response, "waiting item");
  if (!input) return;

  try {
    response.json({ waiting: await replaceWaiting(request.params.id, input) });
  } catch (error) {
    fail(response, error, "update the waiting item");
  }
});

/** It landed. */
tractionRouter.post("/waiting/:id/resolve", async (request, response) => {
  try {
    response.json({ waiting: await resolveWaiting(request.params.id) });
  } catch (error) {
    fail(response, error, "resolve the waiting item");
  }
});

tractionRouter.delete("/waiting/:id", async (request, response) => {
  try {
    await deleteWaiting(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the waiting item");
  }
});

/**
 * Confirms that a Gmail thread belongs to a prospect, and optionally the stage
 * move that goes with it. The thread must be one the Inbox has actually
 * cached — an id the adapter has never seen is refused rather than stored.
 */
tractionRouter.post("/mail-links", async (request, response) => {
  const input = parse(ConfirmMailLinkSchema, request.body, response, "mail link");
  if (!input) return;

  try {
    if (!readThreadSummary(input.threadId)) {
      response.status(404).json({ error: "No such thread in the Inbox" });
      return;
    }
    response.json({ prospect: await confirmMailLink(input) });
  } catch (error) {
    fail(response, error, "link the thread");
  }
});

tractionRouter.post("/mail-links/dismiss", async (request, response) => {
  const input = parse(DismissMailSuggestionSchema, request.body, response, "dismissal");
  if (!input) return;

  try {
    await dismissMailSuggestion(input.threadId);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "dismiss the suggestion");
  }
});

tractionRouter.delete("/mail-links/:threadId", async (request, response) => {
  const threadId = ThreadIdSchema.safeParse(request.params.threadId);
  if (!threadId.success) {
    response.status(400).json({ error: "Invalid thread id" });
    return;
  }

  try {
    await unlinkMailThread(threadId.data);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "unlink the thread");
  }
});

/** Reads Virtec again now, instead of waiting out the cache. */
tractionRouter.post("/crm/refresh", async (_request, response) => {
  if (!isVirtecConfigured()) {
    response.status(409).json({ error: "Virtec is not configured" });
    return;
  }

  try {
    const snapshot = await getVirtecSnapshot({ fresh: true });
    response.json({ fetchedAt: snapshot.fetchedAt, sources: snapshot.sources });
  } catch (error) {
    fail(response, error, "refresh Virtec");
  }
});

/**
 * Imports one Virtec lead or client as a prospect.
 *
 * The request names the record; its contents come from the adapter's own
 * Virtec read. An id Virtec did not return is a 404, a second import a 409.
 */
tractionRouter.post("/crm/import", async (request, response) => {
  const input = parse(CrmImportSchema, request.body, response, "import");
  if (!input) return;

  if (!isVirtecConfigured()) {
    response.status(409).json({ error: "Virtec is not configured" });
    return;
  }

  try {
    const snapshot = await getVirtecSnapshot();
    const lead = input.kind === "lead" ? snapshot.leads.find((entry) => entry.id === input.id) : undefined;
    const client = input.kind === "client" ? snapshot.clients.find((entry) => entry.id === input.id) : undefined;
    const inbound = input.kind === "inbound" ? snapshot.inbound.find((entry) => entry.id === input.id) : undefined;
    const state = await readState();
    const profile = lead ? currentProfile({ icpKey: state.icp ? icpKey(state.icp) : undefined, byCrmId: state.leadProfiles }, lead.id) : undefined;
    const mapped = lead
      ? leadToProspect(lead, profile, state.icp?.name)
      : client
        ? clientToProspect(client)
        : inbound
          ? inboundToProspect(inbound, isoDate(new Date()), false, magnetForLead((await readState()).leadMagnets, inbound))
          : undefined;

    if (!mapped?.crmId) {
      response.status(404).json({ error: `No such ${input.kind} in Virtec` });
      return;
    }

    const prospect = await importCrmProspect({ ...mapped, crmId: mapped.crmId });
    // Taking a new lead into Traction is reviewing it; Virtec is told so.
    const virtec: WriteOutcome | undefined = !isVirtecWritable()
      ? undefined
      : lead && (lead.status === undefined || lead.status === "new")
        ? await setLeadStatus(lead.id, "reviewing")
        : inbound && (inbound.status === undefined || inbound.status === "new")
          ? await setInboundLeadStatus(inbound.id, "reviewing")
          : undefined;
    response.status(201).json({ prospect, virtec });
  } catch (error) {
    fail(response, error, "import from Virtec");
  }
});

function startFromOpportunity(opportunity: Awaited<ReturnType<typeof currentOpportunities>>[number]) {
  return startCaseStudy(
    {
      title: `${opportunity.client}: ${opportunity.title}`,
      client: opportunity.client,
      source: opportunity.source,
      workspace: opportunity.workspace,
    },
    { autoTitle: true },
  );
}

/**
 * Starts a case study: from an opportunity (by its source), or blank.
 *
 * From an opportunity, the details come from the adapter's own reading of
 * Virtec and the portfolio; the request only names which one.
 */
tractionRouter.post("/case-studies", async (request, response) => {
  const from = StartFromOpportunitySchema.safeParse(request.body ?? {});

  try {
    if (from.success) {
      const opportunity = (await currentOpportunities()).find((entry) => entry.source === from.data.fromOpportunity);
      if (!opportunity) {
        response.status(404).json({ error: "No such case-study opportunity" });
        return;
      }
      response.status(201).json({ caseStudy: await startFromOpportunity(opportunity) });
      return;
    }

    const input = parse(CaseStudyInputSchema, request.body, response, "case study");
    if (!input) return;
    response.status(201).json({ caseStudy: await startCaseStudy(input) });
  } catch (error) {
    fail(response, error, "start the case study");
  }
});

tractionRouter.put("/case-studies/:id", async (request, response) => {
  const input = parse(CaseStudyInputSchema, request.body, response, "case study");
  if (!input) return;

  try {
    // Only images Creative actually holds, and only stills: an id that names
    // nothing is refused here rather than exported as a broken link later.
    for (const assetId of input.assetIds ?? []) {
      const asset = await findStoredAsset(assetId);
      if (!asset || asset.mediaType === "video") {
        response.status(400).json({ error: `No image ${assetId} in Creative` });
        return;
      }
    }

    response.json({ caseStudy: await replaceCaseStudy(request.params.id, input) });
  } catch (error) {
    fail(response, error, "save the case study");
  }
});

tractionRouter.delete("/case-studies/:id", async (request, response) => {
  try {
    await deleteCaseStudy(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the case study");
  }
});

/** Reads the study's saved client website (public sites only) and keeps the facts. Nothing else changes. */
tractionRouter.post("/case-studies/:id/read-website", async (request, response) => {
  try {
    response.json({ caseStudy: await readCaseStudyWebsite(request.params.id) });
  } catch (error) {
    if (error instanceof CaseStudySiteError) {
      response.status(422).json({ error: error.message });
      return;
    }
    fail(response, error, "read the website");
  }
});

/** One Hermes call, on request. Fills empty sections only. */
tractionRouter.post("/case-studies/:id/draft", async (request, response) => {
  try {
    response.json({ caseStudy: await draftCaseStudy(request.params.id) });
  } catch (error) {
    fail(response, error, "draft the case study");
  }
});

/**
 * Asks for the client's words by putting the ask on Waiting On.
 *
 * The testimonial is the one section no model may write, so the only thing
 * AgentOS can do is make sure the ask is not forgotten.
 */
tractionRouter.post("/case-studies/:id/testimonial-request", async (request, response) => {
  try {
    const study = await readCaseStudy(request.params.id);
    const today = isoDate(new Date());
    response.status(201).json({
      waiting: await createWaiting({
        who: study.client,
        what: `Testimonial for the “${study.title.slice(0, 120)}” case study`.slice(0, 200),
        since: today,
        workspace: study.workspace,
      }),
    });
  } catch (error) {
    fail(response, error, "request the testimonial");
  }
});

tractionRouter.post("/case-studies/dismiss", async (request, response) => {
  const input = parse(DismissOpportunitySchema, request.body, response, "dismissal");
  if (!input) return;

  try {
    await dismissOpportunity(input.source);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "dismiss the opportunity");
  }
});

const LeadIdSchema = CrmImportSchema.shape.id;

/** "Not a fit": marks a Virtec lead disqualified, so neither system offers it again. */
tractionRouter.post("/crm/leads/:id/not-a-fit", async (request, response) => {
  const id = LeadIdSchema.safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: "Invalid lead id" });
    return;
  }
  if (!isVirtecWritable()) {
    response.status(409).json({ error: "Write-back to Virtec is off (VIRTEC_WRITE_API_KEY is not set)" });
    return;
  }

  const outcome = await setLeadStatus(id.data, "disqualified");
  if (outcome.ok) response.json({ ok: true });
  else response.status(502).json({ error: outcome.error });
});

/** What a scan can be pointed at, and what is left to spend this month. Read from Virtec each time. */
tractionRouter.get("/crm/scan-info", async (_request, response) => {
  if (!isVirtecConfigured()) {
    response.status(409).json({ error: "Virtec is not configured" });
    return;
  }
  try {
    response.json({ ...(await getScanInfo()), writable: isVirtecWritable() });
  } catch (error) {
    fail(response, error, "read the scan options");
  }
});

/**
 * Asks Virtec to scan an area for new candidates.
 *
 * Spends Google Places money, so AgentOS only asks and Virtec decides:
 * it refuses until its monthly cap is set, and stops when the cap runs out.
 * The request is checked here against Virtec's own list of areas and
 * categories, so a stale screen or a typo costs nothing.
 */
tractionRouter.post("/crm/scan-candidates", async (request, response) => {
  const input = parse(ScanCandidatesSchema, request.body, response, "scan");
  if (!input) return;

  if (!isVirtecConfigured()) {
    response.status(409).json({ error: "Virtec is not configured" });
    return;
  }
  if (!isVirtecWritable()) {
    response.status(409).json({ error: "Write-back to Virtec is off (VIRTEC_WRITE_API_KEY is not set)" });
    return;
  }

  try {
    const info = await getScanInfo();
    if (!info.areas.some((area) => area.key === input.area)) {
      response.status(400).json({ error: "That area is not one of Virtec's presets" });
      return;
    }
    const known = new Set(info.categories.filter((entry) => entry.track === input.track).map((entry) => entry.category));
    const unknown = input.categories.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      response.status(400).json({ error: `Unknown categories for ${input.track}: ${unknown.join(", ")}` });
      return;
    }
    if (info.budget.cap === null) {
      response.status(409).json({ error: "Scans are off until PLACES_MONTHLY_REQUEST_CAP is set in Virtec: the most Places requests you will pay for in a month" });
      return;
    }
    const wanted = requestsFor(info, input.track, input.categories);
    if (info.budget.remaining !== null && info.budget.remaining < wanted) {
      response.status(429).json({ error: `That needs up to ${wanted} requests and ${info.budget.remaining} are left this month (limit ${info.budget.cap})` });
      return;
    }

    const result = await runScan(input);
    response.json({
      found: result.summary.fetched,
      stored: result.summary.upserted,
      requests: result.summary.requests,
      stoppedByCap: result.summary.stoppedByCap === true,
      message: result.summary.message,
      errors: result.summary.errors.slice(0, 3),
      budget: result.budget,
    });
  } catch (error) {
    fail(response, error, "scan for candidates");
  }
});

/**
 * Scores Virtec's candidates against the ICP with Jev.
 *
 * On demand only. Takes the best unscored candidates first (Virtec's own
 * score orders them), at most PROFILE_BATCH a click and PROFILE_DAILY_CAP a
 * day. Optional `{ track }` limits it to one site's leads, since scoring
 * Jurivo candidates against a Virtara ICP would be spend for nothing.
 */
tractionRouter.post("/crm/profile-leads", async (request, response) => {
  const track = (request.body as { track?: unknown } | undefined)?.track;
  if (track !== undefined && (typeof track !== "string" || !/^[a-z]{1,20}$/.test(track))) {
    response.status(400).json({ error: "track must be a short lower-case word" });
    return;
  }
  if (!isVirtecConfigured()) {
    response.status(409).json({ error: "Virtec is not configured" });
    return;
  }

  try {
    const state = await readState();
    const blocker = profilingBlocker(state.icp);
    if (blocker || !state.icp) {
      response.status(409).json({ error: blocker ?? "No ICP" });
      return;
    }

    const today = isoDate(new Date());
    const usedToday = state.leadProfileBudget.date === today ? state.leadProfileBudget.used : 0;
    const remaining = Math.max(0, PROFILE_DAILY_CAP - usedToday);
    if (remaining === 0) {
      response.status(429).json({ error: `Today's limit of ${PROFILE_DAILY_CAP} scores is used. It resets tomorrow.` });
      return;
    }

    const snapshot = await getVirtecSnapshot();
    const profiles = { icpKey: icpKey(state.icp), byCrmId: state.leadProfiles };
    const view = buildCrmView(snapshot, state.prospects, new Date(), undefined, false, profiles);
    const unscored = view.leads.filter((lead) => !lead.profile && (track === undefined || lead.track === track));
    // The view is already best-first; scoring follows the same order.
    const run = await runProfiling(unscored, state.icp, Math.min(PROFILE_BATCH, remaining));
    const saved = Object.keys(run.profiles).length > 0 ? await saveLeadProfiles(run.profiles, today) : { usedToday };

    response.json({
      profiled: Object.keys(run.profiles).length,
      failed: run.failed,
      error: run.error,
      left: Math.max(0, unscored.length - Object.keys(run.profiles).length - run.failed),
      remainingToday: Math.max(0, PROFILE_DAILY_CAP - saved.usedToday),
    });
  } catch (error) {
    fail(response, error, "score the candidates");
  }
});

const INBOUND_STATUSES = ["replied", "not_a_fit", "spam"] as const;

/** Settles a website lead from the Virtec tab: replied, not a fit, or spam. */
tractionRouter.post("/crm/inbound/:id", async (request, response) => {
  const id = LeadIdSchema.safeParse(request.params.id);
  const status = (request.body as { status?: unknown } | undefined)?.status;
  if (!id.success || !INBOUND_STATUSES.includes(status as (typeof INBOUND_STATUSES)[number])) {
    response.status(400).json({ error: `Expected a website lead id and status ${INBOUND_STATUSES.map((entry) => `"${entry}"`).join(", ")}` });
    return;
  }
  if (!isVirtecWritable()) {
    response.status(409).json({ error: "Write-back to Virtec is off (VIRTEC_WRITE_API_KEY is not set)" });
    return;
  }

  const outcome = await setInboundLeadStatus(id.data, status as (typeof INBOUND_STATUSES)[number]);
  if (outcome.ok) response.json({ ok: true });
  else response.status(502).json({ error: outcome.error });
});

/** Marks a Virtec follow-up sent or dismissed, from the Virtec tab. */
tractionRouter.post("/crm/follow-ups/:id", async (request, response) => {
  const id = LeadIdSchema.safeParse(request.params.id);
  const status = (request.body as { status?: unknown } | undefined)?.status;
  if (!id.success || (status !== "sent" && status !== "dismissed")) {
    response.status(400).json({ error: "Expected a follow-up id and status \"sent\" or \"dismissed\"" });
    return;
  }
  if (!isVirtecWritable()) {
    response.status(409).json({ error: "Write-back to Virtec is off (VIRTEC_WRITE_API_KEY is not set)" });
    return;
  }

  const outcome = status === "sent" ? await markFollowUpSent(id.data) : await dismissFollowUp(id.data);
  if (outcome.ok) response.json({ ok: true });
  else response.status(502).json({ error: outcome.error });
});

/** The study as Markdown, with image paths matching the ZIP export. */
tractionRouter.get("/case-studies/:id/export.md", async (request, response) => {
  try {
    const { markdown } = await caseStudyFiles(await readCaseStudy(request.params.id));
    response.type("text/markdown; charset=utf-8").send(markdown);
  } catch (error) {
    fail(response, error, "export the case study");
  }
});

/** `case-study.md` and `images/`, ready to drop into the Virtara site. */
tractionRouter.get("/case-studies/:id/export.zip", async (request, response) => {
  try {
    const study = await readCaseStudy(request.params.id);
    const { entries, skipped } = await caseStudyFiles(study);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${exportFilename(study)}"`);
    if (skipped > 0) response.setHeader("X-Images-Skipped", String(skipped));
    response.send(buildZip(entries));
  } catch (error) {
    fail(response, error, "export the case study");
  }
});
