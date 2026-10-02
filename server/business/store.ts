import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BusinessEntitySchema, DEFAULT_BUSINESS_ENTITIES, WorkspaceSlugSchema, type BusinessEntity } from "../../shared/business-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The local Business record: which companies exist, which workspaces do their
 * work, and which workspace each client's project lives in.
 *
 * `~/.agentos-ui/business/state.json`, written atomically through one
 * in-process queue so two clicks a moment apart cannot lose each other. The
 * clients themselves are not stored here — Virtec owns them. Only the links
 * AgentOS adds on top are.
 */

const StateSchema = z.object({
  version: z.literal(1),
  entities: z.array(BusinessEntitySchema),
  /** Virtec client id → workspace slug. */
  clientWorkspaces: z.record(z.string(), WorkspaceSlugSchema).default({}),
});

export type BusinessState = z.infer<typeof StateSchema>;

export class BusinessNotFoundError extends Error {}

function stateFile(): string {
  return path.join(uiStateDir(), "business", "state.json");
}

function emptyState(): BusinessState {
  return { version: 1, entities: DEFAULT_BUSINESS_ENTITIES.map((entity) => ({ ...entity, workspaces: [] })), clientWorkspaces: {} };
}

/**
 * The current record. A missing file is the default set of businesses; an
 * unreadable one is an error, because starting over would look exactly like
 * every link having been deleted.
 */
export async function readBusinessState(): Promise<BusinessState> {
  let raw: string;

  try {
    raw = await fs.readFile(stateFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }

  return StateSchema.parse(JSON.parse(raw));
}

async function writeBusinessState(state: BusinessState): Promise<void> {
  await fs.mkdir(path.dirname(stateFile()), { recursive: true });
  const target = stateFile();
  const temporary = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

let queue: Promise<unknown> = Promise.resolve();

function mutate<T>(change: (state: BusinessState) => T): Promise<T> {
  const run = queue.then(async () => {
    const state = await readBusinessState();
    const result = change(state);
    await writeBusinessState(state);
    return result;
  });
  // A failed write must not poison the queue for the next one.
  queue = run.catch(() => undefined);
  return run;
}

export function setEntityWorkspaces(entityId: string, workspaces: string[]): Promise<BusinessEntity> {
  return mutate((state) => {
    const entity = state.entities.find((candidate) => candidate.id === entityId);
    if (!entity) throw new BusinessNotFoundError(`No business "${entityId}"`);
    entity.workspaces = [...new Set(workspaces)];
    return entity;
  });
}

/** Links a client to a workspace, or clears the link with `null`. */
export function setClientWorkspace(clientId: string, workspace: string | null): Promise<void> {
  return mutate((state) => {
    if (workspace === null) delete state.clientWorkspaces[clientId];
    else state.clientWorkspaces[clientId] = workspace;
  });
}
