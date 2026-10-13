import { z } from "zod";

/**
 * One business in the follow-up sequence: contacted, not yet answered.
 *
 * `due`: the next email is due now. `waiting`: not due yet. `final`: the last
 * email has gone out and the wait for an answer is not over. `quiet`: the whole
 * sequence has gone unanswered. `stopped`: they opted out or the address
 * bounced, so nothing more is sent.
 */
export const FollowUpStateSchema = z.enum(["due", "waiting", "final", "quiet", "stopped"]);
export type FollowUpState = z.infer<typeof FollowUpStateSchema>;

export const FollowUpRowSchema = z.object({
  prospectId: z.string(),
  company: z.string(),
  contact: z.string().optional(),
  /** Emails sent so far. A contacted business with none recorded counts as one. */
  touches: z.number().int().min(1),
  lastAt: z.string(),
  lastSubject: z.string().optional(),
  /** What the last email said, when it was recorded (emails sent by hand keep their text). */
  lastBody: z.string().optional(),
  /** Which email comes next (2 or 3); absent once the sequence is over. */
  nextTouch: z.number().int().optional(),
  dueAt: z.string().optional(),
  state: FollowUpStateSchema,
  /** For `stopped`: why. */
  stoppedReason: z.string().optional(),
});
export type FollowUpRow = z.infer<typeof FollowUpRowSchema>;

export const FOLLOW_UP_STATE_LABELS: Record<FollowUpState, string> = {
  due: "Follow-up due",
  waiting: "Waiting",
  final: "Last email sent",
  quiet: "Gone quiet",
  stopped: "Stopped",
};
