import type {
  FileTreeNode,
  SearchResult,
  PackageJsonScript,
} from "@shared/coder-types";

const API_BASE = "http://localhost:3500/api/coder";

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

export async function openProject(path: string, workspaceSlug?: string): Promise<OpenProjectResponse> {
  const response = await fetch(`${API_BASE}/open-project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, workspaceSlug }),
  });
  return await response.json();
}

export async function closeProject(): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/close-project`, {
    method: "POST",
  });
  return await response.json();
}

export async function getProjectState(): Promise<ProjectStateResponse> {
  const response = await fetch(`${API_BASE}/project-state`);
  return await response.json();
}

export async function readFile(path: string): Promise<ReadFileResponse> {
  const response = await fetch(`${API_BASE}/read-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return await response.json();
}

export async function writeFile(path: string, content: string): Promise<WriteFileResponse> {
  const response = await fetch(`${API_BASE}/write-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  return await response.json();
}

export async function listDirectory(path: string): Promise<ListDirectoryResponse> {
  const response = await fetch(`${API_BASE}/list-directory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return await response.json();
}

export async function searchFiles(query: string, path?: string): Promise<SearchFilesResponse> {
  const response = await fetch(`${API_BASE}/search-files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, path }),
  });
  return await response.json();
}

export async function createTerminal(cwd?: string): Promise<CreateTerminalResponse> {
  const response = await fetch(`${API_BASE}/terminal/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  return await response.json();
}

export async function killTerminal(id: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/terminal/${id}`, {
    method: "DELETE",
  });
  return await response.json();
}
