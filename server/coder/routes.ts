import express from "express";
import type { WebSocket } from "ws";
import {
  OpenProjectRequestSchema,
  ReadFileRequestSchema,
  WriteFileRequestSchema,
  ListDirectoryRequestSchema,
  SearchFilesRequestSchema,
  CreateTerminalRequestSchema,
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

export const coderRouter = express.Router();

coderRouter.post("/open-project", async (req, res) => {
  try {
    const { path: projectPath, workspaceSlug } = OpenProjectRequestSchema.parse(req.body);
    
    killAllTerminals();
    
    setProjectRoot(projectPath);
    
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

coderRouter.post("/close-project", (_req, res) => {
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

coderRouter.post("/read-file", async (req, res) => {
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

coderRouter.post("/write-file", async (req, res) => {
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

coderRouter.post("/list-directory", async (req, res) => {
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

coderRouter.post("/search-files", async (req, res) => {
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

coderRouter.post("/terminal/create", (req, res) => {
  try {
    const { cwd } = CreateTerminalRequestSchema.parse(req.body);
    const { id, shell } = createTerminal(cwd);
    res.json({ success: true, id, shell });
  } catch (error) {
    console.error("Failed to create terminal:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create terminal",
    });
  }
});

coderRouter.delete("/terminal/:id", (req, res) => {
  try {
    const { id } = req.params;
    killTerminal(id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to kill terminal",
    });
  }
});

export function handleTerminalWebSocket(ws: WebSocket, terminalId: string): void {
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
