import readline from "node:readline";

/**
 * A stand-in for `codex app-server`: the real wire format (JSON lines, no
 * "jsonrpc" member), scripted behaviour. One turn streams a reply and asks
 * for approval three times: a read-only command, a push, and an edit outside
 * the project. What the client answers decides how each item ends.
 */

if (process.argv[2] !== "app-server") process.exit(2);

const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
let nextServerId = 1000;
const waiting = new Map<number, (result: { decision: string }) => void>();
const ask = (method: string, params: object) =>
  new Promise<{ decision: string }>((resolve) => {
    const id = nextServerId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

const thread = "th-1";
const turn = "tu-1";

async function runTurn(): Promise<void> {
  const note = (method: string, params: object) => send({ method, params: { threadId: thread, turnId: turn, ...params } });
  note("item/agentMessage/delta", { itemId: "m1", delta: "Checking. " });

  const commands = [["c1", "git status"], ["c2", "git push origin main"]] as const;
  for (const [id, command] of commands) {
    note("item/started", { item: { type: "commandExecution", id, command, status: "inProgress" } });
    const { decision } = await ask("item/commandExecution/requestApproval", { threadId: thread, turnId: turn, itemId: id, command });
    const ok = decision === "accept";
    note("item/completed", { item: { type: "commandExecution", id, command, status: ok ? "completed" : "declined", aggregatedOutput: ok ? `${command}: ok` : null } });
  }

  note("item/started", { item: { type: "fileChange", id: "f1", status: "inProgress", changes: [{ path: "/etc/hosts", kind: "update", diff: "" }] } });
  const edit = await ask("item/fileChange/requestApproval", { threadId: thread, turnId: turn, itemId: "f1" });
  note("item/completed", { item: { type: "fileChange", id: "f1", status: edit.decision === "accept" ? "completed" : "declined", changes: [] } });

  // A message that was never streamed arrives whole.
  note("item/completed", { item: { type: "agentMessage", id: "m2", text: "Done." } });
  send({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, status: "completed", error: null, items: [] } } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown>; result?: { decision: string } };
  if (message.method === undefined && message.id !== undefined) {
    waiting.get(message.id)?.(message.result ?? { decision: "decline" });
    waiting.delete(message.id);
    return;
  }
  switch (message.method) {
    case "initialize":
      return send({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" } });
    case "initialized":
      return;
    case "thread/start":
      return send({ id: message.id, result: { thread: { id: thread }, model: String(message.params?.model ?? "gpt-default") } });
    case "thread/resume":
      if (message.params?.threadId !== thread) return send({ id: message.id, error: { code: -32600, message: "thread not found" } });
      return send({ id: message.id, result: { thread: { id: thread } } });
    case "turn/start":
      send({ id: message.id, result: { turn: { id: turn, status: "inProgress", items: [], error: null } } });
      void runTurn();
      return;
    case "turn/interrupt":
      return send({ id: message.id, result: {} });
    default:
      if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: `unknown ${message.method}` } });
  }
});
