import type { Response } from "express";
import type { ZodType } from "zod";
import { CaseStudyDraftError } from "./case-study-draft";
import { LeadMagnetDraftError } from "./lead-magnet-draft";
import { LeadMagnetNotReadyError } from "./lead-magnets";
import { TractionConflictError, TractionNotFoundError } from "./store";

/** Shared by every Traction router: a body parsed or a 400, and errors mapped to status codes. */

export function parse<T>(schema: ZodType<T>, body: unknown, response: Response, what: string): T | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  response.status(400).json({ error: `Invalid ${what}${issue ? `: ${issue.path.join(".") || "body"}: ${issue.message}` : ""}` });
  return undefined;
}

export function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof CaseStudyDraftError || error instanceof LeadMagnetDraftError || error instanceof LeadMagnetNotReadyError) {
    response.status(422).json({ error: error.message });
    return;
  }

  if (error instanceof TractionConflictError) {
    response.status(409).json({ error: error.message });
    return;
  }

  if (error instanceof TractionNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }

  console.error(`[agentos] traction: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}
