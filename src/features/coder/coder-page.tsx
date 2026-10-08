import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  X,
  Save,
  Search,
  Terminal as TerminalIcon,
  Play,
  FolderOpen,
  Layers,
  Box,
  ScanEye,
} from "lucide-react";
import { AppShell } from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useProjects } from "@/lib/agentos/queries";
import { useCoderStore } from "./coder-store";
import { FileTree } from "./file-tree";
import { CodeEditor } from "./code-editor";
import { Terminal } from "./terminal";
import { WorkspaceSetupWizard } from "./workspace-setup-wizard";
import { GitPanel } from "./git-panel";
import { cn } from "@/lib/utils";
import {
  openProject,
  closeProject,
  writeFile,
  createTerminal,
  killTerminal,
  searchFiles,
} from "@/lib/agentos/coder-api";

export function CoderPage() {
  const navigationItems = useNavigationItems();
  const { data: projectsData } = useProjects();
  const searchParams = useMemo<URLSearchParams>(() => new URLSearchParams(window.location.search), []);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  const {
    projectRoot,
    workspaceSlug,
    fileTree,
    openFiles,
    activeFilePath,
    gitBranch,
    scripts,
    terminals,
    activeTerminalId,
    scanlineOverlay,
    setProject,
    clearProject,
    openFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    markFileSaved,
    addTerminal,
    removeTerminal,
    setActiveTerminal,
    toggleScanlineOverlay,
    saveAllFiles,
  } = useCoderStore();

  const [showProjectPicker, setShowProjectPicker] = useState(!projectRoot);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{
    path: string;
    lineNumber: number;
    line: string;
  }>>([]);
  const [searching, setSearching] = useState(false);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const dirtyCount = openFiles.filter((f) => f.isDirty).length;
  const hasHandledWorkspaceParam = useRef(false);

  const handleOpenWorkspace = useCallback(async (slug: string) => {
    const project = projectsData?.projects.find((p) => p.slug === slug);
    if (!project) return;

    const detailResponse = await fetch(`http://localhost:3500/api/projects/${slug}`);
    if (!detailResponse.ok) {
      alert(`Failed to fetch workspace details for "${project.name}"`);
      return;
    }
    
    const detail = await detailResponse.json();
    const localPath = detail.configuration?.localPath;

    if (!localPath) {
      setShowProjectPicker(false);
      return;
    }

    if (projectRoot && dirtyCount > 0) {
      const confirm = window.confirm(
        `You have ${dirtyCount} unsaved file(s). Close current project?`
      );
      if (!confirm) return;
    }

    if (projectRoot) {
      await closeProject();
      clearProject();
    }

    const result = await openProject(localPath, slug);
    if (result.success && result.rootPath) {
      setProject(
        result.rootPath,
        slug,
        result.fileTree ?? [],
        result.scripts ?? [],
        result.gitBranch ?? null
      );
      setShowProjectPicker(false);
    } else {
      alert(`Failed to open project: ${result.error}`);
    }
  }, [projectRoot, dirtyCount, projectsData, clearProject, setProject]);

  useEffect(() => {
    const workspaceParam = searchParams.get("workspace");
    if (workspaceParam && !projectRoot && projectsData && !hasHandledWorkspaceParam.current) {
      hasHandledWorkspaceParam.current = true;
      void handleOpenWorkspace(workspaceParam);
    }
  }, [searchParams, projectRoot, projectsData, handleOpenWorkspace]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });

      if (!selected || typeof selected !== "string") return;

      if (projectRoot && dirtyCount > 0) {
        const confirm = window.confirm(
          `You have ${dirtyCount} unsaved file(s). Close current project?`
        );
        if (!confirm) return;
      }

      if (projectRoot) {
        await closeProject();
        clearProject();
      }

      const result = await openProject(selected);
      if (result.success && result.rootPath) {
        setProject(
          result.rootPath,
          null,
          result.fileTree ?? [],
          result.scripts ?? [],
          result.gitBranch ?? null
        );
        setShowProjectPicker(false);
      } else {
        alert(`Failed to open folder: ${result.error}`);
      }
    } catch (error) {
      console.error("Failed to open folder:", error);
      alert("Failed to open folder picker");
    }
  }, [projectRoot, dirtyCount, clearProject, setProject]);

  const handleFileOpen = useCallback(
    (path: string, content: string) => {
      openFile(path, content);
    },
    [openFile]
  );

  const handleSaveFile = useCallback(async () => {
    if (!activeFile) return;

    try {
      const result = await writeFile(activeFile.path, activeFile.content);
      if (result.success) {
        markFileSaved(activeFile.path, activeFile.content);
      } else {
        alert(`Failed to save: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to save: ${error}`);
    }
  }, [activeFile, markFileSaved]);

  const handleSaveAll = useCallback(async () => {
    try {
      await saveAllFiles();
    } catch (error) {
      alert(`Failed to save all: ${error}`);
    }
  }, [saveAllFiles]);

  const handleCreateTerminal = useCallback(async () => {
    if (!projectRoot) return;

    try {
      const result = await createTerminal();
      if (result.success && result.id && result.token) {
        addTerminal(result.id, `Terminal ${terminals.length + 1}`, result.token);
      } else {
        alert(`Failed to create terminal: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to create terminal: ${error}`);
    }
  }, [projectRoot, terminals.length, addTerminal]);

  const handleKillTerminal = useCallback(
    async (id: string) => {
      try {
        await killTerminal(id);
        removeTerminal(id);
      } catch (error) {
        console.error("Failed to kill terminal:", error);
      }
    },
    [removeTerminal]
  );

  const handleRunScript = useCallback(async (command: string) => {
    if (!projectRoot) return;

    try {
      const result = await createTerminal();
      if (result.success && result.id && result.token) {
        addTerminal(result.id, `Terminal ${terminals.length + 1}`, result.token);
        
        setTimeout(() => {
          const ws = new WebSocket(`ws://localhost:3500/api/coder/terminal/ws/${result.token}`);
          ws.onopen = () => {
            ws.send(JSON.stringify({ type: "input", data: `${command}\r` }));
          };
        }, 500);
      }
    } catch (error) {
      alert(`Failed to run script: ${error}`);
    }
  }, [projectRoot, terminals.length, addTerminal]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim() || !projectRoot) {
      return;
    }

    setSearching(true);
    try {
      const result = await searchFiles(query);
      if (result.success && result.results) {
        setSearchResults(result.results);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [projectRoot]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        void handleSearch(searchQuery);
      }, 300);
      
      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }
    
    return undefined;
  }, [searchQuery, handleSearch]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void handleSaveAll();
        } else {
          void handleSaveFile();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveFile, handleSaveAll]);

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);

  if (showProjectPicker || (!projectRoot && searchParams.get("workspace"))) {
    const workspaceParam = searchParams.get("workspace");
    const targetProject = workspaceParam ? projectsData?.projects.find(p => p.slug === workspaceParam) : null;
    const needsLocalPath = targetProject && !projectRoot;

    return (
      <AppShell
        navigationItems={navigationItems}
        pageId="coder"
        activeHref="/coder"
        modelLabel="Coder / Part 1"
      >
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] font-mono">
          <div className="w-full max-w-2xl space-y-6 p-8">
            <div className="space-y-2 border-l-4 border-[#00ffcc] pl-4">
              <h1 className="font-mono text-3xl font-bold text-[#00ffcc] tracking-wider glitch-text">
                CODER_
              </h1>
              <p className="text-sm text-[#6a9fb5]">
                {needsLocalPath ? `Link "${targetProject.name}" to open it` : "Select a workspace or open a folder"}
              </p>
            </div>

            {needsLocalPath && (
              <div className="rounded border border-[#ffff0033] bg-[#ffff000d] p-4">
                <p className="text-sm text-[#ffff00]">
                  This workspace has no local path set.
                </p>
                <p className="mt-2 text-xs text-[#6a9fb5]">
                  Automated cloning/setup will be available in Part 2. For now, use the folder picker below to link an existing local folder.
                </p>
              </div>
            )}

            <div className="space-y-4 rounded border border-[#00ffcc33] bg-[#141414] p-6">
              <div>
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#00ccff]">
                  AgentOS Workspaces
                </h2>
                <div className="space-y-2">
                  {projectsData?.projects.map((project) => (
                    <button
                      key={project.slug}
                      type="button"
                      onClick={() => void handleOpenWorkspace(project.slug)}
                      className="flex w-full items-center gap-3 rounded border border-[#00ffcc1a] bg-[#0a0a0a] p-3 text-left transition-colors hover:border-[#00ffcc] hover:bg-[#00ffcc0d]"
                    >
                      <Box className="size-5 shrink-0 text-[#00ccff]" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[#e0e0e0]">{project.name}</div>
                        <div className="truncate text-xs text-[#6a9fb5]">{project.slug}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#00ffcc1a] pt-4">
                <button
                  type="button"
                  onClick={handleOpenFolder}
                  className="flex w-full items-center justify-center gap-2 rounded border border-[#00ffcc] bg-[#00ffcc0d] p-3 font-medium text-[#00ffcc] transition-colors hover:bg-[#00ffcc1a]"
                >
                  <FolderOpen className="size-5" />
                  {needsLocalPath ? "Link Local Folder..." : "Open Folder..."}
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="coder"
      activeHref="/coder"
      modelLabel="Coder / Part 1"
    >
      <div className="relative flex h-screen flex-col bg-[#0a0a0a] font-mono">
        {scanlineOverlay && (
          <div
            className="pointer-events-none absolute inset-0 z-50 opacity-10"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, #00ffcc 2px, #00ffcc 4px)",
            }}
          />
        )}

        <header className="flex items-center justify-between border-b border-[#00ffcc33] bg-[#141414] px-4 py-2">
          <div className="flex items-center gap-4">
            <h1 className="font-bold text-[#00ffcc] glitch-text">CODER_</h1>
            <div className="text-sm text-[#6a9fb5]">
              {workspaceSlug ? (
                <span className="text-[#00ccff]">{workspaceSlug}</span>
              ) : projectRoot ? (
                <span>{projectRoot.split("/").pop()}</span>
              ) : null}
            </div>
            {gitBranch && (
              <div className="flex items-center gap-1 text-xs text-[#ffff00]">
                <Layers className="size-3" />
                {gitBranch}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {dirtyCount > 0 && (
              <button
                type="button"
                onClick={handleSaveAll}
                className="flex items-center gap-1 rounded border border-[#00ffcc33] px-2 py-1 text-xs text-[#00ffcc] transition-colors hover:border-[#00ffcc] hover:bg-[#00ffcc0d]"
                title="Save All (Cmd/Ctrl+Shift+S)"
              >
                <Save className="size-3" />
                Save All ({dirtyCount})
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSearchModal(true)}
              className="rounded border border-[#00ffcc33] p-1 text-[#00ccff] transition-colors hover:border-[#00ccff] hover:bg-[#00ccff0d]"
              title="Find in Files (Cmd/Ctrl+F)"
            >
              <Search className="size-4" />
            </button>

            <button
              type="button"
              onClick={handleCreateTerminal}
              className="rounded border border-[#00ffcc33] p-1 text-[#00ccff] transition-colors hover:border-[#00ccff] hover:bg-[#00ccff0d]"
              title="New Terminal"
            >
              <TerminalIcon className="size-4" />
            </button>

            <button
              type="button"
              onClick={toggleScanlineOverlay}
              className={cn(
                "rounded border border-[#00ffcc33] p-1 transition-colors hover:border-[#00ccff] hover:bg-[#00ccff0d]",
                scanlineOverlay ? "text-[#00ffcc]" : "text-[#6a9fb5]"
              )}
              title="Toggle Scanlines"
            >
              <ScanEye className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowProjectPicker(true)}
              className="rounded border border-[#ff00ff33] p-1 text-[#ff00ff] transition-colors hover:border-[#ff00ff] hover:bg-[#ff00ff0d]"
              title="Switch Project"
            >
              <FolderOpen className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 border-r border-[#00ffcc33]">
            <FileTree
              nodes={fileTree}
              onFileOpen={handleFileOpen}
              selectedPath={activeFilePath}
            />
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-1 border-b border-[#00ffcc33] bg-[#141414] px-2">
              {openFiles.map((file) => (
                <div
                  key={file.path}
                  className={cn(
                    "group relative flex items-center gap-2 border-r border-[#00ffcc1a] px-3 py-2 text-xs",
                    file.path === activeFilePath
                      ? "bg-[#0a0a0a] text-[#00ffcc]"
                      : "text-[#6a9fb5] hover:bg-[#00ffcc0d]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFile(file.path)}
                    className="truncate"
                  >
                    {file.path.split("/").pop()}
                  </button>
                  {file.isDirty && (
                    <div className="size-1.5 rounded-full bg-[#ffff00]" title="Unsaved changes" />
                  )}
                  <button
                    type="button"
                    onClick={() => closeFile(file.path)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-hidden">
              {activeFile ? (
                <CodeEditor
                  key={activeFile.path}
                  value={activeFile.content}
                  path={activeFile.path}
                  onChange={(content) => updateFileContent(activeFile.path, content)}
                  onSave={handleSaveFile}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[#6a9fb5]">
                  No file open
                </div>
              )}
            </div>

            {scripts.length > 0 && (
              <div className="flex items-center gap-2 border-t border-[#00ffcc33] bg-[#141414] px-4 py-2">
                <span className="text-xs text-[#6a9fb5]">Scripts:</span>
                {scripts.slice(0, 5).map((script) => (
                  <button
                    key={script.name}
                    type="button"
                    onClick={() => void handleRunScript(script.command)}
                    className="flex items-center gap-1 rounded border border-[#00ffcc33] px-2 py-1 text-xs text-[#00ccff] transition-colors hover:border-[#00ccff] hover:bg-[#00ccff0d]"
                  >
                    <Play className="size-3" />
                    {script.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {terminals.length > 0 && (
          <div className="flex h-64 flex-col border-t border-[#00ffcc33]">
            <div className="flex items-center gap-1 border-b border-[#00ffcc33] bg-[#141414] px-2">
              {terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  className={cn(
                    "group relative flex items-center gap-2 border-r border-[#00ffcc1a] px-3 py-2 text-xs",
                    terminal.id === activeTerminalId
                      ? "bg-[#0a0a0a] text-[#00ffcc]"
                      : "text-[#6a9fb5] hover:bg-[#00ffcc0d]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveTerminal(terminal.id)}
                  >
                    {terminal.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleKillTerminal(terminal.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex-1">
              {activeTerminal && (
                <Terminal
                  key={activeTerminal.id}
                  terminalId={activeTerminal.id}
                  token={activeTerminal.token}
                  onExit={() => void handleKillTerminal(activeTerminal.id)}
                />
              )}
            </div>
          </div>
        )}

        {showSearchModal && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 pt-20"
            onClick={() => setShowSearchModal(false)}
          >
            <div
              className="w-full max-w-2xl space-y-4 rounded border border-[#00ffcc] bg-[#0a0a0a] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in files..."
                autoFocus
                className="w-full rounded border border-[#00ffcc33] bg-[#141414] px-4 py-2 text-sm text-[#e0e0e0] placeholder-[#6a9fb5] outline-none focus:border-[#00ffcc]"
              />

              <div className="max-h-96 space-y-1 overflow-y-auto">
                {searching ? (
                  <div className="py-8 text-center text-sm text-[#6a9fb5]">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#6a9fb5]">
                    {searchQuery ? "No results" : "Type to search"}
                  </div>
                ) : (
                  searchResults.map((result, index) => (
                    <button
                      key={`${result.path}-${result.lineNumber}-${index}`}
                      type="button"
                      onClick={async () => {
                        const file = openFiles.find((f) => f.path === result.path);
                        if (file) {
                          setActiveFile(result.path);
                        } else {
                          const fileResult = await import("@/lib/agentos/coder-api").then(
                            (m) => m.readFile(result.path)
                          );
                          if (fileResult.success && fileResult.content !== undefined) {
                            handleFileOpen(result.path, fileResult.content);
                          }
                        }
                        setShowSearchModal(false);
                      }}
                      className="w-full rounded p-2 text-left transition-colors hover:bg-[#00ffcc0d]"
                    >
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium text-[#00ccff]">
                          {result.path.split("/").pop()}
                        </span>
                        <span className="text-[#6a9fb5]">:{result.lineNumber}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-[#e0e0e0]">{result.line}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .glitch-text {
          animation: glitch 3s infinite;
        }

        @keyframes glitch {
          0%, 90%, 100% {
            transform: translate(0);
          }
          91% {
            transform: translate(-2px, 0);
          }
          92% {
            transform: translate(2px, 0);
          }
          93% {
            transform: translate(0, -2px);
          }
          94% {
            transform: translate(0, 2px);
          }
          95% {
            transform: translate(-1px, 1px);
          }
          96% {
            transform: translate(1px, -1px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .glitch-text {
            animation: none;
          }
        }
      `}</style>
    </AppShell>
  );
}
