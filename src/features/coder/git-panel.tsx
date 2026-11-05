import { useState, useEffect, useCallback } from "react";
import { PageLoader } from "@/components/os";
import {
  GitBranch,
  GitCommit,
  GitMerge,
  Upload,
  RefreshCw,
  Plus,
  Minus,
  Check,
  X,
  FileText,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { DiffEditor } from "@monaco-editor/react";
import type { GitStatus, GitFileStatus, GitBranch as GitBranchType } from "../../../shared/coder-types";
import * as coderApi from "../../lib/agentos/coder-api";

export function GitPanel() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null);
  const [diffContent, setDiffContent] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [showBranchList, setShowBranchList] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    staged: true,
    unstaged: true,
    untracked: true,
  });

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await coderApi.getGitStatus();
      if (result.success && result.status) {
        setStatus(result.status);
      }
    } catch (error) {
      console.error("Failed to load git status:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const result = await coderApi.getBranches();
      if (result.success && result.branches) {
        setBranches(result.branches.filter((b: GitBranchType) => !b.remote));
      }
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialLoad() {
      setLoading(true);
      try {
        const statusResult = await coderApi.getGitStatus();
        if (mounted && statusResult.success && statusResult.status) {
          setStatus(statusResult.status);
        }

        const branchesResult = await coderApi.getBranches();
        if (mounted && branchesResult.success && branchesResult.branches) {
          setBranches(branchesResult.branches.filter((b: GitBranchType) => !b.remote));
        }
      } catch (error) {
        console.error("Failed to load git data:", error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void initialLoad();

    return () => {
      mounted = false;
    };
  }, []);

  const handleFileClick = useCallback(async (file: GitFileStatus) => {
    setSelectedFile(file);
    try {
      const result = await coderApi.getGitDiff(file.path, file.staged);
      if (result.success && result.diff) {
        setDiffContent({
          oldContent: result.diff.oldContent,
          newContent: result.diff.newContent,
        });
      }
    } catch (error) {
      console.error("Failed to load diff:", error);
    }
  }, []);

  const handleStage = useCallback(async (files: string[]) => {
    try {
      const result = await coderApi.stageFiles(files);
      if (result.success) {
        await loadStatus();
        if (selectedFile && files.includes(selectedFile.path)) {
          setSelectedFile(null);
          setDiffContent(null);
        }
      }
    } catch (error) {
      console.error("Failed to stage files:", error);
    }
  }, [loadStatus, selectedFile]);

  const handleUnstage = useCallback(async (files: string[]) => {
    try {
      const result = await coderApi.unstageFiles(files);
      if (result.success) {
        await loadStatus();
        if (selectedFile && files.includes(selectedFile.path)) {
          setSelectedFile(null);
          setDiffContent(null);
        }
      }
    } catch (error) {
      console.error("Failed to unstage files:", error);
    }
  }, [loadStatus, selectedFile]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;

    try {
      const result = await coderApi.commitChanges(commitMessage);
      if (result.success) {
        setCommitMessage("");
        setShowCommitDialog(false);
        await loadStatus();
        setSelectedFile(null);
        setDiffContent(null);
      } else {
        alert(`Commit failed: ${result.error}`);
      }
    } catch (error) {
      alert(`Commit failed: ${error}`);
    }
  }, [commitMessage, loadStatus]);

  const handleDiscard = useCallback(async (files: string[]) => {
    if (!confirm(`Discard changes to ${files.length} file(s)? This cannot be undone.`)) {
      return;
    }

    try {
      const result = await coderApi.discardChanges(files);
      if (result.success) {
        await loadStatus();
        if (selectedFile && files.includes(selectedFile.path)) {
          setSelectedFile(null);
          setDiffContent(null);
        }
      }
    } catch (error) {
      console.error("Failed to discard changes:", error);
    }
  }, [loadStatus, selectedFile]);

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    try {
      const result = await coderApi.switchBranch(branchName, false);
      if (result.success) {
        await loadStatus();
        await loadBranches();
        setShowBranchList(false);
      } else {
        alert(`Failed to switch branch: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to switch branch: ${error}`);
    }
  }, [loadStatus, loadBranches]);

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;

    try {
      const result = await coderApi.switchBranch(newBranchName, true);
      if (result.success) {
        setNewBranchName("");
        await loadStatus();
        await loadBranches();
        setShowBranchList(false);
      } else {
        alert(`Failed to create branch: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to create branch: ${error}`);
    }
  }, [newBranchName, loadStatus, loadBranches]);

  const handlePull = useCallback(async () => {
    try {
      const result = await coderApi.pullGit();
      if (result.success) {
        await loadStatus();
        alert(result.message);
      } else {
        alert(`Pull failed: ${result.message}`);
      }
    } catch (error) {
      alert(`Pull failed: ${error}`);
    }
  }, [loadStatus]);

  const handlePush = useCallback(async () => {
    try {
      const result = await coderApi.pushGit();
      if (result.success) {
        await loadStatus();
        alert(result.message);
      } else {
        alert(`Push failed: ${result.message}`);
      }
    } catch (error) {
      alert(`Push failed: ${error}`);
    }
  }, [loadStatus]);

  if (!status) {
    return <PageLoader variant="compact" className="h-full" />;
  }

  const stagedFiles = status.files.filter((f) => f.staged);
  const unstagedFiles = status.files.filter((f) => !f.staged && f.status !== "untracked");
  const untrackedFiles = status.files.filter((f) => f.status === "untracked");

  return (
    <div className="flex h-full flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Git status bar */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowBranchList(!showBranchList)}
            className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-1.5 text-[14px] hover:border-[var(--border-control)] hover:bg-[var(--bg-raised)]"
          >
            <GitBranch className="h-4 w-4 text-[var(--text-secondary)]" />
            <span>{status.branch}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {(status.ahead > 0 || status.behind > 0) && (
            <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
              {status.ahead > 0 && <span>↑{status.ahead}</span>}
              {status.behind > 0 && <span>↓{status.behind}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePull}
            disabled={loading}
            className="rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            title="Pull"
          >
            <GitMerge className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handlePush}
            disabled={loading}
            className="rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            title="Push"
          >
            <Upload className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
            className="rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Branch list dropdown */}
      {showBranchList && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateBranch()}
              placeholder="New branch name..."
              className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-control)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreateBranch()}
              disabled={!newBranchName.trim()}
              className="rounded border border-[var(--border-control)] px-3 py-1.5 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              Create
            </button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {branches.map((branch) => (
              <button
                key={branch.name}
                type="button"
                onClick={() => void handleSwitchBranch(branch.name)}
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-[14px] hover:bg-[var(--bg-raised)] ${
                  branch.current ? "bg-[var(--bg-raised)] text-[var(--text-secondary)]" : "text-[var(--text-primary)]"
                }`}
              >
                {branch.current && <Check className="h-3 w-3" />}
                <span>{branch.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
          {status.clean ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-[14px] text-[var(--text-muted)]">
              <div>
                <Check className="mx-auto mb-2 h-8 w-8 text-[var(--status-success)]" />
                <p>Working tree is clean</p>
              </div>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {/* Staged files */}
              {stagedFiles.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, staged: !prev.staged }))
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-[14px] font-medium text-[var(--status-success)] hover:bg-[var(--bg-raised)]"
                  >
                    {expandedSections.staged ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span>Staged Changes ({stagedFiles.length})</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUnstage(stagedFiles.map((f) => f.path));
                      }}
                      className="ml-auto rounded p-1 hover:bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)]"
                      title="Unstage all"
                    >
                      <Minus className="h-3 w-3 text-[var(--status-error)]" />
                    </button>
                  </button>
                  {expandedSections.staged &&
                    stagedFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`group flex items-center gap-2 rounded px-2 py-1 text-[13px] ${
                          selectedFile?.path === file.path
                            ? "bg-[var(--bg-raised)] text-[var(--text-secondary)]"
                            : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleFileClick(file)}
                          className="flex flex-1 items-center gap-2 overflow-hidden"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto flex-shrink-0 text-[var(--status-success)]">
                            {file.status[0].toUpperCase()}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUnstage([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)]"
                          title="Unstage"
                        >
                          <Minus className="h-3 w-3 text-[var(--status-error)]" />
                        </button>
                      </div>
                    ))}
                </div>
              )}

              {/* Unstaged files */}
              {unstagedFiles.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, unstaged: !prev.unstaged }))
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-[14px] font-medium text-[var(--status-warning)] hover:bg-[var(--bg-raised)]"
                  >
                    {expandedSections.unstaged ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span>Changes ({unstagedFiles.length})</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleStage(unstagedFiles.map((f) => f.path));
                      }}
                      className="ml-auto rounded p-1 hover:bg-[var(--bg-raised)]"
                      title="Stage all"
                    >
                      <Plus className="h-3 w-3 text-[var(--status-success)]" />
                    </button>
                  </button>
                  {expandedSections.unstaged &&
                    unstagedFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`group flex items-center gap-2 rounded px-2 py-1 text-[13px] ${
                          selectedFile?.path === file.path
                            ? "bg-[var(--bg-raised)] text-[var(--text-secondary)]"
                            : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleFileClick(file)}
                          className="flex flex-1 items-center gap-2 overflow-hidden"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto flex-shrink-0 text-[var(--status-warning)]">
                            {file.status[0].toUpperCase()}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStage([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[var(--bg-raised)]"
                          title="Stage"
                        >
                          <Plus className="h-3 w-3 text-[var(--status-success)]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDiscard([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)]"
                          title="Discard"
                        >
                          <X className="h-3 w-3 text-[var(--status-error)]" />
                        </button>
                      </div>
                    ))}
                </div>
              )}

              {/* Untracked files */}
              {untrackedFiles.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, untracked: !prev.untracked }))
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-[14px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
                  >
                    {expandedSections.untracked ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span>Untracked ({untrackedFiles.length})</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleStage(untrackedFiles.map((f) => f.path));
                      }}
                      className="ml-auto rounded p-1 hover:bg-[var(--bg-raised)]"
                      title="Stage all"
                    >
                      <Plus className="h-3 w-3 text-[var(--status-success)]" />
                    </button>
                  </button>
                  {expandedSections.untracked &&
                    untrackedFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`group flex items-center gap-2 rounded px-2 py-1 text-[13px] ${
                          selectedFile?.path === file.path
                            ? "bg-[var(--bg-raised)] text-[var(--text-secondary)]"
                            : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleFileClick(file)}
                          className="flex flex-1 items-center gap-2 overflow-hidden"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto flex-shrink-0 text-[var(--text-muted)]">U</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStage([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[var(--bg-raised)]"
                          title="Stage"
                        >
                          <Plus className="h-3 w-3 text-[var(--status-success)]" />
                        </button>
                      </div>
                    ))}
                </div>
              )}

              {/* Commit button */}
              {stagedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCommitDialog(true)}
                  className="mt-4 w-full rounded border border-[var(--border-control)] bg-[var(--bg-raised)] px-3 py-2 text-[14px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  <GitCommit className="mr-2 inline h-4 w-4" />
                  Commit ({stagedFiles.length})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Diff viewer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedFile && diffContent ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[var(--text-secondary)]" />
                  <span className="text-[14px] font-medium">{selectedFile.path}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setDiffContent(null);
                  }}
                  className="rounded p-1 hover:bg-[var(--bg-raised)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DiffEditor
                  original={diffContent.oldContent}
                  modified={diffContent.newContent}
                  language="plaintext"
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    renderSideBySide: true,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
              <div className="text-center">
                <AlertCircle className="mx-auto mb-2 h-8 w-8" />
                <p>Select a file to view diff</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Commit dialog */}
      {showCommitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded border border-[var(--border-control)] bg-[var(--bg-panel)] p-6">
            <h3 className="mb-4 text-[16px] font-semibold text-[var(--text-primary)]">Commit Changes</h3>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message..."
              className="mb-4 h-32 w-full resize-none rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-control)] focus:outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCommitDialog(false);
                  setCommitMessage("");
                }}
                className="rounded border border-[var(--border-control)] px-4 py-2 text-[14px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={!commitMessage.trim()}
                className="rounded border border-[var(--border-control)] bg-[var(--bg-raised)] px-4 py-2 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
              >
                Commit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
