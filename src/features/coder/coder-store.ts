import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FileTreeNode, PackageJsonScript } from "@shared/coder-types";

export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  savedContent: string;
}

export interface Terminal {
  id: string;
  title: string;
}

interface CoderState {
  projectRoot: string | null;
  workspaceSlug: string | null;
  fileTree: FileTreeNode[];
  openFiles: OpenFile[];
  activeFilePath: string | null;
  gitBranch: string | null;
  scripts: PackageJsonScript[];
  terminals: Terminal[];
  activeTerminalId: string | null;
  scanlineOverlay: boolean;

  setProject: (root: string, workspaceSlug: string | null, fileTree: FileTreeNode[], scripts: PackageJsonScript[], gitBranch: string | null) => void;
  clearProject: () => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  openFile: (path: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string, content: string) => void;
  setGitBranch: (branch: string | null) => void;
  setScripts: (scripts: PackageJsonScript[]) => void;
  addTerminal: (id: string, title: string) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
  toggleScanlineOverlay: () => void;
  saveAllFiles: () => Promise<void>;
}

const INITIAL_STATE = {
  projectRoot: null,
  workspaceSlug: null,
  fileTree: [],
  openFiles: [],
  activeFilePath: null,
  gitBranch: null,
  scripts: [],
  terminals: [],
  activeTerminalId: null,
};

export const useCoderStore = create<CoderState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      scanlineOverlay: false,

      setProject: (root, workspaceSlug, fileTree, scripts, gitBranch) => {
        set({
          projectRoot: root,
          workspaceSlug,
          fileTree,
          scripts,
          gitBranch,
          openFiles: [],
          activeFilePath: null,
        });
      },

      clearProject: () => {
        set({
          ...INITIAL_STATE,
          scanlineOverlay: get().scanlineOverlay,
        });
      },

      setFileTree: (tree) => set({ fileTree: tree }),

      openFile: (path, content) => {
        const existing = get().openFiles.find((f) => f.path === path);
        if (existing) {
          set({ activeFilePath: path });
          return;
        }

        set((state) => ({
          openFiles: [
            ...state.openFiles,
            {
              path,
              content,
              isDirty: false,
              savedContent: content,
            },
          ],
          activeFilePath: path,
        }));
      },

      closeFile: (path) => {
        set((state) => ({
          openFiles: state.openFiles.filter((f) => f.path !== path),
          activeFilePath: state.activeFilePath === path
            ? (state.openFiles.filter((f) => f.path !== path)[0]?.path ?? null)
            : state.activeFilePath,
        }));
      },

      setActiveFile: (path) => set({ activeFilePath: path }),

      updateFileContent: (path, content) => {
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? { ...f, content, isDirty: content !== f.savedContent }
              : f
          ),
        }));
      },

      markFileSaved: (path, content) => {
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? { ...f, content, savedContent: content, isDirty: false }
              : f
          ),
        }));
      },

      setGitBranch: (branch) => set({ gitBranch: branch }),

      setScripts: (scripts) => set({ scripts }),

      addTerminal: (id, title) => {
        set((state) => ({
          terminals: [...state.terminals, { id, title }],
          activeTerminalId: id,
        }));
      },

      removeTerminal: (id) => {
        set((state) => ({
          terminals: state.terminals.filter((t) => t.id !== id),
          activeTerminalId:
            state.activeTerminalId === id
              ? (state.terminals.filter((t) => t.id !== id)[0]?.id ?? null)
              : state.activeTerminalId,
        }));
      },

      setActiveTerminal: (id) => set({ activeTerminalId: id }),

      toggleScanlineOverlay: () => set((state) => ({ scanlineOverlay: !state.scanlineOverlay })),

      saveAllFiles: async () => {
        const { openFiles } = get();
        const dirtyFiles = openFiles.filter((f) => f.isDirty);
        
        for (const file of dirtyFiles) {
          const { writeFile } = await import("@/lib/agentos/coder-api");
          const result = await writeFile(file.path, file.content);
          
          if (result.success) {
            get().markFileSaved(file.path, file.content);
          } else {
            console.error(`Failed to save ${file.path}:`, result.error);
            throw new Error(`Failed to save ${file.path}: ${result.error}`);
          }
        }
      },
    }),
    {
      name: "coder-state",
      partialize: (state) => ({
        projectRoot: state.projectRoot,
        workspaceSlug: state.workspaceSlug,
        openFiles: state.openFiles.map((f) => ({
          path: f.path,
          content: f.savedContent,
          isDirty: false,
          savedContent: f.savedContent,
        })),
        activeFilePath: state.activeFilePath,
        scanlineOverlay: state.scanlineOverlay,
      }),
    }
  )
);
