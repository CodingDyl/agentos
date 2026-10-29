import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * A Claude session that stays open between a chat's messages.
 *
 * Starting Claude Code for every message costs a process start, its MCP
 * handshakes and a session resume before the first word, every time. A live
 * session is started once per chat and fed each new message on its open
 * input, so from the second message on Claude starts answering straight
 * away. One turn runs at a time; a turn ends at Claude's `result` message.
 *
 * Sessions are closed after a quiet spell, when there are too many, when the
 * chat's setup changes (another folder, prompt or kind of chat), and when a
 * chat is deleted. Closing loses nothing: the chat keeps Claude's session id,
 * and the next message resumes it in a new process.
 */

/** What this module needs from the SDK's `Query`; tests pass a stand-in. */
export interface LiveQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  close(): void;
}

/** Closed after this long without a message: a parked Claude Code holds a few hundred MB. */
export const LIVE_IDLE_MS = 10 * 60 * 1000;

/** At most this many open at once; the longest-idle goes first. */
export const MAX_LIVE_SESSIONS = 4;

/** How long a stopped turn may take to wind down before the session is closed under it. */
const STOP_GRACE_MS = 5_000;

/** Messages pushed in; Claude reads them as its prompt. Ends when the session closes. */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void;
  private ended = false;

  push(text: string): void {
    const message: SDKUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: message, done: false });
    } else {
      this.buffer.push(message);
    }
  }

  end(): void {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.buffer.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

interface RunningTurn<C> {
  context: C;
  onMessage: (message: SDKMessage) => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class LiveSession<C> {
  private readonly queue = new MessageQueue();
  private readonly query: LiveQuery;
  private turn?: RunningTurn<C>;
  private idle?: NodeJS.Timeout;
  closed = false;
  lastUsed = Date.now();

  constructor(
    readonly fingerprint: string,
    public model: string,
    start: (prompt: AsyncIterable<SDKUserMessage>) => LiveQuery,
    private readonly onClosed: () => void,
  ) {
    this.query = start(this.queue);
    void this.read();
  }

  /** The running turn's own context (its policy, its reply), for callbacks Claude makes mid-turn. */
  get current(): C | undefined {
    return this.turn?.context;
  }

  get busy(): boolean {
    return this.turn !== undefined;
  }

  private async read(): Promise<void> {
    try {
      for await (const message of this.query) {
        const turn = this.turn;
        if (!turn) continue;
        turn.onMessage(message);
        if (message.type === "result") {
          this.turn = undefined;
          turn.resolve();
          this.scheduleIdle();
        }
      }
      this.end(new Error("Claude's session ended."));
    } catch (error) {
      this.end(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private scheduleIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), LIVE_IDLE_MS);
    this.idle.unref?.();
  }

  private end(error: Error): void {
    const turn = this.turn;
    this.turn = undefined;
    this.close();
    turn?.reject(error);
  }

  /** Switches model for this and later turns. "default" is Claude Code's own choice. */
  async useModel(model: string): Promise<void> {
    if (model === this.model) return;
    await this.query.setModel(model === "default" ? undefined : model);
    this.model = model;
  }

  /** Sends one message and resolves when Claude has finished answering it. */
  send(prompt: string, context: C, onMessage: (message: SDKMessage) => void, signal: AbortSignal): Promise<void> {
    if (this.closed) return Promise.reject(new Error("This Claude session has closed."));
    if (this.turn) return Promise.reject(new Error("Claude is still answering."));
    if (this.idle) clearTimeout(this.idle);
    this.lastUsed = Date.now();

    return new Promise<void>((resolve, reject) => {
      let fallback: NodeJS.Timeout | undefined;
      const stop = () => {
        // Interrupting ends the turn with a result and keeps the session for
        // the next message. If it doesn't wind down in time, close it.
        void this.query.interrupt().catch(() => undefined);
        fallback = setTimeout(() => {
          if (this.turn === turn) this.end(new Error("Stopped."));
        }, STOP_GRACE_MS);
        fallback.unref?.();
      };
      const settle = () => {
        if (fallback) clearTimeout(fallback);
        signal.removeEventListener("abort", stop);
      };
      const turn: RunningTurn<C> = {
        context,
        onMessage,
        resolve: () => {
          settle();
          resolve();
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      };
      this.turn = turn;
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
      this.queue.push(prompt);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.idle) clearTimeout(this.idle);
    this.queue.end();
    try {
      this.query.close();
    } catch {
      // Already gone.
    }
    this.onClosed();
  }
}

/**
 * Every open session, by chat. A session is reused only while its setup is
 * the same; otherwise it is closed and a new one started.
 */
export class LiveSessions<C> {
  private readonly sessions = new Map<string, LiveSession<C>>();

  get size(): number {
    return this.sessions.size;
  }

  /** The chat's open session if its setup still matches, else undefined (and any stale one closed). */
  find(key: string, fingerprint: string): LiveSession<C> | undefined {
    const existing = this.sessions.get(key);
    if (existing && !existing.closed && existing.fingerprint === fingerprint && !existing.busy) return existing;
    if (existing && !existing.busy) existing.close();
    return undefined;
  }

  open(key: string, fingerprint: string, model: string, start: (prompt: AsyncIterable<SDKUserMessage>) => LiveQuery): LiveSession<C> {
    this.evict();
    const session: LiveSession<C> = new LiveSession<C>(fingerprint, model, start, () => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    this.sessions.set(key, session);
    return session;
  }

  /** Makes room for one more by closing the longest-idle sessions not answering right now. */
  private evict(): void {
    const idle = [...this.sessions.values()].filter((session) => !session.busy).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.sessions.size >= MAX_LIVE_SESSIONS && idle.length > 0) idle.shift()?.close();
  }

  close(key: string): void {
    this.sessions.get(key)?.close();
  }

  closeAll(): void {
    for (const session of [...this.sessions.values()]) session.close();
  }
}
