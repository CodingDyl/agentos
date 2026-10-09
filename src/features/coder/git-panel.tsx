import { useState, useEffect, useCallback } from "react";
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
    return (
      <div className="flex h-full items-center justify-center text-[#6a9fb5]">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Loading git status...
      </div>
    );
  }

  const stagedFiles = status.files.filter((f) => f.staged);
  const unstagedFiles = status.files.filter((f) => !f.staged && f.status !== "untracked");
  const untrackedFiles = status.files.filter((f) => f.status === "untracked");

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] text-[#e0e0e0]">
      {/* Git status bar */}
      <div className="flex items-center justify-between border-b border-[#00ffcc33] bg-[#141414] p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowBranchList(!showBranchList)}
            className="flex items-center gap-2 rounded border border-[#00ccff33] bg-[#00ccff0d] px-3 py-1.5 text-sm hover:border-[#00ccff] hover:bg-[#00ccff1a]"
          >
            <GitBranch className="h-4 w-4 text-[#00ccff]" />
            <span>{status.branch}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {(status.ahead > 0 || status.behind > 0) && (
            <div className="flex items-center gap-2 text-xs text-[#6a9fb5]">
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
            className="rounded p-2 text-[#00ccff] hover:bg-[#00ccff1a] disabled:opacity-50"
            title="Pull"
          >
            <GitMerge className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handlePush}
            disabled={loading}
            className="rounded p-2 text-[#00ccff] hover:bg-[#00ccff1a] disabled:opacity-50"
            title="Push"
          >
            <Upload className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
            className="rounded p-2 text-[#00ccff] hover:bg-[#00ccff1a] disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Branch list dropdown */}
      {showBranchList && (
        <div className="border-b border-[#00ffcc33] bg-[#141414] p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateBranch()}
              placeholder="New branch name..."
              className="flex-1 rounded border border-[#00ffcc33] bg-[#0a0a0a] px-3 py-1.5 text-sm text-[#e0e0e0] placeholder-[#6a9fb5] focus:border-[#00ccff] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreateBranch()}
              disabled={!newBranchName.trim()}
              className="rounded border border-[#00ccff] px-3 py-1.5 text-sm text-[#00ccff] hover:bg-[#00ccff1a] disabled:opacity-50"
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
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-[#00ffcc1a] ${
                  branch.current ? "bg-[#00ccff1a] text-[#00ccff]" : "text-[#e0e0e0]"
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
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-[#00ffcc33] bg-[#0f0f0f]">
          {status.clean ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-[#6a9fb5]">
              <div>
                <Check className="mx-auto mb-2 h-8 w-8 text-[#00ff00]" />
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm font-medium text-[#00ff00] hover:bg-[#00ffcc1a]"
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
                      className="ml-auto rounded p-1 hover:bg-[#ff00661a]"
                      title="Unstage all"
                    >
                      <Minus className="h-3 w-3 text-[#ff0066]" />
                    </button>
                  </button>
                  {expandedSections.staged &&
                    stagedFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`group flex items-center gap-2 rounded px-2 py-1 text-xs ${
                          selectedFile?.path === file.path
                            ? "bg-[#00ccff1a] text-[#00ccff]"
                            : "text-[#e0e0e0] hover:bg-[#00ffcc1a]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleFileClick(file)}
                          className="flex flex-1 items-center gap-2 overflow-hidden"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto flex-shrink-0 text-[#00ff00]">
                            {file.status[0].toUpperCase()}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUnstage([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[#ff00661a]"
                          title="Unstage"
                        >
                          <Minus className="h-3 w-3 text-[#ff0066]" />
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm font-medium text-[#ffff00] hover:bg-[#00ffcc1a]"
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
                      className="ml-auto rounded p-1 hover:bg-[#00ff001a]"
                      title="Stage all"
                    >
                      <Plus className="h-3 w-3 text-[#00ff00]" />
                    </button>
                  </button>
                  {expandedSections.unstaged &&
                    unstagedFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`group flex items-center gap-2 rounded px-2 py-1 text-xs ${
                          selectedFile?.path === file.path
                            ? "bg-[#00ccff1a] text-[#00ccff]"
                            : "text-[#e0e0e0] hover:bg-[#00ffcc1a]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleFileClick(file)}
                          className="flex flex-1 items-center gap-2 overflow-hidden"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto flex-shrink-0 text-[#ffff00]">
                            {file.status[0].toUpperCase()}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStage([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[#00ff001a]"
                          title="Stage"
                        >
                          <Plus className="h-3 w-3 text-[#00ff00]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDiscard([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[#ff00661a]"
                          title="Discard"
                        >
                          <X className="h-3 w-3 text-[#ff0066]" />
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm font-medium text-[#6a9fb5] hover:bg-[#00ffcc1a]"
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
                      className="ml-auto rounded p-1 hover:bg-[#00ff001a]"
                      title="Stage all"
                    >
                      <Plus className="h-3 w-3 text-[#00ff00]" />
                    </button>
                  </button>
                  {expandedSections.untracked &&
                    untrackedFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`group flex items-center gap-2 rounded px-2 py-1 text-xs ${
                          selectedFile?.path === file.path
                            ? "bg-[#00ccff1a] text-[#00ccff]"
                            : "text-[#e0e0e0] hover:bg-[#00ffcc1a]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleFileClick(file)}
                          className="flex flex-1 items-center gap-2 overflow-hidden"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto flex-shrink-0 text-[#6a9fb5]">U</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStage([file.path])}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[#00ff001a]"
                          title="Stage"
                        >
                          <Plus className="h-3 w-3 text-[#00ff00]" />
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
                  className="mt-4 w-full rounded border border-[#00ccff] bg-[#00ccff0d] px-3 py-2 text-sm font-medium text-[#00ccff] hover:bg-[#00ccff1a]"
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
              <div className="flex items-center justify-between border-b border-[#00ffcc33] bg-[#141414] px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#00ccff]" />
                  <span className="text-sm font-medium">{selectedFile.path}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setDiffContent(null);
                  }}
                  className="rounded p-1 hover:bg-[#00ffcc1a]"
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
            <div className="flex h-full items-center justify-center text-[#6a9fb5]">
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
          <div className="w-full max-w-md rounded border border-[#00ffcc] bg-[#141414] p-6">
            <h3 className="mb-4 text-lg font-bold text-[#00ffcc]">Commit Changes</h3>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message..."
              className="mb-4 h-32 w-full resize-none rounded border border-[#00ffcc33] bg-[#0a0a0a] p-3 text-sm text-[#e0e0e0] placeholder-[#6a9fb5] focus:border-[#00ccff] focus:outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCommitDialog(false);
                  setCommitMessage("");
                }}
                className="rounded border border-[#6a9fb5] px-4 py-2 text-sm text-[#6a9fb5] hover:bg-[#6a9fb51a]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={!commitMessage.trim()}
                className="rounded border border-[#00ccff] bg-[#00ccff0d] px-4 py-2 text-sm text-[#00ccff] hover:bg-[#00ccff1a] disabled:opacity-50"
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
