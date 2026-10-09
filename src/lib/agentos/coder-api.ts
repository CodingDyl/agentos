import type {
  FileTreeNode,
  SearchResult,
  PackageJsonScript,
  GitStatus,
  GitDiff,
  GitBranch,
} from "@shared/coder-types";
import { patchProjectDetails } from "./client";

/** Same-origin adapter path. Vite proxies `/api` to AGENTOS_PORT (8787). */
export const CODER_API_BASE = "/api/coder";
export const CODER_REQUEST_TIMEOUT_MS = 20_000;

interface OpenProjectResponse {
  success: boolean;
  rootPath?: string;
  fileTree?: FileTreeNode[];
  scripts?: PackageJsonScript[];
  gitBranch?: string | null;
  workspaceSlug?: string;
  error?: string;
}

interface ReadFileResponse {
  success: boolean;
  content?: string;
  error?: string;
}

interface WriteFileResponse {
  success: boolean;
  error?: string;
}

interface ListDirectoryResponse {
  success: boolean;
  nodes?: FileTreeNode[];
  error?: string;
}

interface SearchFilesResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
}

interface CreateTerminalResponse {
  success: boolean;
  id?: string;
  shell?: string;
  token?: string;
  error?: string;
}

interface ProjectStateResponse {
  rootPath: string | null;
  gitBranch: string | null;
  scripts: PackageJsonScript[];
  terminals: Array<{ id: string; title: string }>;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function coderWebSocketUrl(token: string): string {
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" && window.location.host ? window.location.host : "localhost";
  return `${protocol}//${host}/api/coder/terminal/ws/${encodeURIComponent(token)}`;
}

function timeoutError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "TimeoutError") ||
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "TimeoutError")
  );
}

async function coderFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CODER_API_BASE}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(CODER_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (timeoutError(error)) {
      throw new Error("The Coder adapter timed out. Is AgentOS running?", { cause: error });
    }
    throw new Error("The Coder adapter is not responding. Is AgentOS running?", { cause: error });
  }

  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (payload === null) {
    throw new Error(
      response.ok ? "The Coder adapter returned an empty response." : `Coder request failed (${response.status})`,
    );
  }
  return payload as T;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function openProject(path: string, workspaceSlug?: string): Promise<OpenProjectResponse> {
  return await coderFetch("/open-project", jsonBody({ path, workspaceSlug }));
}

export async function closeProject(): Promise<{ success: boolean }> {
  return await coderFetch("/close-project", { method: "POST" });
}

export async function getProjectState(): Promise<ProjectStateResponse> {
  return await coderFetch("/project-state");
}

export async function readFile(path: string): Promise<ReadFileResponse> {
  return await coderFetch("/read-file", jsonBody({ path }));
}

export async function writeFile(path: string, content: string): Promise<WriteFileResponse> {
  return await coderFetch("/write-file", jsonBody({ path, content }));
}

export async function listDirectory(path: string): Promise<ListDirectoryResponse> {
  return await coderFetch("/list-directory", jsonBody({ path }));
}

export async function searchFiles(query: string, path?: string): Promise<SearchFilesResponse> {
  return await coderFetch("/search-files", jsonBody({ query, path }));
}

export async function createTerminal(cwd?: string): Promise<CreateTerminalResponse> {
  return await coderFetch("/terminal/create", jsonBody({ cwd }));
}

export async function killTerminal(id: string): Promise<{ success: boolean }> {
  return await coderFetch(`/terminal/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function persistWorkspaceLocalPath(
  workspaceSlug: string,
  localPath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await patchProjectDetails({
      slug: workspaceSlug,
      configuration: { localPath },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save local path",
    };
  }
}

interface CoderResult {
  success: boolean;
  error?: string;
  message?: string;
}

type CoderPayload<T> = CoderResult & T;

export async function cloneWorkspace(
  workspaceSlug: string,
  repoUrl: string,
): Promise<CoderPayload<{ path?: string }>> {
  return await coderFetch("/workspace/clone", jsonBody({ workspaceSlug, repoUrl }));
}

export async function pullWorkspace(): Promise<CoderResult> {
  return await coderFetch("/workspace/pull", { method: "POST", headers: { "Content-Type": "application/json" } });
}

export async function detectPackageManager(): Promise<CoderPayload<{ packageManager?: string }>> {
  return await coderFetch("/workspace/detect-package-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function detectDevCommand(): Promise<CoderPayload<{ devCommand?: string }>> {
  return await coderFetch("/workspace/detect-dev-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function setupEnvFile(): Promise<CoderPayload<{ message?: string }>> {
  return await coderFetch("/workspace/setup-env", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function getGitStatus(): Promise<CoderPayload<{ status: GitStatus }>> {
  return await coderFetch("/git/status");
}

export async function getGitDiff(path: string, staged = false): Promise<CoderPayload<{ diff: GitDiff }>> {
  return await coderFetch("/git/diff", jsonBody({ path, staged }));
}

export async function stageFiles(files?: string[], all = false): Promise<CoderResult> {
  return await coderFetch("/git/stage", jsonBody({ files, all }));
}

export async function unstageFiles(files?: string[], all = false): Promise<CoderResult> {
  return await coderFetch("/git/unstage", jsonBody({ files, all }));
}

export async function commitChanges(message: string): Promise<CoderResult> {
  return await coderFetch("/git/commit", jsonBody({ message }));
}

export async function discardChanges(files: string[]): Promise<CoderResult> {
  return await coderFetch("/git/discard", jsonBody({ files }));
}

export async function getBranches(): Promise<CoderPayload<{ branches: GitBranch[]; current?: string }>> {
  return await coderFetch("/git/branches");
}

export async function switchBranch(branch: string, create = false): Promise<CoderResult> {
  return await coderFetch("/git/switch-branch", jsonBody({ branch, create }));
}

export async function pullGit(): Promise<CoderResult> {
  return await coderFetch("/git/pull", { method: "POST", headers: { "Content-Type": "application/json" } });
}

export async function pushGit(): Promise<CoderResult> {
  return await coderFetch("/git/push", { method: "POST", headers: { "Content-Type": "application/json" } });
}
