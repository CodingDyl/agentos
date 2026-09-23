import type { MailCategory, MailThread } from "@shared/mail-types";

/** The sender line shown in a row — the display name when Gmail gave one, else the address. */
export function threadSender(thread: MailThread): string {
  return thread.fromName ?? thread.fromEmail ?? "Unknown sender";
}

/** A single-letter avatar glyph. */
export function threadInitial(thread: MailThread): string {
  const source = threadSender(thread);
  return source.trim().charAt(0).toUpperCase() || "?";
}

export type MailTagTone = "client" | "finance" | "reply" | "noreply" | "muted";

export interface MailTag {
  label: string;
  tone: MailTagTone;
}

const CATEGORY_LABEL: Record<MailCategory, string> = {
  client: "CLIENT",
  sales: "SALES",
  finance: "FINANCE",
  admin: "ADMIN",
  notification: "NOTIFICATION",
  newsletter: "NEWSLETTER",
  personal: "PERSONAL",
  spam: "SPAM",
};

const CATEGORY_TONE: Record<MailCategory, MailTagTone> = {
  client: "client",
  sales: "client",
  finance: "finance",
  admin: "finance",
  notification: "muted",
  newsletter: "muted",
  personal: "muted",
  spam: "muted",
};

const REPLY_THRESHOLD = 0.5;

/** The small tag row under a thread's snippet — category, then reply status. */
export function threadTags(thread: MailThread): MailTag[] {
  if (!thread.classified) {
    return [{ label: "NOT YET CLASSIFIED", tone: "muted" }];
  }

  const tags: MailTag[] = [];

  if (thread.category) {
    tags.push({ label: CATEGORY_LABEL[thread.category], tone: CATEGORY_TONE[thread.category] });
  }

  const wantsReply =
    (thread.needsReply ?? 0) >= REPLY_THRESHOLD || (thread.actionRequired ?? 0) >= REPLY_THRESHOLD;

  if (wantsReply) {
    tags.push({ label: "REPLY NEEDED", tone: "reply" });
  } else if ((thread.financial ?? 0) >= REPLY_THRESHOLD) {
    tags.push({ label: "NO REPLY", tone: "noreply" });
  }

  return tags;
}
