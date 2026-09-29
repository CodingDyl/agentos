/**
 * Finding Hermes' answer when it did not arrive as streamed text.
 *
 * Jarvis speaks text as Hermes streams it. But a run can finish having sent
 * its answer some other way: only in the run's final record, or only into the
 * session transcript, which is what the Agent screen reloads when a run ends.
 * Speaking nothing and saying nothing in that case looks exactly like a
 * broken assistant, so this goes and finds the answer, and reports honestly
 * when there is none.
 */

export interface TranscriptMessage {
  role: string;
  content?: string;
}

/** Whitespace-insensitive, so line wrapping and trimming cannot cause a miss. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The assistant's reply to *this* question, or nothing yet.
 *
 * The transcript is matched on the question, not just "the last assistant
 * message": if Hermes has not written this turn yet, the last reply is the
 * previous question's, and speaking that would be worse than speaking nothing.
 */
export function lastAssistantReply(messages: TranscriptMessage[], sent: string): string | undefined {
  const question = squash(sent);
  if (!question) return undefined;

  let asked = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string" && squash(message.content).includes(question)) {
      asked = index;
      break;
    }
  }
  if (asked === -1) return undefined;

  for (let index = messages.length - 1; index > asked; index--) {
    const message = messages[index];
    if (message.role === "assistant" && typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }
  }
  return undefined;
}

export interface RecoverOptions {
  /** The run's own final output, if Hermes recorded one. */
  runOutput: () => Promise<string | undefined>;
  /** Hermes' saved conversation for this project. */
  transcript: () => Promise<TranscriptMessage[]>;
  /** What was asked, to tell this turn's reply from an earlier one. */
  sent: string;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Tries the run's own record, then the transcript, a few times: Hermes may
 * still be writing the turn a moment after the stream closes.
 */
export async function recoverAnswer({
  runOutput,
  transcript,
  sent,
  attempts = 4,
  delayMs = 600,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: RecoverOptions): Promise<string | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);

    try {
      const output = await runOutput();
      if (output?.trim()) return output;
    } catch {
      // Not every Hermes records output on the run. The transcript is next.
    }

    try {
      const reply = lastAssistantReply(await transcript(), sent);
      if (reply) return reply;
    } catch {
      // Try again: it may only be a moment early.
    }
  }
  return undefined;
}
