import { Play, RotateCw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DevServerState, DevServerStatus } from "@shared/dev-server-types";
import { DedsecLoader } from "@/components/os";
import { PaperButton, PaperEmpty, PaperError, PaperIndicator, PaperNotice, SegmentedControl } from "@/components/paper";
import { Fact, SiteFrame, UrlValue } from "@/features/site";
import { cn } from "@/lib/utils";
import { useDevServer, useDevServerAction } from "./use-dev-server";

type Viewport = "desktop" | "mobile";

const VIEWPORTS: readonly { value: Viewport; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

const FRAMEWORK_LABELS = { next: "Next.js", vite: "Vite", cra: "Create React App", astro: "Astro", other: "Node" } as const;

const INDICATOR: Record<DevServerStatus, { tone: "green" | "amber" | "flame" | "muted"; label: string }> = {
  stopped: { tone: "muted", label: "Stopped" },
  installing: { tone: "amber", label: "Installing dependencies" },
  starting: { tone: "amber", label: "Starting" },
  running: { tone: "green", label: "Running" },
  failed: { tone: "flame", label: "Failed" },
};

const BUSY = new Set<DevServerStatus>(["installing", "starting", "running"]);

/**
 * A workspace's local dev server, run by AgentOS and framed in the page.
 *
 * Start runs the project's own script (`dev`, else `start`) in the folder
 * PROJECT.md names, installing dependencies first when there are none. The
 * server listens on this machine only. The frame is the Site tab's, pointed at
 * the local address, so the two read the same way.
 */
export function DevServerTab({ slug }: { slug: string }) {
  const query = useDevServer(slug);
  const act = useDevServerAction(slug);

  if (query.isPending) return <DedsecLoader variant="compact" />;

  if (query.isError) {
    return (
      <PaperError
        headingLevel="h2"
        title="The dev server could not be read."
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }

  const state = query.data;

  if (!state.folder || (state.plan && !state.plan.ok && state.status === "stopped")) {
    return (
      <PaperEmpty
        title={state.folder ? "There is nothing to run here." : "This workspace has no local folder."}
        description={state.plan && !state.plan.ok ? state.plan.reason : "Add a Local repository line to PROJECT.md to run it from here."}
      />
    );
  }

  return <DevServerPanel state={state} slug={slug} pending={act.isPending} error={act.error?.message} onAct={(action) => act.mutate(action)} />;
}

function DevServerPanel({
  state,
  slug,
  pending,
  error,
  onAct,
}: {
  state: DevServerState;
  slug: string;
  pending: boolean;
  error?: string;
  onAct: (action: "start" | "stop" | "restart") => void;
}) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [frameKey, setFrameKey] = useState(0);
  const busy = BUSY.has(state.status);
  const indicator = INDICATOR[state.status];
  const plan = state.plan?.ok ? state.plan : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-b border-paper-mist pb-4">
        <dl className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <Fact label="Status">
            <PaperIndicator tone={indicator.tone} label={indicator.label} />
          </Fact>
          <Fact label="Runs">
            <span className="font-mono text-[12.5px] text-paper-char">{state.command ?? plan?.command ?? "—"}</span>
            {plan ? <span className="ml-2 text-paper-sage">{FRAMEWORK_LABELS[plan.framework]}</span> : null}
          </Fact>
          <Fact label="URL">
            {state.url ? <UrlValue url={state.url} fromDeployment={false} /> : <span className="text-paper-sage">Not running</span>}
          </Fact>
          <Fact label="Folder">
            <span className="max-w-[28rem] truncate text-paper-char" title={state.folder}>
              {state.folder}
            </span>
          </Fact>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {state.status === "running" ? (
            <>
              <SegmentedControl label="Preview width" options={VIEWPORTS} value={viewport} onChange={setViewport} />
              <PaperButton variant="ghost" onClick={() => setFrameKey((key) => key + 1)} aria-label="Reload preview">
                <RotateCw className="size-3.5" strokeWidth={2} aria-hidden="true" />
                Reload
              </PaperButton>
            </>
          ) : null}
          {busy ? (
            <>
              <PaperButton variant="ghost" disabled={pending || state.status === "installing"} onClick={() => onAct("restart")}>
                <RotateCw className="size-3.5" strokeWidth={2} aria-hidden="true" />
                Restart
              </PaperButton>
              <PaperButton variant="danger" disabled={pending} onClick={() => onAct("stop")}>
                <Square className="size-3.5" strokeWidth={2} aria-hidden="true" />
                Stop
              </PaperButton>
            </>
          ) : (
            <PaperButton variant="amber" disabled={pending} onClick={() => onAct("start")}>
              <Play className="size-3.5" strokeWidth={2} aria-hidden="true" />
              {state.status === "failed" ? "Try again" : "Start"}
            </PaperButton>
          )}
        </div>
      </div>

      {error ? <PaperNotice>{error}</PaperNotice> : null}
      {state.status === "failed" && state.error ? <PaperNotice>{state.error}</PaperNotice> : null}

      {state.status === "stopped" && state.output.length === 0 && plan ? (
        <PaperEmpty
          title={`Run ${plan.command} here.`}
          description={`${plan.needsInstall ? `Dependencies are not installed, so ${plan.installCommand} runs first. ` : ""}The server listens on this machine only, and its output and a live preview appear below.`}
        />
      ) : null}

      {state.status === "running" && state.url ? <SiteFrame key={`${slug}-${frameKey}`} url={state.url} viewport={viewport} /> : null}

      {state.output.length > 0 ? <OutputLog lines={state.output} tall={state.status !== "running"} /> : null}
    </div>
  );
}

function OutputLog({ lines, tall }: { lines: string[]; tall: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const stuck = useRef(true);

  // Follow the output unless the operator scrolled up to read something.
  useEffect(() => {
    const element = ref.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <section aria-label="Server output">
      <h3 className="mb-1.5 font-paper-utility text-[12px] leading-[18px] font-medium tracking-[0.08em] text-paper-sage uppercase">Output</h3>
      <pre
        ref={ref}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className={cn(
          "overflow-auto border border-paper-mist bg-paper-char p-3 font-mono text-[12px] leading-[18px] whitespace-pre-wrap text-paper-linen",
          tall ? "h-[min(28rem,50vh)]" : "h-48",
        )}
      >
        {lines.join("\n")}
      </pre>
    </section>
  );
}
