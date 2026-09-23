/**
 * Minimal Server-Sent Events reader.
 *
 * `EventSource` can only subscribe to event names it is told about, so an event
 * type Hermes adds later would never arrive. Reading the stream directly
 * delivers every event whatever its name — which is what makes unknown events
 * safe rather than invisible. It also avoids `EventSource`'s automatic
 * reconnect, which would re-open a stream for a run that has already finished.
 */

export interface SseMessage {
  /** The `event:` name, or `message` when the stream omits one. */
  event: string;
  data: string;
}

function parseBlock(block: string): SseMessage | undefined {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keep-alive

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).trimStart();

    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}

/**
 * Reads an SSE response to completion, calling `onMessage` per event.
 *
 * Resolves when the stream ends or is aborted.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; tolerate CRLF.
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const message = parseBlock(block);
        if (message) onMessage(message);
      }
    }

    buffer += decoder.decode();
    const trailing = parseBlock(buffer);
    if (trailing) onMessage(trailing);
  } finally {
    reader.releaseLock();
  }
}
