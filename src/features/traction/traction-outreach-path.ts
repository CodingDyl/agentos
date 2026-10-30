import type { OutreachCase, OutreachCasePatch, OutreachPath, Sender } from "@shared/outreach-case";

/**
 * What choosing an approach writes to a case.
 *
 * Your usual prices, from the company the email is sent as, are filled in when
 * nothing is set yet, so a business reached through "Build their site first" in
 * Find and one decided on the Outreach tab end up with the same case.
 */
export function pathPatch(path: OutreachPath, entry: Pick<OutreachCase, "monthlyPrice" | "setupPrice" | "projectPrice">, sender: Sender | undefined): OutreachCasePatch {
  const patch: OutreachCasePatch = { path };
  if (!sender) return patch;
  if (path === "build_first" && !entry.monthlyPrice && sender.defaultMonthly) patch.monthlyPrice = sender.defaultMonthly;
  if (path === "build_first" && !entry.setupPrice && sender.defaultSetup) patch.setupPrice = sender.defaultSetup;
  if ((path === "cold_pitch" || path === "photo_sample") && !entry.projectPrice && sender.defaultProject) patch.projectPrice = sender.defaultProject;
  return patch;
}

/** Words that promise a file on the email itself: samples go as a link, never attached. */
const ATTACHMENT_WORDS = /\battach(?:ed|ment|ments|ing)?\b/i;

/**
 * Whether a photo-sample case is ready, and the pre-send checks for its draft.
 * `done` is the Card 2 condition; `checks` are the draft checks, given the email text.
 */
export function photoSampleReady(entry: Pick<OutreachCase, "samplesUrl" | "samplesChecked">, message = "") {
  const url = entry.samplesUrl.trim();
  const attached = ATTACHMENT_WORDS.test(message);
  return {
    done: Boolean(url) && entry.samplesChecked,
    checks: [
      { ok: Boolean(url) && message.includes(url), label: "Includes the sample photos link" },
      { ok: !attached, label: attached ? "Mentions an attachment: samples go as a link" : "No attachment wording" },
    ],
  };
}
