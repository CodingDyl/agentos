import { useCallback, useContext } from "react";
import { DownloadToastContext } from "./download-toast-context";
import {
  DownloadCancelledError,
  downloadMedia,
  downloadMediaZip,
  OpenedInTabError,
  type DownloadSource,
} from "./download-media";

/**
 * Download one Creative file, or several as a zip, and report it on the
 * bottom bar the rest of AgentOS already uses for "this just happened".
 */

export function useCreativeDownload() {
  const toast = useContext(DownloadToastContext);

  const download = useCallback(
    async (source: DownloadSource) => {
      try {
        toast?.reportProgress("Downloading…");
        const filename = await downloadMedia(source, ({ received, total }) => {
          const percent = total ? Math.round((received / total) * 100) : undefined;
          toast?.reportProgress(percent !== undefined ? `Downloading… ${percent}%` : "Downloading…", percent);
        });
        toast?.reportSuccess(`Saved ${filename}`);
      } catch (error) {
        if (error instanceof DownloadCancelledError) {
          toast?.clear();
          return;
        }
        if (error instanceof OpenedInTabError) {
          toast?.reportSuccess(error.message);
          return;
        }
        toast?.reportError(error instanceof Error ? error.message : "That file could not be downloaded.");
      }
    },
    [toast],
  );

  const downloadMany = useCallback(
    async (sources: readonly DownloadSource[]) => {
      if (sources.length === 1) {
        await download(sources[0]);
        return;
      }

      try {
        toast?.reportProgress(`Downloading 0 of ${sources.length}…`);
        const filename = await downloadMediaZip(sources, (current, total, name) => {
          toast?.reportProgress(`Downloading ${current} of ${total} · ${name}`, Math.round((current / total) * 100));
        });
        toast?.reportSuccess(`Saved ${filename}`);
      } catch (error) {
        if (error instanceof DownloadCancelledError) {
          toast?.clear();
          return;
        }
        if (error instanceof OpenedInTabError) {
          toast?.reportSuccess(error.message);
          return;
        }
        toast?.reportError(error instanceof Error ? error.message : "Those files could not be downloaded.");
      }
    },
    [download, toast],
  );

  return { download, downloadMany };
}
