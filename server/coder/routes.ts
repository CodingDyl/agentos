import express from "express";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import {
  OpenProjectRequestSchema,
  ReadFileRequestSchema,
  WriteFileRequestSchema,
  ListDirectoryRequestSchema,
  SearchFilesRequestSchema,
  CreateTerminalRequestSchema,
  CloneWorkspaceRequestSchema,
  GitStageRequestSchema,
  GitUnstageRequestSchema,
  GitCommitRequestSchema,
  GitDiscardRequestSchema,
  GitSwitchBranchRequestSchema,
  GitDiffRequestSchema,
} from "../../shared/coder-types";
import {
  setProjectRoot,
  getProjectRoot,
  clearProjectRoot,
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getPackageJsonScripts,
  getGitBranch,
} from "./file-operations";
import {
  createTerminal,
  getTerminal,
  writeToTerminal,
  resizeTerminal,
  killTerminal,
  killAllTerminals,
  getTerminalIds,
} from "./pty-manager";
import { generateTerminalToken, validateTerminalToken } from "./terminal-tokens";
import {
  getWorkspaceClonePath,
  cloneRepository,
  pullRepository,
  detectPackageManager,
  detectDevCommand,
  setupEnvFile,
} from "./workspace-setup";
import {
  getGitStatus,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  discardChanges,
  listBranches,
  switchBranch,
  pullChanges,
  pushChanges,
} from "./git-operations";

export const coderRouter = express.Router();

const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

function checkOrigin(req: express.Request): boolean {
  const origin = req.get("origin");
  
  if (!origin) {
    return req.get("host")?.includes("localhost") ?? false;
  }
  
  return ALLOWED_ORIGINS.has(origin);
}

function requireOrigin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!checkOrigin(req)) {
    res.status(403).json({ error: "Forbidden: Invalid origin" });
    return;
  }
  next();
}

coderRouter.post("/open-project", requireOrigin, async (req, res) => {
  try {
    const { path: projectPath, workspaceSlug } = OpenProjectRequestSchema.parse(req.body);
    
    killAllTerminals();
    
    await setProjectRoot(projectPath);
    
    const [fileTree, scripts, gitBranch] = await Promise.all([
      listDirectory(""),
      getPackageJsonScripts(),
      getGitBranch(),
    ]);

    res.json({
      success: true,
      rootPath: projectPath,
      fileTree,
      scripts,
      gitBranch,
      workspaceSlug,
    });
  } catch (error) {
    console.error("Failed to open project:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to open project",
    });
  }
});

coderRouter.post("/close-project", requireOrigin, (_req, res) => {
  try {
    killAllTerminals();
    clearProjectRoot();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to close project",
    });
  }
});

coderRouter.get("/project-state", async (_req, res) => {
  try {
    const rootPath = getProjectRoot();
    if (!rootPath) {
      res.json({
        rootPath: null,
        gitBranch: null,
        scripts: [],
        terminals: [],
      });
      return;
    }

    const [scripts, gitBranch] = await Promise.all([
      getPackageJsonScripts(),
      getGitBranch(),
    ]);

    const terminals = getTerminalIds().map(id => ({
      id,
      title: `Terminal ${id.slice(0, 8)}`,
    }));

    res.json({
      rootPath,
      gitBranch,
      scripts,
      terminals,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to get project state",
    });
  }
});

coderRouter.post("/read-file", requireOrigin, async (req, res) => {
  try {
    const { path } = ReadFileRequestSchema.parse(req.body);
    const content = await readFile(path);
    res.json({ success: true, content });
  } catch (error) {
    console.error("Failed to read file:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to read file",
    });
  }
});

coderRouter.post("/write-file", requireOrigin, async (req, res) => {
  try {
    const { path, content } = WriteFileRequestSchema.parse(req.body);
    await writeFile(path, content);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to write file:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to write file",
    });
  }
});

coderRouter.post("/list-directory", requireOrigin, async (req, res) => {
  try {
    const { path } = ListDirectoryRequestSchema.parse(req.body);
    const nodes = await listDirectory(path);
    res.json({ success: true, nodes });
  } catch (error) {
    console.error("Failed to list directory:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list directory",
    });
  }
});

coderRouter.post("/search-files", requireOrigin, async (req, res) => {
  try {
    const { query, path } = SearchFilesRequestSchema.parse(req.body);
    const results = await searchFiles(query, path);
    res.json({ success: true, results });
  } catch (error) {
    console.error("Failed to search files:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to search files",
    });
  }
});

coderRouter.post("/terminal/create", requireOrigin, (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({
        success: false,
        error: "No project is currently open",
      });
      return;
    }

    const body = CreateTerminalRequestSchema.parse(req.body);
    const cwd = body.cwd;
    
    const resolvedCwd = cwd && cwd !== projectRoot ? cwd : projectRoot;
    
    if (!resolvedCwd.startsWith(projectRoot)) {
      res.status(400).json({
        success: false,
        error: "Terminal cwd must be within project root",
      });
      return;
    }

    const { id, shell } = createTerminal(resolvedCwd);
    const token = generateTerminalToken(id);
    
    res.json({ success: true, id, shell, token });
  } catch (error) {
    console.error("Failed to create terminal:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create terminal",
    });
  }
});

coderRouter.delete("/terminal/:id", requireOrigin, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    killTerminal(id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to kill terminal",
    });
  }
});

