import { Check, Copy, ExternalLink, Link2, RotateCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LinkedProjectSite } from "@shared/vercel-types";
import { PAPER_FOCUS, PaperButton, PaperEmpty, PaperError, PaperIndicator, PaperNotice, SegmentedControl } from "@/components/paper";
import { useProjectSite } from "@/lib/agentos/queries";
import { formatRelativeTime } from "@/lib/format";
import { openSiteInWindow } from "@/lib/tauri-utils";
import { cn } from "@/lib/utils";
import { deploymentHealth, displayHost, servingNote } from "./site-model";

type Viewport = "desktop" | "mobile";

const VIEWPORTS: readonly { value: Viewport; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

/**
 * A workspace's live site, inside AgentOS: the production URL framed in the
 * page, with its deployment health above it.
 *
 * Nothing here opens a browser tab. The frame is sandboxed without popups, so
 * the site can be used but cannot spawn windows. Sites that refuse framing
 * (X-Frame-Options, frame-ancestors, Vercel Deployment Protection) are found
 * by the server before the frame is drawn, and said so, instead of a blank box.
 */
export function SiteTab({ slug, onOpenSettings }: { slug: string; onOpenSettings: () => void }) {
  const site = useProjectSite(slug);

  if (site.isPending) return <p className="text-[14px] text-paper-sage">Reading Vercel…</p>;

  if (site.isError) {
    return (
      <PaperError
        headingLevel="h2"
        title="The site could not be read."
        detail={site.error.message}
        onRetry={() => void site.refetch()}
        isRetrying={site.isFetching}
      />
    );
  }

  const data = site.data;
  switch (data.status) {
    case "unlinked":
      return (
        <PaperEmpty
          title="No Vercel project is linked to this workspace."
          description="Link one and this tab shows the live site with its deployment status. Nothing on Vercel changes: AgentOS only reads it."
          action={
            <PaperButton variant="amber" onClick={onOpenSettings}>
              <Link2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
              Link a Vercel project
            </PaperButton>
          }
        />
      );
    case "not-configured":
      return (
        <PaperEmpty
          title="Vercel isn't connected."
          description={`${data.message} Add a token in Connectors, then come back.`}
          action={<ConnectorsLink />}
        />
      );
    case "unavailable":
      return (
        <PaperError
          headingLevel="h2"
          title={data.reason === "unauthorized" ? "Vercel rejected the token." : `Vercel could not be read for ${data.projectName}.`}
          detail={data.message}
          hint={data.reason === "unauthorized" ? <>Replace the token in <Link to="/connectors/vercel" className="underline underline-offset-4">Connectors → Vercel</Link>.</> : undefined}
          onRetry={() => void site.refetch()}
          isRetrying={site.isFetching}
        />
      );
    case "linked":
      return <LinkedSite site={data} refreshing={site.isFetching} onRefresh={() => void site.refetch()} onOpenSettings={onOpenSettings} />;
  }
}

function LinkedSite({
  site,
  refreshing,
  onRefresh,
  onOpenSettings,
}: {
  site: LinkedProjectSite;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  // Bumping the key remounts the frame: a real reload, whatever page the site was on.
  const [frameKey, setFrameKey] = useState(0);

  const health = deploymentHealth(site.production?.state);
  const deployedAt = site.production ? formatRelativeTime(site.production.createdAt) : undefined;
  const note = servingNote(site, (iso) => formatRelativeTime(iso));
  const otherDomains = site.domains.filter((domain) => site.url !== `https://${domain.name}`);

  const reload = () => {
    setFrameKey((key) => key + 1);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-b border-paper-mist pb-4">
        <dl className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <Fact label="Production">
            <PaperIndicator tone={health.tone} label={health.label} detail={deployedAt} />
          </Fact>
          <Fact label="URL">
            {site.url ? <UrlValue url={site.url} fromDeployment={site.urlSource === "deployment"} /> : <span className="text-paper-sage">None yet</span>}
          </Fact>
          <Fact label="Vercel project">
            <span className="text-paper-char">{site.projectName}</span>
          </Fact>
          {otherDomains.length > 0 ? (
            <Fact label="Also on">
              <span className="text-paper-char" title={otherDomains.map((domain) => domain.name).join(", ")}>
                {otherDomains.length === 1 ? otherDomains[0].name : `${otherDomains.length} more domains`}
              </span>
            </Fact>
          ) : null}
        </dl>

        {site.url && site.embed?.allowed !== false ? (
          <div className="flex items-center gap-2">
            <SegmentedControl label="Preview width" options={VIEWPORTS} value={viewport} onChange={setViewport} />
            <PaperButton variant="ghost" onClick={reload} disabled={refreshing} aria-label="Reload site and status">
              <RotateCw className={cn("size-3.5", refreshing && "motion-safe:animate-spin")} strokeWidth={2} aria-hidden="true" />
              Reload
            </PaperButton>
          </div>
        ) : (
          <PaperButton variant="ghost" onClick={onRefresh} disabled={refreshing}>
            <RotateCw className={cn("size-3.5", refreshing && "motion-safe:animate-spin")} strokeWidth={2} aria-hidden="true" />
            Check again
          </PaperButton>
        )}
      </div>

      {note ? <PaperNotice>{note}</PaperNotice> : null}

      {!site.url ? (
        <PaperEmpty
          title={`${site.projectName} has nothing live yet.`}
          description="There is no verified domain and no finished production deploy to show. Once a production deploy is Ready, it appears here."
          action={
            <PaperButton variant="ghost" onClick={onOpenSettings}>
              Change linked project
            </PaperButton>
          }
        />
      ) : site.embed?.allowed === false ? (
        <BlockedSitePanel url={site.url} projectId={site.projectId} projectName={site.projectName} reason={site.embed.reason} />
      ) : (
        <SiteFrame key={frameKey} url={site.url} viewport={viewport} />
      )}
    </div>
  );
}

function SiteFrame({ url, viewport }: { url: string; viewport: Viewport }) {
  const [loaded, setLoaded] = useState(false);
  const host = displayHost(url);

  return (
    <div className="relative h-[calc(100vh-20rem)] min-h-[560px] border border-paper-mist bg-paper-linen">
      <iframe
        title={`Live site: ${host}`}
        src={url}
        onLoad={() => setLoaded(true)}
        // Scripts and forms work; popups and top-level navigation don't, so the site can't open a tab or replace AgentOS.
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        className={cn(
          "mx-auto block h-full bg-white transition-[width,opacity] duration-200 ease-out",
          viewport === "mobile" ? "w-[390px] max-w-full border-x border-paper-mist" : "w-full",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {!loaded ? (
        <div role="status" className="absolute inset-0 grid place-items-center text-[14px] text-paper-sage">
          Loading {host}…
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-paper-utility text-[12px] leading-[18px] font-medium tracking-[0.08em] text-paper-sage uppercase">{label}</dt>
      <dd className="mt-1 flex min-h-6 items-center text-[13.5px]">{children}</dd>
    </div>
  );
}

/** The address as text plus copy — never a link out, so the site stays in AgentOS. */
function UrlValue({ url, fromDeployment }: { url: string; fromDeployment: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate font-medium text-paper-moss" title={fromDeployment ? "No verified domain yet: this is the production deploy's own URL." : url}>
        {displayHost(url)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy URL"}
        className={cn("inline-flex size-6 shrink-0 cursor-pointer items-center justify-center text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
      >
        {copied ? <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> : <Copy className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </span>
  );
}

function ConnectorsLink() {
  return (
    <Link
      to="/connectors/vercel"
      className={cn(
        "inline-flex min-h-8 items-center rounded-none bg-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-white uppercase hover:bg-paper-moss",
        PAPER_FOCUS,
      )}
    >
      Open Connectors → Vercel
    </Link>
  );
}

/**
 * When a site blocks framing, show a panel with an "Open site" button that
 * opens the site in its own native window (Tauri) or new tab (browser).
 */
function BlockedSitePanel({ url, projectId, projectName, reason }: { url: string; projectId: string; projectName: string; reason?: string }) {
  const [opening, setOpening] = useState(false);

  const openSite = async () => {
    setOpening(true);
    try {
      await openSiteInWindow(url, projectName, projectId);
    } finally {
      // Reset after a moment so the button state clears
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
          <code className="bg-paper-stone px-1 font-mono text-[12.5px]">frame-ancestors &apos;self&apos; {window.location.origin}</code> to the
          site&apos;s Content-Security-Policy and drop any <code className="bg-paper-stone px-1 font-mono text-[12.5px]">X-Frame-Options</code> header.
        </p>
      </details>
    </div>
  );
}
