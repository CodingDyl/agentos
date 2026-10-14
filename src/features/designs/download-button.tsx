import { Download } from "lucide-react";
import { PAPER_FOCUS, PaperButton } from "@/components/paper";
import { cn } from "@/lib/utils";
import type { DownloadSource } from "./download-media";
import { useCreativeDownload } from "./use-creative-download";

/**
 * The Download control Creative uses everywhere: an icon on a card, a labelled
 * button in a preview. The action is the same; only the chrome changes.
 */

export function CreativeDownloadButton({
  source,
  variant = "icon",
  className,
}: {
  source: DownloadSource;
  variant?: "icon" | "label";
  className?: string;
}) {
  const { download } = useCreativeDownload();

  if (variant === "label") {
    return (
      <PaperButton
        variant="ghost"
        className={className}
        onClick={() => void download(source)}
      >
        <Download className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        Download
      </PaperButton>
    );
  }

  return (
    <button
      type="button"
      aria-label="Download"
      title="Download"
      onClick={() => void download(source)}
      className={cn(
        "pointer-events-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-none border border-paper-mist",
        "bg-paper-white/90 text-paper-char transition-colors duration-150 hover:bg-paper-white hover:text-paper-moss",
        PAPER_FOCUS,
        className,
      )}
    >
      <Download className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