export function handleTerminalWebSocket(ws: WebSocket, request: IncomingMessage, token: string | null): void {
  const origin = request.headers.origin;
  
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    ws.close(1008, "Forbidden: Invalid origin");
    return;
  }

  if (!token) {
    ws.close(1008, "Missing token");
    return;
  }

  const terminalId = validateTerminalToken(token);
  
  if (!terminalId) {
    ws.close(1008, "Invalid or expired token");
    return;
  }

  const terminal = getTerminal(terminalId);
  
  if (!terminal) {
    ws.close(1008, "Terminal not found");
    return;
  }

  const dataDisposable = terminal.pty.onData((data: string) => {
    try {
      ws.send(JSON.stringify({ type: "data", data }));
    } catch (error) {
      console.error("Failed to send terminal data:", error);
    }
  });

  const exitDisposable = terminal.pty.onExit(() => {
    try {
      ws.send(JSON.stringify({ type: "exit" }));
      ws.close();
    } catch (error) {
      console.error("Failed to send exit message:", error);
    }
  });

  ws.on("message", (message: Buffer) => {
    try {
      const parsed = JSON.parse(message.toString());
      
      if (parsed.type === "input") {
        writeToTerminal(terminalId, parsed.data);
      } else if (parsed.type === "resize") {
        resizeTerminal(terminalId, parsed.cols, parsed.rows);
      }
    } catch (error) {
      console.error("Failed to handle terminal message:", error);
    }
  });

  ws.on("close", () => {
    dataDisposable.dispose();
    exitDisposable.dispose();
  });
}

// Workspace setup routes
coderRouter.post("/workspace/clone", requireOrigin, async (req, res) => {
  try {
    const { workspaceSlug, repoUrl } = CloneWorkspaceRequestSchema.parse(req.body);
    
    const targetPath = getWorkspaceClonePath(workspaceSlug);
    
    await cloneRepository(repoUrl, targetPath);
    
    res.json({ success: true, path: targetPath });
  } catch (error) {
    console.error("Failed to clone repository:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to clone repository",
    });
  }
});

coderRouter.post("/workspace/pull", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const result = await pullRepository(projectRoot);
    res.json(result);
  } catch (error) {
    console.error("Failed to pull repository:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to pull repository",
    });
  }
});

coderRouter.post("/workspace/detect-package-manager", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const packageManager = await detectPackageManager(projectRoot);
    res.json({ success: true, packageManager });
  } catch (error) {
    console.error("Failed to detect package manager:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to detect package manager",
    });
  }
});

coderRouter.post("/workspace/detect-dev-command", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const devCommand = await detectDevCommand(projectRoot);
    res.json({ success: true, devCommand });
  } catch (error) {
    console.error("Failed to detect dev command:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to detect dev command",
    });
  }
});

coderRouter.post("/workspace/setup-env", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const result = await setupEnvFile(projectRoot);
    
    let message = "";
    if (!result.created) {
      message = "Environment file already exists";
    } else if (result.missingKeys.length === 0) {
      message = "Created .env.local with all values";
    } else {
      message = `Created .env.local. Keys needing values: ${result.missingKeys.join(", ")}`;
    }

    res.json({
      success: true,
      created: result.created,
      missingKeys: result.missingKeys,
      message,
    });
  } catch (error) {
    console.error("Failed to setup env file:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to setup env file",
    });
  }
});

// Git operations routes
coderRouter.get("/git/status", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const status = await getGitStatus(projectRoot);
    res.json({ success: true, status });
  } catch (error) {
    console.error("Failed to get git status:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get git status",
    });
  }
});

coderRouter.post("/git/diff", requireOrigin, async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const { path, staged } = GitDiffRequestSchema.parse(req.body);
    const diff = await getGitDiff(projectRoot, path, staged);
    res.json({ success: true, diff });
  } catch (error) {
    console.error("Failed to get git diff:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get git diff",
    });
  }
});

coderRouter.post("/git/stage", requireOrigin, async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const { files, all } = GitStageRequestSchema.parse(req.body);
    await stageFiles(projectRoot, files, all);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to stage files:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to stage files",
    });
  }
});

coderRouter.post("/git/unstage", requireOrigin, async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const { files, all } = GitUnstageRequestSchema.parse(req.body);
    await unstageFiles(projectRoot, files, all);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to unstage files:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to unstage files",
    });
  }
});

coderRouter.post("/git/commit", requireOrigin, async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const { message } = GitCommitRequestSchema.parse(req.body);
    await commitChanges(projectRoot, message);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to commit changes:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to commit changes",
    });
  }
});

coderRouter.post("/git/discard", requireOrigin, async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const { files } = GitDiscardRequestSchema.parse(req.body);
    await discardChanges(projectRoot, files);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to discard changes:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to discard changes",
    });
  }
});

coderRouter.get("/git/branches", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const branches = await listBranches(projectRoot);
    res.json({ success: true, branches });
  } catch (error) {
    console.error("Failed to list branches:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list branches",
    });
  }
});

coderRouter.post("/git/switch-branch", requireOrigin, async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const { branch, create } = GitSwitchBranchRequestSchema.parse(req.body);
    await switchBranch(projectRoot, branch, create);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to switch branch:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to switch branch",
    });
  }
});

coderRouter.post("/git/pull", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const result = await pullChanges(projectRoot);
    res.json(result);
  } catch (error) {
    console.error("Failed to pull changes:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to pull changes",
    });
  }
});

coderRouter.post("/git/push", requireOrigin, async (_req, res) => {
  try {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      res.status(400).json({ success: false, error: "No project is currently open" });
      return;
    }

    const result = await pushChanges(projectRoot);
    res.json(result);
  } catch (error) {
    console.error("Failed to push changes:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to push changes",
    });
  }
});
