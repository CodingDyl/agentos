import type { MailClassifier } from "../../shared/mail-types";
import { isAiEnabled } from "../ai-stack/settings";
import { isJevConfigured } from "./jev-client";

/**
 * Which classifier sorts the inbox right now.
 *
 * Jev when it is configured and switched on; otherwise `manual`, which lists
 * threads unsorted. A new provider is one more branch here and one more value
 * in `MailClassifierSchema` — the page and the store do not change.
 */
export function activeMailClassifier(): MailClassifier {
  return isJevConfigured() && isAiEnabled("jev") ? "jev" : "manual";
}
