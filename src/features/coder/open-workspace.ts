import { isFilesystemPath, resolveWorkspaceRepoUrl, type WorkspaceRepoUrlSource } from "./workspace-repo-url";

export const WORKSPACE_OPEN_TIMEOUT_MS = 20_000;
export const FOLDER_PICKER_TIMEOUT_MS = 120_000;

export type FolderPickerMode = "native-dialog" | "path-input";

export type WorkspaceOpenPlan =
  | { kind: "open"; localPath: string; slug: string }
  | { kind: "setup"; slug: string; name: string; repoUrl: string };

/**
 * Whether the Coder page should start (or restart) opening a workspace from
 * `?workspace=`.
 *
 * Intentionally independent of the projects list: waiting on `projectsData`
 * left the "Opening workspace…" spinner up forever when that query was slow
 * or failed. A previous attempt is tracked by slug so a new param retries.
 */
export function shouldAttemptOpenWorkspace(input: {
  workspaceParam: string | null;
  projectRoot: string | null;
  handledWorkspaceParam: string | null;
}): boolean {
  return Boolean(
    input.workspaceParam &&
      !input.projectRoot &&
      input.workspaceParam !== input.handledWorkspaceParam,
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** Pulls `configuration.localPath`, or a top-level `localPath` if nested differently. */
export function extractWorkspaceLocalPath(detail: unknown): string | undefined {
  const root = asRecord(detail);
  if (!root) return undefined;

  const fromConfig = readString(asRecord(root.configuration)?.localPath);
  if (fromConfig) return fromConfig;

  return readString(root.localPath);
}

export function planWorkspaceOpen(input: {
  slug: string;
  name: string;
  detail: unknown;
}): WorkspaceOpenPlan {
  const localPath = extractWorkspaceLocalPath(input.detail);
  if (localPath) {
    return { kind: "open", localPath, slug: input.slug };
  }

  return {
    kind: "setup",
    slug: input.slug,
    name: input.name,
    repoUrl: resolveWorkspaceRepoUrl((input.detail ?? {}) as WorkspaceRepoUrlSource) ?? "",
  };
}

export function folderPickerMode(tauriAvailable: boolean): FolderPickerMode {
  return tauriAvailable ? "native-dialog" : "path-input";
}

export function isUsableLocalPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isFilesystemPath(trimmed);
}

export function formatWorkspaceOpenError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}
