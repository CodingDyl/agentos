import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

/**
 * JSON-RPC over a child process's stdio, one message per line.
 *
 * Codex's app-server speaks this, without the `"jsonrpc": "2.0"` member, so
 * none is sent. Three kinds of message come back: responses to our requests,
 * notifications, and requests the server makes of us (approvals). A request
 * still waiting when the process ends is rejected with what it said on
 * stderr, so a crash or a missing login reads as a reason, not a hang.
 */

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (method: string, params: unknown) => Promise<unknown>;

/** Enough stderr to explain a failure, not a whole log. */
const STDERR_TAIL = 4_000;

export class JsonLineRpc {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private onNotify: NotificationHandler = () => undefined;
  private onServerRequest: RequestHandler = async (method) => {
    throw new RpcError(`AgentOS doesn't handle ${method}.`, -32601);
  };
  private stderr = "";
  private closed = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
    });
    child.on("error", (error) => this.fail(error.message));
    child.on("exit", (code, signal) => this.fail(`exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}`));
  }

  onNotification(handler: NotificationHandler): void {
    this.onNotify = handler;
  }

  onRequest(handler: RequestHandler): void {
    this.onServerRequest = handler;
  }

  /** The end of what the process wrote to stderr, for explaining a failure. */
  stderrTail(): string {
    return this.stderr.trim();
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(`The agent has stopped; ${method} wasn't sent.`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  close(): void {
    if (this.closed) return;
    this.fail("was stopped");
    this.child.kill("SIGTERM");
    // A process that ignores SIGTERM is not allowed to outlive its chat turn.
    setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
    }, 3_000).unref();
  }

  private write(message: object): void {
    if (this.closed || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const detail = this.stderrTail().split("\n").filter((line) => line.trim()).slice(-3).join(" ");
    for (const { reject } of this.pending.values()) reject(new RpcError(`The agent ${reason}.${detail ? ` ${detail}` : ""}`));
    this.pending.clear();
  }

  private receive(line: string): void {
    let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string; code?: number } };
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not a protocol line: some tools print banners on stdout.
    }
    if (!message || typeof message !== "object") return;

    if (message.method !== undefined && message.id !== undefined) {
      const id = message.id;
      this.onServerRequest(message.method, message.params).then(
        (result) => this.write({ id, result: result ?? null }),
        (error: unknown) =>
          this.write({ id, error: { code: error instanceof RpcError && error.code ? error.code : -32603, message: error instanceof Error ? error.message : "Request failed." } }),
      );
      return;
    }

    if (message.method !== undefined) {
      this.onNotify(message.method, message.params);
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new RpcError(message.error.message ?? "The agent refused the request.", message.error.code));
      else pending.resolve(message.result);
    }
  }
}
