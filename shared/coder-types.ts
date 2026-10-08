import { z } from "zod";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export interface FileContent {
  content: string;
  path: string;
}

export interface SearchResult {
  path: string;
  lineNumber: number;
  line: string;
  matchStart: number;
  matchEnd: number;
}

export interface PackageJsonScript {
  name: string;
  command: string;
}

export interface ProjectState {
  rootPath: string;
  openFiles: string[];
  activeFile: string | null;
  terminals: {
    id: string;
    title: string;
  }[];
  gitBranch: string | null;
}

export const OpenProjectRequestSchema = z.object({
  path: z.string(),
  workspaceSlug: z.string().optional(),
});

export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;

export const ReadFileRequestSchema = z.object({
  path: z.string(),
});

export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;

export const WriteFileRequestSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>;

export const ListDirectoryRequestSchema = z.object({
  path: z.string(),
});

export type ListDirectoryRequest = z.infer<typeof ListDirectoryRequestSchema>;

export const SearchFilesRequestSchema = z.object({
  query: z.string(),
  path: z.string().optional(),
});

export type SearchFilesRequest = z.infer<typeof SearchFilesRequestSchema>;

export const CreateTerminalRequestSchema = z.object({
  cwd: z.string().optional(),
});

export type CreateTerminalRequest = z.infer<typeof CreateTerminalRequestSchema>;

export const TerminalInputSchema = z.object({
  terminalId: z.string(),
  data: z.string(),
});

export type TerminalInput = z.infer<typeof TerminalInputSchema>;

export const ResizeTerminalSchema = z.object({
  terminalId: z.string(),
  cols: z.number(),
  rows: z.number(),
});

export type ResizeTerminal = z.infer<typeof ResizeTerminalSchema>;

// Workspace setup types
export interface SetupStep {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error";
  message?: string;
}

export interface SetupProgress {
  workspaceSlug: string;
  steps: SetupStep[];
  terminalId?: string;
}

export const CloneWorkspaceRequestSchema = z.object({
  workspaceSlug: z.string(),
  repoUrl: z.string(),
});

export type CloneWorkspaceRequest = z.infer<typeof CloneWorkspaceRequestSchema>;

export const InstallDependenciesRequestSchema = z.object({
  workspaceSlug: z.string(),
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).optional(),
});

export type InstallDependenciesRequest = z.infer<typeof InstallDependenciesRequestSchema>;

export const SetupEnvRequestSchema = z.object({
  workspaceSlug: z.string(),
});

export type SetupEnvRequest = z.infer<typeof SetupEnvRequestSchema>;

export interface EnvSetupResult {
  created: boolean;
  missingKeys: string[];
  message: string;
}

// Git operations types
export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  clean: boolean;
}

export interface GitFileStatus {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
}

export interface GitDiff {
  path: string;
  oldContent: string;
  newContent: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

export const GitStageRequestSchema = z.object({
  files: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export type GitStageRequest = z.infer<typeof GitStageRequestSchema>;

export const GitUnstageRequestSchema = z.object({
  files: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export type GitUnstageRequest = z.infer<typeof GitUnstageRequestSchema>;

export const GitCommitRequestSchema = z.object({
  message: z.string().min(1),
});

export type GitCommitRequest = z.infer<typeof GitCommitRequestSchema>;

export const GitDiscardRequestSchema = z.object({
  files: z.array(z.string()),
});

export type GitDiscardRequest = z.infer<typeof GitDiscardRequestSchema>;

export const GitSwitchBranchRequestSchema = z.object({
  branch: z.string(),
  create: z.boolean().optional(),
});

export type GitSwitchBranchRequest = z.infer<typeof GitSwitchBranchRequestSchema>;

export const GitDiffRequestSchema = z.object({
  path: z.string(),
  staged: z.boolean().optional(),
});

export type GitDiffRequest = z.infer<typeof GitDiffRequestSchema>;
