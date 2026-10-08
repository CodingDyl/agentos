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
  cwd: z.string(),
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
