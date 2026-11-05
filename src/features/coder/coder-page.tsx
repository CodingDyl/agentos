import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  X,
  Save,
  Search,
  Terminal as TerminalIcon,
  Play,
  FolderOpen,
  Layers,
  Box,
  GitBranch,
} from "lucide-react";
import { AppShell, PageLoader } from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useProjects } from "@/lib/agentos/queries";
import { getProject } from "@/lib/agentos/client";
import { useCoderStore } from "./coder-store";
import { FileTree } from "./file-tree";
import { CodeEditor } from "./code-editor";
import { Terminal } from "./terminal";
import { WorkspaceSetupWizard } from "./workspace-setup-wizard";
import { GitPanel } from "./git-panel";
import { FolderOpenControl } from "./folder-open-control";
import { cn } from "@/lib/utils";
import {
  openProject,
  closeProject,
  writeFile,
  createTerminal,
  killTerminal,
  searchFiles,
  persistWorkspaceLocalPath,
  coderWebSocketUrl,
  withTimeout,
} from "@/lib/agentos/coder-api";
import {
  WORKSPACE_OPEN_TIMEOUT_MS,
  formatWorkspaceOpenError,
  planWorkspaceOpen,
  shouldAttemptOpenWorkspace,
} from "./open-workspace";

export function CoderPage() {
  const navigationItems = useNavigationItems();
  const { data: projectsData } = useProjects();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
    saveAllFiles,
  } = useCoderStore();

  const [showProjectPicker, setShowProjectPicker] = useState(
    () => !projectRoot && !new URLSearchParams(window.location.search).get("workspace"),
  );
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{
    path: string;
    lineNumber: number;
    line: string;
  }>>([]);
  const [searching, setSearching] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupWorkspace, setSetupWorkspace] = useState<{ slug: string; name: string; repoUrl: string } | null>(null);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const dirtyCount = openFiles.filter((f) => f.isDirty).length;
  const handledWorkspaceParam = useRef<string | null>(null);
  const lastAttemptedSlug = useRef<string | null>(null);

  const openAtPath = useCallback(async (localPath: string, slug: string | null) => {
    if (projectRoot && dirtyCount > 0) {
      const confirm = window.confirm(
        `You have ${dirtyCount} unsaved file(s). Close current project?`
      );
      if (!confirm) return false;
    }

    if (projectRoot) {
      await closeProject();
      clearProject();
    }

    const result = await withTimeout(
      openProject(localPath, slug ?? undefined),
      WORKSPACE_OPEN_TIMEOUT_MS,
      "Timed out opening the project folder. Is AgentOS running?",
    );
    if (result.success && result.rootPath) {
      setProject(
        result.rootPath,
        slug,
        result.fileTree ?? [],
        result.scripts ?? [],
        result.gitBranch ?? null
      );
      setShowProjectPicker(false);
      setShowSetupWizard(false);
      setSetupWorkspace(null);
      setWorkspaceError(null);
      return true;
    }

    throw new Error(result.error || "Failed to open that folder");
  }, [projectRoot, dirtyCount, clearProject, setProject]);

  const handleOpenWorkspace = useCallback(async (slug: string) => {
    lastAttemptedSlug.current = slug;
    setWorkspaceError(null);
    setOpeningSlug(slug);
    try {
      const detail = await withTimeout(
        getProject(slug),
        WORKSPACE_OPEN_TIMEOUT_MS,
        `Timed out loading workspace details for "${slug}". Is AgentOS running?`,
      );
      const plan = planWorkspaceOpen({ slug, name: detail.name, detail });
      if (plan.kind === "setup") {
        setSetupWorkspace({
          slug: plan.slug,
          name: plan.name,
          repoUrl: plan.repoUrl,
        });
        setShowSetupWizard(true);
        setShowProjectPicker(false);
        return;
      }

      await openAtPath(plan.localPath, slug);
    } catch (error) {
      setWorkspaceError(
        formatWorkspaceOpenError(error, `Failed to open workspace "${slug}"`),
      );
    } finally {
      setOpeningSlug(null);
    }
  }, [openAtPath]);

  useEffect(() => {
    const workspaceParam = searchParams.get("workspace");
    if (
      !shouldAttemptOpenWorkspace({
        workspaceParam,
        projectRoot,
        handledWorkspaceParam: handledWorkspaceParam.current,
      })
    ) {
      return;
    }
    handledWorkspaceParam.current = workspaceParam;
    void handleOpenWorkspace(workspaceParam!);
  }, [searchParams, projectRoot, handleOpenWorkspace]);

  const retryOpenWorkspace = useCallback(() => {
    const slug = searchParams.get("workspace") ?? lastAttemptedSlug.current ?? openingSlug;
    if (!slug) return;
    handledWorkspaceParam.current = null;
    setWorkspaceError(null);
    handledWorkspaceParam.current = slug;
    void handleOpenWorkspace(slug);
  }, [searchParams, openingSlug, handleOpenWorkspace]);

  const backToWorkspaces = useCallback(() => {
    handledWorkspaceParam.current = null;
    setWorkspaceError(null);
    setShowProjectPicker(true);
    const slug = searchParams.get("workspace");
    if (slug) {
      setSearchParams({}, { replace: true });
    }
    void navigate("/workspaces");
  }, [navigate, searchParams, setSearchParams]);

  const handleOpenFolderPath = useCallback(async (selected: string) => {
    await openAtPath(selected, null);
  }, [openAtPath]);

  const handleLinkExistingFolder = useCallback(async (path: string) => {
    const slug = setupWorkspace?.slug;
    if (!slug) {
      throw new Error("No workspace is selected to link a folder to.");
    }

    const saved = await persistWorkspaceLocalPath(slug, path);
    if (!saved.success) {
      throw new Error(saved.error || "Failed to save local path");
    }

    await openAtPath(path, slug);
  }, [openAtPath, setupWorkspace?.slug]);

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
        const token = result.token;
        addTerminal(result.id, `Terminal ${terminals.length + 1}`, token);
        
        setTimeout(() => {
          const ws = new WebSocket(coderWebSocketUrl(token));
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

  if (showSetupWizard && setupWorkspace) {
    return (
      <WorkspaceSetupWizard
        workspaceSlug={setupWorkspace.slug}
        workspaceName={setupWorkspace.name}
        repoUrl={setupWorkspace.repoUrl}
        onComplete={(localPath) => {
          void openAtPath(localPath, setupWorkspace.slug);
        }}
        onCancel={() => {
          handledWorkspaceParam.current = searchParams.get("workspace");
          setShowSetupWizard(false);
          setSetupWorkspace(null);
          setShowProjectPicker(true);
          if (searchParams.get("workspace")) {
            setSearchParams({}, { replace: true });
          }
        }}
        onLinkFolder={(path) => handleLinkExistingFolder(path)}
      />
    );
  }

  if (!projectRoot && !showProjectPicker && !showSetupWizard && workspaceError && searchParams.get("workspace")) {
    return (
      <AppShell
        navigationItems={navigationItems}
        pageId="coder"
        activeHref="/coder"
        modelLabel="Coder"
      >
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)]">
          <div className="w-full max-w-lg space-y-6 p-8">
            <div className="space-y-2 border-l-4 border-[var(--status-error)] pl-4">
              <h1 className="font-mono text-[24px] font-semibold text-[var(--status-error)]">
                COULD_NOT_OPEN_
              </h1>
              <p className="text-[14px] text-[var(--text-primary)]">{workspaceError}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={retryOpenWorkspace}
                className="rounded border border-[var(--border-control)] bg-[var(--bg-raised)] px-4 py-2 text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={backToWorkspaces}
                className="rounded border border-[var(--border-control)] px-4 py-2 text-[14px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
              >
                Back to workspaces
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!projectRoot && !showProjectPicker && searchParams.get("workspace")) {
    return (
      <AppShell
        navigationItems={navigationItems}
        pageId="coder"
        activeHref="/coder"
        modelLabel="Coder"
      >
        <PageLoader variant="page" className="min-h-screen" />
      </AppShell>
    );
  }

  if (showProjectPicker) {
    return (
      <AppShell
        navigationItems={navigationItems}
        pageId="coder"
        activeHref="/coder"
        modelLabel="Coder"
      >
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)]">
          <div className="w-full max-w-2xl space-y-6 p-8">
            <div className="space-y-2 ">
              <h1 className="text-[var(--text-primary)]">Coder</h1>
              <p className="text-[14px] text-[var(--text-muted)]">
                Select a workspace or open a folder
              </p>
            </div>

            <div className="space-y-4 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6">
              <div>
                <h2 className="mb-3 text-[14px] font-semibold text-[var(--text-secondary)]">
                  AgentOS Workspaces
                </h2>
                <div className="space-y-2">
                  {projectsData?.projects.map((project) => (
                    <button
                      key={project.slug}
                      type="button"
                      disabled={openingSlug !== null}
                      onClick={() => void handleOpenWorkspace(project.slug)}
                      className="flex w-full items-center gap-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-left transition-colors hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
                    >
                      <Box className="size-5 shrink-0 text-[var(--text-secondary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[var(--text-primary)]">{project.name}</div>
                        <div className="truncate text-[13px] text-[var(--text-muted)]">
                          {openingSlug === project.slug ? "Opening…" : project.slug}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {workspaceError ? (
                <div className="space-y-3 rounded border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] p-3">
                  <p className="text-[14px] text-[var(--status-error)]">{workspaceError}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={retryOpenWorkspace}
                      className="rounded border border-[var(--border-control)] px-3 py-1 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={backToWorkspaces}
                      className="rounded border border-[var(--border-control)] px-3 py-1 text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
                    >
                      Back to workspaces
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="border-t border-[var(--border-subtle)] pt-4">
                <FolderOpenControl
                  label="Open Folder..."
                  onPickPath={handleOpenFolderPath}
                  disabled={openingSlug !== null}
                />
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
        modelLabel="Coder"
    >
      <div className="relative flex h-screen flex-col bg-[var(--bg-canvas)]">

        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2">
          <div className="flex items-center gap-4">
            <h1 data-heading="compact" className="text-[var(--text-primary)]">Coder</h1>
            <div className="text-[14px] text-[var(--text-muted)]">
              {workspaceSlug ? (
                <span className="text-[var(--text-secondary)]">{workspaceSlug}</span>
              ) : projectRoot ? (
                <span>{projectRoot.split("/").pop()}</span>
              ) : null}
            </div>
            {gitBranch && (
              <div className="flex items-center gap-1 text-[13px] text-[var(--status-warning)]">
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
                className="flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 text-[13px] text-[var(--text-primary)] transition-colors hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)]"
                title="Save All (Cmd/Ctrl+Shift+S)"
              >
                <Save className="size-3" />
                Save All ({dirtyCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowGitPanel(!showGitPanel)}
              className={cn(
                "rounded p-2 hover:bg-[var(--bg-raised)]",
                showGitPanel ? "bg-[var(--bg-raised)] text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
              )}
              title="Git Panel"
            >
              <GitBranch className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowSearchModal(true)}
              className="rounded border border-[var(--border-subtle)] p-1 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)]"
              title="Find in Files (Cmd/Ctrl+F)"
            >
              <Search className="size-4" />
            </button>

            <button
              type="button"
              onClick={handleCreateTerminal}
              className="rounded border border-[var(--border-subtle)] p-1 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)]"
              title="New Terminal"
            >
              <TerminalIcon className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowProjectPicker(true)}
              className="rounded border border-[var(--border-subtle)] p-1 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)]"
              title="Switch Project"
            >
              <FolderOpen className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {showGitPanel && (
            <div className="h-full w-96 flex-shrink-0 border-r border-[var(--border-subtle)]">
              <GitPanel />
            </div>
          )}
          <div className="w-64 border-r border-[var(--border-subtle)]">
            <FileTree
              nodes={fileTree}
              onFileOpen={handleFileOpen}
              selectedPath={activeFilePath}
            />
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2">
              {openFiles.map((file) => (
                <div
                  key={file.path}
                  className={cn(
                    "group relative flex items-center gap-2 border-r border-[var(--border-subtle)] px-3 py-2 text-[13px]",
                    file.path === activeFilePath
                      ? "bg-[var(--bg-canvas)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
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
                    <div className="size-1.5 rounded-full bg-[var(--status-warning)]" title="Unsaved changes" />
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
                <div className="flex h-full items-center justify-center text-[14px] text-[var(--text-muted)]">
                  No file open
                </div>
              )}
            </div>

            {scripts.length > 0 && (
              <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2">
                <span className="text-[13px] text-[var(--text-muted)]">Scripts:</span>
                {scripts.slice(0, 5).map((script) => (
                  <button
                    key={script.name}
                    type="button"
                    onClick={() => void handleRunScript(script.command)}
                    className="flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 text-[13px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)]"
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
          <div className="flex h-64 flex-col border-t border-[var(--border-subtle)]">
            <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2">
              {terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  className={cn(
                    "group relative flex items-center gap-2 border-r border-[var(--border-subtle)] px-3 py-2 text-[13px]",
                    terminal.id === activeTerminalId
                      ? "bg-[var(--bg-canvas)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
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
              className="w-full max-w-2xl space-y-4 rounded border border-[var(--border-control)] bg-[var(--bg-canvas)] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in files..."
                autoFocus
                className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-control)]"
              />

              <div className="max-h-96 space-y-1 overflow-y-auto">
                {searching ? (
                  <div className="py-8 text-center text-[14px] text-[var(--text-muted)]">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="py-8 text-center text-[14px] text-[var(--text-muted)]">
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
                      className="w-full rounded p-2 text-left transition-colors hover:bg-[var(--bg-raised)]"
                    >
                      <div className="flex items-baseline gap-2 text-[13px]">
                        <span className="font-medium text-[var(--text-secondary)]">
                          {result.path.split("/").pop()}
                        </span>
                        <span className="text-[var(--text-muted)]">:{result.lineNumber}</span>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-[var(--text-primary)]">{result.line}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
