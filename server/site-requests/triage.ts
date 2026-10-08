import { SITE_PLAN_LABEL, TriageAnswerSchema, type ClientSite, type SiteRequest, type TriageAnswer } from "../../shared/site-request-types";
import { HermesError, sendToHermes } from "../hermes/client";
import { readRequest, readSite, setTriage, SiteRequestError } from "./store";

/**
 * AI triage: is this a small edit or a new feature, and how many hours?
 * Hermes proposes; the answer is checked against a schema and then recorded
 * as the AI's, which a person's override replaces. If Hermes is down or
 * answers badly, nothing is recorded and triage is done by hand.
 */

export interface TriageDeps {
  classify: (request: SiteRequest, site: ClientSite) => Promise<string>;
}

const SYSTEM = [
  "You triage website change requests for a small web agency. Answer with one JSON object and nothing else.",
  'Shape: {"classification":"small_edit"|"new_feature","estimateHours":number,"reason":string}.',
  "small_edit: copy, images, colours, spacing, a link, a hours or price change, fixing something broken, a tweak to an existing section or form.",
  "new_feature: a new page type, booking or payments, a shop, a login, an integration, a new form with logic, anything that needs new structure or a data source.",
  "estimateHours is the realistic build and check time for an experienced developer, in hours, to the nearest quarter hour.",
  "reason is one or two plain sentences.",
].join("\n");

export function triagePrompt(request: SiteRequest, site: ClientSite): string {
  return [
    `Client: ${site.company}. Plan: ${SITE_PLAN_LABEL[site.plan]}.`,
    `Asked for as a: ${request.kind === "feature" ? "new feature" : "change"}. Priority: ${request.priority}.`,
    request.page ? `Page: ${request.page}` : "",
    `Title: ${request.title}`,
    "Request:",
    request.description,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Reads the first JSON object in a reply; models add words around it. Anything unusable is an error, never a guess. */
export function parseTriageAnswer(text: string): TriageAnswer {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SiteRequestError("The AI did not return a triage. Triage it yourself below.", 502);
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new SiteRequestError("The AI did not return a triage. Triage it yourself below.", 502);
  }
  const object = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const parsed = TriageAnswerSchema.safeParse({ classification: object.classification, estimateHours: Number(object.estimateHours), reason: typeof object.reason === "string" ? object.reason : "" });
  if (!parsed.success) throw new SiteRequestError("The AI's triage was not usable. Triage it yourself below.", 502);
  return parsed.data;
}

export const triageDeps: { current: TriageDeps } = {
  current: {
    classify: (request, site) =>
      sendToHermes(triagePrompt(request, site), {
        operation: "other",
        // Hermes is slow (about 23 s for a trivial prompt), so the default would report it as offline.
        timeoutMs: 120_000,
        // A system message outranks Hermes' persona, which would otherwise ignore a JSON contract.
        system: SYSTEM,
      }),
  },
};

/** Asks the AI to triage a request and records the answer. Throws a readable error and records nothing on failure. */
export async function runTriage(id: string): Promise<SiteRequest> {
  const request = readRequest(id);
  const site = readSite(request.siteSlug);
  let reply: string;
  try {
    reply = await triageDeps.current.classify(request, site);
  } catch (error) {
    if (error instanceof SiteRequestError) throw error;
    const reason = error instanceof HermesError ? error.message : error instanceof Error ? error.message : "Hermes could not be reached.";
    throw new SiteRequestError(`The AI could not triage this: ${reason} Triage it yourself below.`, 502);
  }
  return setTriage(id, parseTriageAnswer(reply), "ai");
}
