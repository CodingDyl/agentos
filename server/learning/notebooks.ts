import { randomUUID } from "node:crypto";
import type {
  CreateNotebookRequest,
  Notebook,
  NotebookProviderId,
  UpdateNotebookRequest,
} from "../../shared/learning-types";
import { learningDatabase } from "./db";
import { LearningRequestError } from "./library";

/**
 * Research notebooks, kept beside AgentOS.
 *
 * NotebookLM (or any notebook tool) is where research happens; AgentOS is
 * where what was learned is kept. So a notebook here is a record — a name, a
 * link, the AgentOS sources and learnings gathered for it — and learnings
 * come back through explicit capture, never by reading the notebook.
 *
 * Behind a provider interface so a real integration can be added the day a
 * stable, supported API exists. Until then nothing here talks to NotebookLM:
 * no scraping, no browser automation. The `notebooklm` provider is the same
 * local record, with its link checked to be a NotebookLM address.
 */

export interface NotebookSource {
  title: string;
  url?: string;
}

export interface CreateNotebookInput {
  name: string;
  description?: string;
  externalUrl?: string;
  workspaceId?: string;
  sourceIds?: string[];
  noteIds?: string[];
  externalSources?: NotebookSource[];
}

export interface NotebookProvider {
  readonly id: NotebookProviderId;
  readonly name: string;
  /** Whether the provider can create notebooks in the external tool itself. */
  readonly canCreateExternally: boolean;
  listNotebooks(): Promise<Notebook[]>;
  createNotebook?(input: CreateNotebookInput): Promise<Notebook>;
  addSource?(notebookId: string, source: NotebookSource): Promise<void>;
}

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toNotebook(row: Row): Notebook {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: row.provider === "notebooklm" ? "notebooklm" : "manual",
    externalUrl: typeof row.external_url === "string" ? row.external_url : undefined,
    description: typeof row.description === "string" ? row.description : undefined,
    workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    sourceIds: parseJson<string[]>(row.source_ids, []),
    noteIds: parseJson<string[]>(row.note_ids, []),
    externalSources: parseJson<NotebookSource[]>(row.external_sources, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const NOTEBOOKLM_HOST = "notebooklm.google.com";

/** Which provider a link belongs to; refuses anything but https. */
export function providerForUrl(url: string | undefined): NotebookProviderId {
  if (!url) return "manual";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LearningRequestError("That notebook link is not a valid address.");
  }
  if (parsed.protocol !== "https:") throw new LearningRequestError("Notebook links must be https addresses.");
  return parsed.hostname.toLowerCase() === NOTEBOOKLM_HOST ? "notebooklm" : "manual";
}

export function getNotebook(id: string): Notebook | undefined {
  const row = learningDatabase().prepare("SELECT * FROM notebooks WHERE id = ?").get(id) as Row | undefined;
  return row ? toNotebook(row) : undefined;
}

function insertNotebook(input: CreateNotebookInput): Notebook {
  const now = new Date().toISOString();
  const id = `nb-${randomUUID().slice(0, 12)}`;
  learningDatabase()
    .prepare(
      `INSERT INTO notebooks (id, name, provider, external_url, description, workspace_id, source_ids, note_ids, external_sources, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name.trim(),
      providerForUrl(input.externalUrl),
      input.externalUrl ?? null,
      input.description ?? null,
      input.workspaceId ?? null,
      JSON.stringify([...new Set(input.sourceIds ?? [])]),
      JSON.stringify([...new Set(input.noteIds ?? [])]),
      JSON.stringify(input.externalSources ?? []),
      now,
      now,
    );
  return getNotebook(id)!;
}

/** The local record. Every notebook is one of these, whatever tool holds the research. */
export const localNotebookProvider: NotebookProvider = {
  id: "manual",
  name: "Linked notebook",
  canCreateExternally: false,
  async listNotebooks() {
    return (learningDatabase().prepare("SELECT * FROM notebooks ORDER BY updated_at DESC").all() as Row[]).map(toNotebook);
  },
  async createNotebook(input) {
    return insertNotebook(input);
  },
  async addSource(notebookId, source) {
    const notebook = getNotebook(notebookId);
    if (!notebook) throw new LearningRequestError("There is no notebook with that id.", 404);
    updateNotebook(notebookId, { externalSources: [...notebook.externalSources, source] });
  },
};

/** Registered providers. A NotebookLM API adapter would be added here, not wired around it. */
export const NOTEBOOK_PROVIDERS: readonly NotebookProvider[] = [localNotebookProvider];

export function listNotebooks(): Promise<Notebook[]> {
  return localNotebookProvider.listNotebooks();
}

export function createNotebook(request: CreateNotebookRequest): Promise<Notebook> {
  return localNotebookProvider.createNotebook!(request);
}

export function updateNotebook(id: string, changes: UpdateNotebookRequest): Notebook {
  const current = getNotebook(id);
  if (!current) throw new LearningRequestError("There is no notebook with that id.", 404);

  const externalUrl = changes.externalUrl ?? current.externalUrl;
  learningDatabase()
    .prepare(
      "UPDATE notebooks SET name = ?, provider = ?, external_url = ?, description = ?, workspace_id = ?, source_ids = ?, note_ids = ?, external_sources = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      changes.name?.trim() ?? current.name,
      providerForUrl(externalUrl),
      externalUrl ?? null,
      changes.description ?? current.description ?? null,
      changes.workspaceId ?? current.workspaceId ?? null,
      JSON.stringify([...new Set(changes.sourceIds ?? current.sourceIds)]),
      JSON.stringify([...new Set(changes.noteIds ?? current.noteIds)]),
      JSON.stringify(changes.externalSources ?? current.externalSources),
      new Date().toISOString(),
      id,
    );
  return getNotebook(id)!;
}

export function deleteNotebook(id: string): void {
  const result = learningDatabase().prepare("DELETE FROM notebooks WHERE id = ?").run(id);
  if (result.changes === 0) throw new LearningRequestError("There is no notebook with that id.", 404);
}
