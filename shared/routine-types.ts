import { z } from "zod";

/**
 * Routines: messages AgentOS writes and Hermes sends to the operator's phone
 * on a schedule. Each one is a Hermes scheduled job that runs a small script
 * with no model call; the script asks AgentOS for the message.
 */

export const RoutineIdSchema = z.enum(["follow-ups", "inbox", "evening-wrap", "overdue-invoices"]);
export type RoutineId = z.infer<typeof RoutineIdSchema>;

export const RoutineSchema = z.object({
  id: RoutineIdSchema,
  name: z.string(),
  /** What the message says. */
  summary: z.string(),
  /** When it runs, in plain words. */
  when: z.string(),
  /** When it sends nothing, as the end of "Sends nothing when …". */
  quietWhen: z.string(),
  installed: z.boolean(),
  /** The Hermes job behind it, once installed. */
  automationId: z.string().optional(),
});
export type Routine = z.infer<typeof RoutineSchema>;

export const RoutinesResponseSchema = z.object({
  routines: z.array(RoutineSchema),
  /** Whether Hermes' Telegram connection is up, so a message can arrive. */
  phone: z.object({ connected: z.boolean(), detail: z.string().optional() }),
});
export type RoutinesResponse = z.infer<typeof RoutinesResponseSchema>;

export const RoutinePreviewSchema = z.object({
  /** The message as it would be sent right now. Empty when it would stay quiet. */
  message: z.string(),
});
export type RoutinePreview = z.infer<typeof RoutinePreviewSchema>;

/** Where a scheduled job's result goes: the phone (Telegram), or only Hermes' output file. */
export const AutomationDeliverySchema = z.object({ target: z.enum(["telegram", "local"]) }).strict();
export type AutomationDelivery = z.infer<typeof AutomationDeliverySchema>;
