import type { OutreachReply } from "../../shared/outreach-types";
import type { MailThread } from "../../shared/mail-types";

/**
 * Replies read from the outreach mailbox, in the shape the queue already
 * understands for the main inbox, so "They replied" needs no second
 * mechanism. Used only to raise queue items: these are never offered as
 * threads to link, because they do not live in the main inbox.
 */
export function outreachReplyThreads(replies: readonly OutreachReply[]): MailThread[] {
  return replies.map((reply) => ({
    threadId: reply.threadId,
    fromEmail: reply.fromEmail,
    fromName: reply.fromName,
    subject: reply.subject,
    snippet: reply.text.replace(/\s+/g, " ").trim().slice(0, 300),
    messageDate: reply.at,
    classified: false,
    unread: true,
  }));
}
