import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent } from "@agentclientprotocol/sdk";

/**
 * A stand-in ACP agent for the chat adapter's tests: real protocol, scripted
 * behaviour. It offers two models, replays history on load (which the client
 * must not mistake for the new reply), and runs one safe and one risky shell
 * command, asking permission for both the way Gemini CLI and Hermes do.
 */

const MODELS = [
  { value: "fast-1", name: "Fast 1" },
  { value: "smart-2", name: "Smart 2", description: "Slower, better" },
];

let model = "fast-1";
const configOptions = () => [{ id: "model", name: "Model", category: "model", type: "select" as const, currentValue: model, options: MODELS }];

const connection = new AgentSideConnection(
  (client): Agent => ({
    initialize: async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } }),
    authenticate: async () => ({}),
    newSession: async () => ({ sessionId: "s-new", configOptions: configOptions() }),
    loadSession: async (params) => {
      if (params.sessionId === "missing") throw new Error("No such session");
      await client.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OLD HISTORY " } } });
      return { configOptions: configOptions() };
    },
    setSessionConfigOption: async (params) => {
      if (typeof params.value === "string") model = params.value;
      return { configOptions: configOptions() };
    },
    cancel: async () => undefined,
    prompt: async (params) => {
      const sessionId = params.sessionId;
      const say = (text: string) => client.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
      const update = (update: Record<string, unknown>) => client.sessionUpdate({ sessionId, update: update as never });
      const options = [
        { optionId: "yes", name: "Allow", kind: "allow_once" as const },
        { optionId: "no", name: "Reject", kind: "reject_once" as const },
      ];

      await say(`Hello (model=${model}). `);

      for (const [id, command] of [["t1", "git status"], ["t2", "git push origin main"]] as const) {
        const toolCall = { toolCallId: id, title: command, kind: "execute" as const, status: "pending" as const, rawInput: { command } };
        await update({ sessionUpdate: "tool_call", ...toolCall });
        const answer = await client.requestPermission({ sessionId, toolCall, options });
        const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "yes";
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: allowed ? "completed" : "failed",
          content: [{ type: "content", content: { type: "text", text: allowed ? `${command}: ok` : "rejected" } }],
        });
        await say(allowed ? `${command} ran. ` : `${command} skipped. `);
      }
      return { stopReason: "end_turn" };
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>),
);

void connection;
