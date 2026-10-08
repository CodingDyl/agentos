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

export function setProjectRoot(rootPath: string): void {
  currentProjectRoot = path.resolve(rootPath);
}

export function getProjectRoot(): string | null {
  return currentProjectRoot;
}

export function clearProjectRoot(): void {
  currentProjectRoot = null;
}

function validatePath(requestedPath: string): string {
  if (!currentProjectRoot) {
    throw new Error("No project is currently open");
  }

  const resolved = path.resolve(currentProjectRoot, requestedPath);
  const realPath = path.resolve(resolved);

  if (!realPath.startsWith(currentProjectRoot)) {
    throw new Error("Path traversal detected: access outside project root is not allowed");
  }

  return realPath;
}

export async function readFile(requestedPath: string): Promise<string> {
  const safePath = validatePath(requestedPath);
  return await fs.readFile(safePath, "utf-8");
}

export async function writeFile(requestedPath: string, content: string): Promise<void> {
  const safePath = validatePath(requestedPath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, content, "utf-8");
}

export async function listDirectory(requestedPath: string = ""): Promise<FileTreeNode[]> {
  const safePath = validatePath(requestedPath);
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
  const safePath = validatePath(searchPath);
  const results: SearchResult[] = [];

  try {
    const { spawn } = await import("node:child_process");
    
    const rgArgs = [
      "--line-number",
      "--column",
      "--no-heading",
      "--color=never",
      "--max-count=100",
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

      rg.on("error", (error) => {
        reject(error);
      });
    });
  } catch (error) {
    throw new Error(`Search failed: ripgrep is not available or failed to execute`);
  }

  return results.slice(0, 1000);
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
