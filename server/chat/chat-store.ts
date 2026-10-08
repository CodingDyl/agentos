import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CHAT_ID, ChatSchema, type Chat, type ChatSummary } from "../../shared/chat-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Every chat, one JSON file each, outside the vault.
 *
 * `~/.agentos-ui/chats/<id>.json`, written atomically (temp file, then
 * rename) with writes to one chat serialised, so a crash mid-write leaves the
 * previous version and two updates can never interleave. Ids are minted here;
 * anything else never reaches the filesystem.
 */

const MAX_LISTED = 200;

function directory(): string {
  return path.join(uiStateDir(), "chats");
}

export function isChatId(id: string): boolean {
  return CHAT_ID.test(id);
}

export function createChatId(): string {
  return `chat_${randomUUID().replace(/-/g, "")}`;
}

function fileFor(id: string): string {
  if (!isChatId(id)) throw new Error("Not a chat id.");
  return path.join(directory(), `${id}.json`);
}

const queues = new Map<string, Promise<unknown>>();

export async function saveChat(chat: Chat): Promise<Chat> {
  const previous = queues.get(chat.id) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
    const target = fileFor(chat.id);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    // Owner-only: a transcript can hold anything the agent read on this machine.
    await fs.writeFile(temporary, `${JSON.stringify(chat, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  });
  queues.set(chat.id, next.catch(() => undefined));
  await next;
  return chat;
}

export async function readChat(id: string): Promise<Chat | undefined> {
  if (!isChatId(id)) return undefined;
  try {
    const parsed = ChatSchema.safeParse(JSON.parse(await fs.readFile(fileFor(id), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function deleteChat(id: string): Promise<boolean> {
  if (!isChatId(id)) return false;
  try {
    await fs.rm(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

export function summariseChat(chat: Chat): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    agent: chat.agent,
    model: chat.model,
    status: chat.status,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  };
}

/** Most recently active first: the chat you were just in is the one you want back. */
export async function listChats(limit = MAX_LISTED): Promise<ChatSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory());
  } catch {
    return [];
  }

  const chats = await Promise.all(
    names.filter((name) => name.endsWith(".json")).map((name) => readChat(name.slice(0, -".json".length))),
  );

  return chats
    .filter((chat): chat is Chat => chat !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map(summariseChat);
}

/** A title from the first thing said: short enough for a sidebar row. */
export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line || "New chat";
}
