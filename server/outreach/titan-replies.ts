import type { ReplyWatchStatus } from "../../shared/outreach-types";
import { findTitanMessagesFrom } from "../mail/titan-client";
import { titanAccount } from "../mail/titan-credentials";
import { firstContactAt, readState, recordInboxReplies, setReplyWatch } from "../traction/store";

/**
 * Noticing replies in your own Virtara mailbox (Titan), where you send
 * outreach by hand.
 *
 * Every 15 minutes while the server runs, and when you press "Check now", the
 * Inbox is searched for messages from the exact addresses of businesses you
 * have contacted, sent after you first contacted them. Read-only: nothing is
 * marked read, moved or sent, and no other message is opened. What is found is
 * kept in Traction, so archiving the email later does not undo it.
 *
 * Uses the mailbox already connected on the Inbox page; with none connected it
 * does nothing.
 */

const DAY = 86_400_000;
/** How far back a check looks. Older replies would long since have been handled. */
export const REPLY_LOOKBACK_DAYS = 60;
const WATCHED_STAGES = new Set(["contacted", "conversation", "proposal", "lost"]);

export interface ReplyCheckDeps {
  account: () => Promise<{ address: string } | undefined>;
  find: (addresses: readonly string[], since: Date) => Promise<Awaited<ReturnType<typeof findTitanMessagesFrom>>>;
  now: () => Date;
}

const defaults: ReplyCheckDeps = { account: titanAccount, find: findTitanMessagesFrom, now: () => new Date() };

let running: Promise<ReplyWatchStatus> | undefined;

/** One check. A second request while one runs gets the same answer rather than a second login. */
export function checkTitanReplies(deps: ReplyCheckDeps = defaults): Promise<ReplyWatchStatus> {
  running ??= runCheck(deps).finally(() => {
    running = undefined;
  });
  return running;
}

async function runCheck(deps: ReplyCheckDeps): Promise<ReplyWatchStatus> {
  const account = await deps.account();
  if (!account) return { connected: false };

  const state = await readState();
  const now = deps.now();
  const contacts = state.prospects.flatMap((prospect) => {
    if (!prospect.email || !WATCHED_STAGES.has(prospect.stage)) return [];
    const since = firstContactAt(prospect, state.outreachLog);
    return since === undefined ? [] : [{ address: prospect.email, since }];
  });

  let watch;
  if (contacts.length === 0) {
    watch = { lastCheckAt: now.toISOString(), lastFound: 0 };
  } else {
    const since = new Date(Math.max(Math.min(...contacts.map((contact) => contact.since)), now.getTime() - REPLY_LOOKBACK_DAYS * DAY));
    try {
      const found = await deps.find(contacts.map((contact) => contact.address), since);
      await recordInboxReplies("titan", found, now);
      watch = { lastCheckAt: now.toISOString(), lastFound: found.length };
    } catch (error) {
      // Keep the last good count; say what went wrong in Titan's own words where there are some.
      watch = { lastCheckAt: now.toISOString(), lastFound: state.replyWatch.lastFound, lastError: error instanceof Error ? error.message : "Titan could not be checked." };
    }
  }
  await setReplyWatch(watch);
  return { connected: true, address: account.address, ...watch };
}

/** What the last check found, without checking. */
export async function replyWatchStatus(deps: Pick<ReplyCheckDeps, "account"> = defaults): Promise<ReplyWatchStatus> {
  const account = await deps.account();
  if (!account) return { connected: false };
  return { connected: true, address: account.address, ...(await readState()).replyWatch };
}

/** AGENTOS_TITAN_REPLY_WATCH=off stops the automatic check (Check now still works). */
export function titanReplyTimerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|0|false|no)$/i.test(env.AGENTOS_TITAN_REPLY_WATCH?.trim() ?? "");
}

/** Checks a minute after start, then every 15 minutes. Silent when no Titan mailbox is connected. */
export function startTitanReplyTimer(intervalMs = 15 * 60_000, env: NodeJS.ProcessEnv = process.env): NodeJS.Timeout | undefined {
  if (!titanReplyTimerEnabled(env)) return undefined;
  const check = () =>
    void checkTitanReplies().catch((error: unknown) => console.warn(`[outreach] Titan reply check failed: ${error instanceof Error ? error.message : "unknown error"}`));
  setTimeout(check, 60_000).unref();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return timer;
}
