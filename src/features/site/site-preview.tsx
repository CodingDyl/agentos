import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { DedsecLoader } from "@/components/os";
import { PaperButton } from "@/components/paper";
import { openSiteInWindow } from "@/lib/tauri-utils";
import { cn } from "@/lib/utils";
import { displayHost } from "./site-model";

export type PreviewViewport = "desktop" | "mobile";

/**
 * Sandboxed live preview used by the Site tab and the Ship panel.
 * Sites that refuse framing are handled by `BlockedSitePanel`.
 */
export function SitePreviewFrame({
  url,
  viewport,
  title,
}: {
  url: string;
  viewport: PreviewViewport;
  title?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const host = displayHost(url);

  return (
    <div className="relative h-[calc(100vh-22rem)] min-h-[420px] border border-paper-mist bg-paper-linen">
      <iframe
        title={title ?? `Preview: ${host}`}
        src={url}
        onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        className={cn(
          "mx-auto block h-full bg-white transition-[width,opacity] duration-200 ease-out",
          viewport === "mobile" ? "w-[390px] max-w-full border-x border-paper-mist" : "w-full",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {!loaded ? (
        <div className="absolute inset-0 grid place-items-center bg-black">
          <DedsecLoader variant="compact" className="min-h-0 bg-transparent" />
        </div>
      ) : null}
    </div>
  );
}

export function BlockedSitePanel({
  url,
  projectId,
  projectName,
  reason,
}: {
  url: string;
  projectId: string;
  projectName: string;
  reason?: string;
}) {
  const [opening, setOpening] = useState(false);

  const openSite = async () => {
    setOpening(true);
    try {
      await openSiteInWindow(url, projectName, projectId);
    } finally {
      setTimeout(() => setOpening(false), 500);
    }
  };

  return (
    <div className="space-y-4 border border-paper-mist bg-paper-linen p-6">
      <div className="space-y-2">
        <p className="text-[14px] text-paper-char">
          <strong>{displayHost(url)}</strong> blocks embedding, so it opens in its own window.
        </p>
        {reason ? <p className="text-[13px] text-paper-sage">{reason}</p> : null}
      </div>

      <PaperButton variant="amber" onClick={openSite} disabled={opening}>
        <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
        Open site
      </PaperButton>

      <details className="text-[13px] text-paper-sage">
        <summary className="cursor-pointer hover:text-paper-char">Advanced</summary>
        <p className="mt-2">
          To embed the site directly, add{" "}
          <code className="bg-paper-stone px-1 font-mono text-[12.5px]">
            frame-ancestors &apos;self&apos; {window.location.origin}
          </code>{" "}
          to the site&apos;s Content-Security-Policy and drop any{" "}
          <code className="bg-paper-stone px-1 font-mono text-[12.5px]">X-Frame-Options</code> header.
        </p>
      </details>
    </div>
  );
}
