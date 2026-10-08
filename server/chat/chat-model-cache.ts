import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ChatModelSchema, type ChatAgentId, type ChatModel } from "../../shared/chat-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The models each agent has said it offers.
 *
 * Codex, Gemini CLI and Hermes each know their own model list, and it changes
 * with their releases and the operator's plan. AgentOS never guesses it: an
 * agent starts with just "Default", and the list fills in the first time the
 * agent is asked. Kept on disk so the picker is right after a restart too.
 */

const CacheSchema = z.record(z.string(), z.object({ models: z.array(ChatModelSchema), updatedAt: z.string() }));

function file(): string {
  return path.join(uiStateDir(), "chat-models.json");
}

let memory: z.infer<typeof CacheSchema> | undefined;

function load(): z.infer<typeof CacheSchema> {
  if (memory) return memory;
  try {
    const parsed = CacheSchema.safeParse(JSON.parse(fs.readFileSync(file(), "utf8")));
    memory = parsed.success ? parsed.data : {};
  } catch {
    memory = {};
  }
  return memory;
}

export function cachedModels(agent: ChatAgentId): ChatModel[] {
  return load()[agent]?.models ?? [];
}

export function rememberModels(agent: ChatAgentId, models: readonly ChatModel[]): void {
  if (models.length === 0) return;
  const cache = load();
  const same = JSON.stringify(cache[agent]?.models) === JSON.stringify(models);
  cache[agent] = { models: [...models], updatedAt: new Date().toISOString() };
  if (same) return;
  try {
    fs.mkdirSync(uiStateDir(), { recursive: true });
    fs.writeFileSync(file(), `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error("[agentos] chat: could not save the model list:", error);
  }
}

/** For tests: forget what was loaded, so the next read comes from disk. */
export function resetModelCacheForTests(): void {
  memory = undefined;
}
