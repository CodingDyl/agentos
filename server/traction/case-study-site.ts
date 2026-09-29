import type { CaseStudy } from "../../shared/traction-types";
import { extractPageFacts } from "../web/page-facts";
import { fetchPage, SafeFetchError } from "../web/safe-fetch";
import { readCaseStudy, saveCaseStudySiteFacts } from "./store";

export class CaseStudySiteError extends Error {}

/**
 * Reads the study's client website, once, when asked, and keeps the facts.
 *
 * The address is the one saved on the study, never one in the request, and it
 * is fetched through the guarded fetcher: only public websites, bounded in
 * size and time. What comes back is text for Hermes to draft from; nothing on
 * the page is followed or run.
 */
export async function readCaseStudyWebsite(id: string): Promise<CaseStudy> {
  const study = await readCaseStudy(id);
  if (!study.websiteUrl) throw new CaseStudySiteError("Add the client's website address and save first.");

  try {
    const page = await fetchPage(study.websiteUrl);
    return await saveCaseStudySiteFacts(id, study.websiteUrl, extractPageFacts(page.html, page.url));
  } catch (error) {
    if (error instanceof SafeFetchError) throw new CaseStudySiteError(error.message);
    throw error;
  }
}
