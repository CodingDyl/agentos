import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { readSession, readSessionMessage } from "../../hermes/sessions";
import { sessionTitleFor } from "../session-resolver";
import * as store from "../session-store";

/**
 * Session mappings are the one thing AgentOS writes, and they are written
 * outside the vault. These tests pin that boundary and the tolerant readers.
 */

let uiDir: string;

before(async () => {
  uiDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-ui-test-"));
  // The store resolves its location per call, so setting this here is enough
  // even though the module is imported statically above.
  process.env.AGENTOS_UI_DIR = uiDir;
});

after(async () => {
  await fs.rm(uiDir, { recursive: true, force: true });
  delete process.env.AGENTOS_UI_DIR;
});

describe("session store", () => {
  it("reports no mappings before anything is written", async () => {
    assert.deepEqual(await store.readSessionMap(), {});
  });

  it("persists a mapping and reads it back", async () => {
    await store.setProjectSession("pantry-pilot", "session-1");

    assert.deepEqual(await store.readSessionMap(), {
      "pantry-pilot": "session-1",
    });
  });

  it("keeps other projects' mappings when one changes", async () => {
    await store.setProjectSession("virtara", "session-2");
    await store.setProjectSession("pantry-pilot", "session-3");

    assert.deepEqual(await store.readSessionMap(), {
      "pantry-pilot": "session-3",
      virtara: "session-2",
    });
  });

  it("writes only inside the UI state directory, never the vault", async () => {
    const entries = await fs.readdir(uiDir);

    assert.deepEqual(entries, ["sessions.json"]);
  });

  it("treats a corrupt file as no mappings rather than failing", async () => {
    await fs.writeFile(path.join(uiDir, "sessions.json"), "{not json", "utf8");

    assert.deepEqual(await store.readSessionMap(), {});
  });

  it("ignores a file whose shape is not a string map", async () => {
    await fs.writeFile(
      path.join(uiDir, "sessions.json"),
      JSON.stringify({ "pantry-pilot": { nested: true } }),
      "utf8",
    );

    assert.deepEqual(await store.readSessionMap(), {});
  });

  it("normalises a project into a lane, defaulting to general", () => {
    assert.equal(store.laneFor("Pantry-Pilot"), "pantry-pilot");
    assert.equal(store.laneFor(undefined), "general");
    assert.equal(store.laneFor("  "), "general");
  });
});

describe("session titles", () => {
  it("names the general lane", () => {
    assert.equal(sessionTitleFor("general"), "AgentOS: General");
  });

  it("humanises a slug", () => {
    assert.equal(sessionTitleFor("pantry-pilot"), "AgentOS: Pantry Pilot");
  });

  it("prefers the project's real name when known", () => {
    assert.equal(sessionTitleFor("voxmachine", "VoxMachine"), "AgentOS: VoxMachine");
  });
});

describe("session payloads", () => {
  it("accepts snake_case and camelCase", () => {
    const session = readSession({
      session_id: "s1",
      title: "AgentOS: General",
      created_at: "2026-09-06T10:00:00Z",
      message_count: 4,
    });

    assert.equal(session.id, "s1");
    assert.equal(session.messageCount, 4);
    assert.equal(session.createdAt, "2026-09-06T10:00:00Z");
  });

  it("reads a session nested under `session`", () => {
    assert.equal(readSession({ session: { id: "nested" } }).id, "nested");
  });

  it("refuses a payload with no id", () => {
    assert.throws(() => readSession({ title: "no id" }), /unreadable session/);
  });
});

describe("transcript messages", () => {
  it("reads a conversational turn", () => {
    const message = readSessionMessage(
      { id: "m1", role: "assistant", content: "Hello", created_at: "2026-09-06T10:00:00Z" },
      0,
    );

    assert.deepEqual(message, {
      id: "m1",
      role: "assistant",
      content: "Hello",
      createdAt: "2026-09-06T10:00:00Z",
    });
  });

  it("keeps a tool turn but leaves structured content unrendered", () => {
    const message = readSessionMessage({ role: "tool", content: { parts: [] } }, 3);

    assert.equal(message?.role, "tool");
    assert.equal(message?.content, undefined);
    assert.equal(message?.id, "message-3");
  });

  it("drops entries with no usable role", () => {
    assert.equal(readSessionMessage({ content: "orphan" }, 0), undefined);
    assert.equal(readSessionMessage({ role: "banana", content: "x" }, 0), undefined);
    assert.equal(readSessionMessage("not an object", 0), undefined);
  });
});
