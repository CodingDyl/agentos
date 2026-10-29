import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { AGENTOS_TOOLS, toolDisplayName } from "../agentos-tools";
import { decideToolUse, summariseToolInput } from "../chat-permission-policy";

/**
 * AgentOS's tools for a chat, against a stand-in AgentOS API: each tool must
 * call the route the screens use, with the body they send, and turn the
 * answer (or a refusal) into something the agent can read.
 */

interface Seen {
  method: string;
  url: string;
  body?: unknown;
}

let server: http.Server;
let seen: Seen[];
let answers: Record<string, { status?: number; body: unknown }>;
const previous = process.env.AGENTOS_API_URL;

before(async () => {
  server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      seen.push({ method: request.method ?? "GET", url: request.url ?? "", body: raw ? JSON.parse(raw) : undefined });
      const key = `${request.method} ${(request.url ?? "").split("?")[0]}`;
      const answer = answers[key] ?? { status: 404, body: { error: "No such route." } };
      response.statusCode = answer.status ?? 200;
      if (typeof answer.body === "string") response.end(answer.body);
      else {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(answer.body));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.AGENTOS_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (previous === undefined) delete process.env.AGENTOS_API_URL;
  else process.env.AGENTOS_API_URL = previous;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seen = [];
  answers = {};
});

async function call(name: string, args: Record<string, unknown>) {
  const definition = AGENTOS_TOOLS.find((entry) => entry.name === name);
  assert.ok(definition, `there is a ${name} tool`);
  const result = await (definition.handler as (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>)(args, {});
  return { text: result.content.map((part) => part.text).join(""), isError: result.isError === true };
}

describe("AgentOS's tools for a chat", () => {
  it("adds a task through the same route Projects uses", async () => {
    answers["POST /api/projects/virtara/tasks"] = { status: 201, body: { taskId: "VI-007" } };
    const result = await call("add_task", { project: "virtara", title: "Call Sam about the quote", section: "next" });
    assert.deepEqual(seen[0], { method: "POST", url: "/api/projects/virtara/tasks", body: { title: "Call Sam about the quote", section: "next" } });
    assert.match(result.text, /Added VI-007 to virtara/);
  });

  it("saves an email as a draft and never sends it", async () => {
    answers["POST /api/mail/compose"] = { body: { ok: true } };
    const result = await call("draft_email", { to: ["sam@example.com"], subject: "Quote", body: "Hi Sam" });
    assert.equal((seen[0].body as { mode: string }).mode, "draft");
    assert.match(result.text, /hasn't been sent/);
  });

  it("gives the inbox as short rows, without newsletter padding", async () => {
    answers["GET /api/mail"] = {
      body: {
        needsYou: [{ threadId: "t1", fromName: "Sam", fromEmail: "sam@example.com", subject: "Quote", snippet: "You&#39;re up ‌‌ next", messageDate: "2026-10-28" }],
        fyi: [],
        lowPriority: [{ threadId: "t2" }],
      },
    };
    const parsed = JSON.parse((await call("check_mail", {})).text) as { needsYou: Array<{ from: string; preview: string }>; lowPriority?: unknown };
    assert.equal(parsed.needsYou[0].from, "Sam <sam@example.com>");
    assert.equal(parsed.needsYou[0].preview, "You're up next");
    assert.equal(parsed.lowPriority, undefined, "low priority only when asked for");
  });

  it("passes the agenda through as text", async () => {
    answers["GET /api/today/agenda"] = { body: "Calendar for Thursday\nNo events today." };
    assert.match((await call("today_agenda", {})).text, /No events today/);
  });

  it("searches the vault and reads a note", async () => {
    answers["GET /api/memory/search"] = { body: { hits: [{ id: "a.md", title: "A", snippet: "pricing", score: 3 }] } };
    answers["GET /api/memory/note"] = { body: { title: "A", content: "Body of A" } };
    assert.match((await call("search_memory", { query: "pricing" })).text, /"id": "a.md"/);
    assert.match(seen[0].url, /q=pricing/);
    assert.match((await call("read_note", { id: "a.md" })).text, /Body of A/);
  });

  it("lists only open tasks unless asked for done ones", async () => {
    answers["GET /api/projects/virtara/tasks"] = { body: { tasks: [{ id: "VI-1", title: "Open", completed: false }, { id: "VI-2", title: "Done", completed: true }] } };
    const open = await call("list_tasks", { project: "virtara" });
    assert.match(open.text, /VI-1/);
    assert.doesNotMatch(open.text, /VI-2/);
    assert.match((await call("list_tasks", { project: "virtara", includeDone: true })).text, /VI-2/);
  });

  it("starts an Operator run and says where to follow it", async () => {
    answers["POST /api/operator/runs"] = { status: 202, body: { id: "run_1" } };
    const result = await call("start_operator_run", { request: "Plan the Virtara launch", mode: "plan" });
    assert.deepEqual(seen[0].body, { input: "Plan the Virtara launch", mode: "plan" });
    assert.match(result.text, /\/operator\/runs\/run_1/);
  });

  it("turns a refusal into the route's own words, as a tool error", async () => {
    answers["POST /api/projects/nope/tasks"] = { status: 404, body: { error: "There is no project called nope." } };
    const result = await call("add_task", { project: "nope", title: "x" });
    assert.equal(result.isError, true);
    assert.match(result.text, /There is no project called nope/);
  });
});

describe("AgentOS's tools under the chat policy", () => {
  const context = { projectRoot: "/vault/assistant", mode: "assistant" as const };

  it("lets them through without asking, but still asks for any other connector", () => {
    assert.equal(decideToolUse("mcp__agentos__add_task", { project: "virtara", title: "x" }, context).decision, "allow");
    assert.equal(decideToolUse("mcp__gmail__send_message", {}, context).decision, "ask");
  });

  it("names them plainly in the transcript", () => {
    assert.equal(toolDisplayName("mcp__agentos__add_task"), "AgentOS · add task");
    assert.equal(toolDisplayName("Bash"), "Bash");
    assert.equal(summariseToolInput("mcp__agentos__add_task", { project: "virtara", title: "Call Sam" }), "Call Sam");
  });
});
