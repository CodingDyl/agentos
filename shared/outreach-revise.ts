import { z } from "zod";
import { ChatAgentIdSchema } from "./chat-types";
import { MAX_EMAIL_BODY } from "./outreach-types";

/**
 * Revising a draft: you pick an agent, give a short instruction ("shorter",
 * "less formal", "drop the second paragraph"), and it rewrites the email you
 * have on screen, changing only that. It is not asked to draft again.
 */
export const MAX_INSTRUCTION = 500;

export const ReviseRequestSchema = z
  .object({
    agent: ChatAgentIdSchema,
    /** A model that agent offers; anything else uses the agent's own default. */
    model: z.string().max(120).optional(),
    instruction: z.string().trim().min(3).max(MAX_INSTRUCTION),
    /** The email on screen, signature and all. */
    subject: z.string().trim().min(1).max(150),
    body: z.string().trim().min(1).max(MAX_EMAIL_BODY),
  })
  .strict();
export type ReviseRequest = z.infer<typeof ReviseRequestSchema>;

export interface ReviseResult {
  subject: string;
  /** The revised email with the original signature put back exactly as it was. */
  body: string;
  /** False when the agent returned the email as it was. */
  changed: boolean;
  agent: string;
}
