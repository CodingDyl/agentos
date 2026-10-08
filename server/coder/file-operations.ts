import fs from "node:fs/promises";
import path from "node:path";
import type { FileTreeNode, SearchResult, PackageJsonScript } from "../../shared/coder-types";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
]);

const IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

let currentProjectRoot: string | null = null;
let currentProjectRootReal: string | null = null;

export async function setProjectRoot(rootPath: string): Promise<void> {
  const resolved = path.resolve(rootPath);
  
  try {
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }
    
    const realPath = await fs.realpath(resolved);
    currentProjectRoot = resolved;
    currentProjectRootReal = realPath;
  } catch (error) {
    throw new Error(`Invalid project root: ${(error as Error).message}`, { cause: error });
  }
}

export function getProjectRoot(): string | null {
  return currentProjectRoot;
}

export function clearProjectRoot(): void {
  currentProjectRoot = null;
  currentProjectRootReal = null;
}

async function validatePath(requestedPath: string): Promise<string> {
  if (!currentProjectRoot || !currentProjectRootReal) {
    throw new Error("No project is currently open");
  }

  const resolved = path.resolve(currentProjectRoot, requestedPath);
  
  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      let ancestor = resolved;
      let realAncestor = resolved;
      
      while (ancestor !== currentProjectRoot) {
        try {
          realAncestor = await fs.realpath(ancestor);
          break;
        } catch {
          ancestor = path.dirname(ancestor);
        }
      }
      
      if (ancestor === currentProjectRoot) {
        realAncestor = currentProjectRootReal;
      }
      
      realPath = path.join(realAncestor, path.relative(ancestor, resolved));
    } else {
      throw error;
    }
  }

  const rel = path.relative(currentProjectRootReal, realPath);
  
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected: access outside project root is not allowed");
  }

  return realPath;
}

export async function readFile(requestedPath: string): Promise<string> {
  const safePath = await validatePath(requestedPath);
  return await fs.readFile(safePath, "utf-8");
}

export async function writeFile(requestedPath: string, content: string): Promise<void> {
  const safePath = await validatePath(requestedPath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, content, "utf-8");
}

export async function listDirectory(requestedPath: string = ""): Promise<FileTreeNode[]> {
  const safePath = await validatePath(requestedPath);
  const entries = await fs.readdir(safePath, { withFileTypes: true });

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) {
      continue;
    }

    const relativePath = path.relative(currentProjectRoot!, path.join(safePath, entry.name));

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
      });
    } else if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file",
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

export async function searchFiles(query: string, searchPath: string = ""): Promise<SearchResult[]> {
  const safePath = await validatePath(searchPath);
  const results: SearchResult[] = [];

  try {
    const { spawn } = await import("node:child_process");
    
    const rgArgs = [
      "--line-number",
      "--column",
      "--no-heading",
      "--color=never",
      "--fixed-strings",
      "--max-count=100",
      "--",
      query,
      safePath,
    ];

    await new Promise<void>((resolve, reject) => {
      const rg = spawn("rg", rgArgs, { cwd: safePath });
      let stdout = "";
      let stderr = "";

      rg.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      rg.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      rg.on("close", (code) => {
        if (code === 0 || code === 1) {
          const lines = stdout.split("\n").filter(Boolean);
          for (const line of lines) {
            const match = /^(.+?):(\d+):(\d+):(.+)$/.exec(line);
            if (match) {
              const [, filePath, lineNum, , lineContent] = match;
              const relativePath = path.relative(currentProjectRoot!, filePath);
              
              const lowerLine = lineContent.toLowerCase();
              const lowerQuery = query.toLowerCase();
              const matchStart = lowerLine.indexOf(lowerQuery);
              const matchEnd = matchStart >= 0 ? matchStart + query.length : 0;

              results.push({
                path: relativePath,
                lineNumber: Number.parseInt(lineNum, 10),
                line: lineContent,
                matchStart,
                matchEnd,
              });
            }
          }
          resolve();
        } else {
          reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
        }
      });

      rg.on("error", (rgError) => {
        reject(rgError);
      });
    });
  } catch {
    return await nodeFallbackSearch(query, safePath);
  }

  return results.slice(0, 1000);
}

async function nodeFallbackSearch(query: string, searchPath: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  async function searchDir(dirPath: string): Promise<void> {
    if (results.length >= 1000) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= 1000) break;

        if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");

            for (let i = 0; i < lines.length && results.length < 1000; i++) {
              const line = lines[i];
              const lowerLine = line.toLowerCase();
              const matchStart = lowerLine.indexOf(lowerQuery);

              if (matchStart >= 0) {
                const relativePath = path.relative(currentProjectRoot!, fullPath);
                results.push({
                  path: relativePath,
                  lineNumber: i + 1,
                  line: line,
                  matchStart,
                  matchEnd: matchStart + query.length,
                });
              }
            }
          } catch (readError) {
            // Skip files that can't be read as text
            void readError;
          }
        }
      }
    } catch (dirError) {
      // Skip directories we can't read
      void dirError;
    }
  }

  await searchDir(searchPath);
  return results;
}

export async function getPackageJsonScripts(): Promise<PackageJsonScript[]> {
  if (!currentProjectRoot) {
    return [];
  }

  try {
    const packageJsonPath = path.join(currentProjectRoot, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    if (!packageJson.scripts || typeof packageJson.scripts !== "object") {
      return [];
    }

    return Object.entries(packageJson.scripts).map(([name, command]) => ({
      name,
      command: command as string,
    }));
  } catch {
    return [];
  }
}

export async function getGitBranch(): Promise<string | null> {
  if (!currentProjectRoot) {
    return null;
  }

  try {
    const { spawn } = await import("node:child_process");
    
    return await new Promise<string | null>((resolve) => {
      const git = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: currentProjectRoot!,
      });

      let stdout = "";

      git.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      git.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim() || null);
        } else {
          resolve(null);
        }
      });

      git.on("error", () => {
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}
