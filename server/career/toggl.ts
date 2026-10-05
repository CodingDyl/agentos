import { authorize } from "../connectors/policy";
import { addDays } from "../../shared/traction-dates";

/**
 * Toggl Track, read-only: the week's time entries and the workspace's project
 * names. The only Toggl code in AgentOS; the transform lives in the
 * timesheet script, which never sees the token.
 *
 * The token is `TOGGL_API_TOKEN` in `.env` (Connectors → Toggl Track). Toggl's
 * v9 API takes it as HTTP basic auth with the literal password `api_token`.
 */

const TOGGL_API = "https://api.track.toggl.com/api/v9";

export class TogglError extends Error {}

export function togglToken(): string | undefined {
  return process.env.TOGGL_API_TOKEN?.trim() || undefined;
}

export function togglWorkspaceId(): string | undefined {
  const value = process.env.TOGGL_WORKSPACE_ID?.trim();
  return value && /^\d{1,12}$/.test(value) ? value : undefined;
}

async function togglGet<T>(pathAndQuery: string): Promise<T> {
  const token = togglToken();
  if (!token) throw new TogglError("TOGGL_API_TOKEN is not set. Add it in Connectors → Toggl Track.");

  let response: Response;
  try {
    response = await fetch(`${TOGGL_API}${pathAndQuery}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${token}:api_token`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new TogglError("Couldn't reach Toggl.");
  }
  if (response.status === 401 || response.status === 403) throw new TogglError("Toggl rejected TOGGL_API_TOKEN.");
  if (!response.ok) throw new TogglError(`Toggl responded with ${response.status}.`);
  return (await response.json()) as T;
}

export interface TogglEntry {
  id: number;
  description?: string | null;
  start: string;
  duration: number;
  project_id?: number | null;
  tags?: string[] | null;
}

export interface TogglProject {
  id: number;
  name: string;
}

/** Entries that start between `from` and `to` inclusive, plus the project names to read them by. */
export async function readTogglWeek(from: string, to: string): Promise<{ entries: TogglEntry[]; projects: TogglProject[] }> {
  const decision = authorize("toggl.read_time_entries", { initiator: "person", detail: `week of ${from}` });
  if (!decision.allowed) throw new TogglError(decision.reason);

  const query = new URLSearchParams({ start_date: from, end_date: addDays(to, 1) });
  const entries = await togglGet<TogglEntry[]>(`/me/time_entries?${query}`);

  const workspace = togglWorkspaceId();
  const projects = workspace
    ? await togglGet<TogglProject[]>(`/workspaces/${workspace}/projects?active=both&per_page=200`)
    : await togglGet<TogglProject[]>("/me/projects");

  return {
    entries: Array.isArray(entries) ? entries : [],
    projects: (Array.isArray(projects) ? projects : []).map((project) => ({ id: project.id, name: project.name })),
  };
}

/** For the connector test: who the token belongs to. */
export async function togglMe(): Promise<{ email?: string; fullname?: string }> {
  return togglGet("/me");
}
