import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { withTimeout } from "@/lib/agentos/coder-api";
import {
  FOLDER_PICKER_TIMEOUT_MS,
  folderPickerMode,
  formatWorkspaceOpenError,
  isUsableLocalPath,
  type FolderPickerMode,
} from "./open-workspace";

const inputClass =
  "mt-2 w-full rounded border border-[#00ffcc33] bg-[#0a0a0a] px-4 py-2 text-sm text-[#e0e0e0] placeholder-[#6a9fb5] outline-none focus:border-[#00ffcc] disabled:opacity-50";
const buttonClass =
  "flex w-full items-center justify-center gap-2 rounded border border-[#00ffcc] bg-[#00ffcc0d] p-3 font-medium text-[#00ffcc] transition-colors hover:bg-[#00ffcc1a] disabled:opacity-50";

interface FolderOpenControlProps {
  label: string;
  onPickPath: (path: string) => void | Promise<void>;
  disabled?: boolean;
}

export function FolderOpenControl({ label, onPickPath, disabled }: FolderOpenControlProps) {
  const [mode, setMode] = useState<FolderPickerMode>(() => folderPickerMode(isTauri()));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPath(path: string) {
    const trimmed = path.trim();
    if (!isUsableLocalPath(trimmed)) {
      setError("Enter an absolute folder path, for example /Users/you/Projects/app");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onPickPath(trimmed);
    } catch (cause) {
      setError(formatWorkspaceOpenError(cause, "Failed to open that folder"));
    } finally {
      setBusy(false);
    }
  }

  async function pickNative() {
    setBusy(true);
    setError(null);
    try {
      const selected = await withTimeout(
        open({
          directory: true,
          multiple: false,
          title: "Select Project Folder",
        }),
        FOLDER_PICKER_TIMEOUT_MS,
        "The folder picker did not respond. Paste an absolute path instead.",
      );

      if (!selected || typeof selected !== "string") {
        return;
      }

      await onPickPath(selected);
    } catch (cause) {
      setError(formatWorkspaceOpenError(cause, "Failed to open the folder picker"));
      setMode("path-input");
    } finally {
      setBusy(false);
    }
  }

  const pathForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitPath(draft);
      }}
      className="space-y-2"
    >
      <label className="block text-xs uppercase tracking-wider text-[#6a9fb5]">
        Local folder path
        <input
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          placeholder="/Users/you/Projects/app"
          disabled={disabled || busy}
          className={inputClass}
        />
      </label>
      <button type="submit" disabled={disabled || busy} className={buttonClass}>
        <FolderOpen className="size-5" />
        {busy ? "Opening…" : label}
      </button>
    </form>
  );

  return (
    <div className="space-y-2">
      {mode === "path-input" ? (
        pathForm
      ) : (
        <button type="button" onClick={() => void pickNative()} disabled={disabled || busy} className={buttonClass}>
          <FolderOpen className="size-5" />
          {busy ? "Waiting for picker…" : label}
        </button>
      )}
      {error ? <p className="text-sm text-[#ff0066]">{error}</p> : null}
    </div>
  );
}
