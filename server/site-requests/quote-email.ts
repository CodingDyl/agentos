import type { MailComposeInput, MailComposeResult } from "../../shared/mail-compose-types";
import type { Quote, SiteRequest } from "../../shared/site-request-types";
import { composeMail } from "../mail/compose";
import { markQuoteDrafted, readRequest, readSite, SiteRequestError } from "./store";

/**
 * The quote, written as an email to the client and saved as a draft in Mail.
 * It is never sent from here: Dylan reads it, edits it and sends it.
 */

export const mailDeps: { current: { draft: (input: MailComposeInput) => Promise<MailComposeResult> } } = {
  current: { draft: (input) => composeMail(input) },
};

/** Rand with a space between thousands and a point before the cents, the same on every machine. */
const rand = (value: number) => `R${value.toFixed(2).replace(/\B(?=(\d{3})+\.)/g, " ")}`;

export function quoteEmail(request: SiteRequest, company: string, quote: Quote): { subject: string; body: string } {
  const lines = quote.lines.filter((line) => line.type === "amount" || line.type === "discount").map((line) => `  ${line.label}: ${rand(line.value)}`);
  return {
    subject: `Quote: ${request.title}`,
    body: [
      "Hi,",
      "",
      `Thanks for your request for ${company}: "${request.title}". This goes beyond what your plan covers, so here is a quote.`,
      "",
      request.description.length > 600 ? `${request.description.slice(0, 600)}...` : request.description,
      "",
      `Estimated effort: ${quote.estimatedHours} hours`,
      ...lines,
      `Total: ${rand(quote.total)}`,
      "",
      "Reply to confirm and I will get started. I will send you a preview to look at before anything goes live.",
      "",
      "Kind regards",
    ].join("\n"),
  };
}

export async function draftQuoteEmail(id: string): Promise<SiteRequest> {
  const request = readRequest(id);
  if (!request.quote) throw new SiteRequestError("Price the request before drafting its quote email.");
  const site = readSite(request.siteSlug);
  if (!site.contactEmail) throw new SiteRequestError(`${site.company} has no contact email. Add one to the site, then draft the quote.`, 422);
  const { subject, body } = quoteEmail(request, site.company, request.quote);
  await mailDeps.current.draft({ mode: "draft", to: [site.contactEmail], cc: [], bcc: [], subject, body, tag: "normal", attachments: [] });
  markQuoteDrafted(id);
  return readRequest(id);
}
