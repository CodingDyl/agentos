import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ShipChangeItem, ShipPreviewSource, ShipSnapshot } from "@shared/ship-types";
import { DedsecLoader, FilterToolbar, type FilterGroup } from "@/components/os";
import {
  FieldLabel,
  PAPER_INPUT,
  PaperButton,
  PaperCard,
  PaperError,
  PaperIndicator,
  SegmentedControl,
} from "@/components/paper";
import { BlockedSitePanel, SitePreviewFrame, type PreviewViewport } from "@/features/site";
import { useVercelProjects } from "@/lib/agentos/queries";
import {
  shipScreenshotUrl,
  useAddShipChange,
  useCreateShipRepo,
  useCreateShipVercel,
  useDeleteShipChange,
  useInitShipRepo,
  useLinkShipRepo,
  useLinkShipVercel,
  usePatchShipChange,
  usePullShipRepo,
  usePushShipRepo,
  useSendShipChanges,
  useShip,
  useShipDeploy,
  useStartShipDev,
  useStopShipDev,
} from "@/lib/agentos/ship";
import { cn } from "@/lib/utils";
import {
  fileToDataUrl,
  SHIP_CHANGE_PRIORITY_OPTIONS,
  SHIP_CHANGE_STATUS_OPTIONS,
  SHIP_PREVIEW_OPTIONS,
  shipChangeStatusLabel,
  shipDevLabel,
} from "./ship-model";

const VIEWPORTS: readonly { value: PreviewViewport; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

export function ShipPanel({ slug, projectName }: { slug: string; projectName: string }) {
  const ship = useShip(slug);
  const [preview, setPreview] = useState<ShipPreviewSource>("local");
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [frameKey, setFrameKey] = useState(0);

  if (ship.isPending) return <DedsecLoader variant="compact" />;
  if (ship.isError) {
    return <PaperError headingLevel="h2" title="Ship could not be read." detail={ship.error.message} onRetry={() => void ship.refetch()} isRetrying={ship.isFetching} />;
  }

  const data = ship.data;
  const previewUrl = preview === "local" ? data.dev.url : data.live.url;
  const blocked = preview === "live" && data.live.embedAllowed === false;
  const filters: FilterGroup[] = [
    {
      id: "status",
      label: "Status",
      mode: "multiple",
      values: statuses,
      onChange: setStatuses,
      options: SHIP_CHANGE_STATUS_OPTIONS,
    },
    {
      id: "priority",
      label: "Priority",
      mode: "multiple",
      values: priorities,
      onChange: setPriorities,
      options: SHIP_CHANGE_PRIORITY_OPTIONS,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-paper-display text-[24px] font-bold tracking-[-0.01em] text-paper-moss">Ship</h2>
          <p className="mt-1 max-w-[72ch] text-[13.5px] text-paper-char">
            Connect the repo, preview locally, deploy, and send visual changes to the coding agent — without leaving this workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterToolbar groups={filters} label="Filter" />
          <SegmentedControl label="Preview source" options={SHIP_PREVIEW_OPTIONS} value={preview} onChange={setPreview} />
          <SegmentedControl label="Preview width" options={VIEWPORTS} value={viewport} onChange={setViewport} />
          <PaperButton variant="ghost" onClick={() => setFrameKey((key) => key + 1)}>
            Reload preview
          </PaperButton>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <GitCard slug={slug} git={data.git} auth={data.auth} />
        <DevCard slug={slug} dev={data.dev} onReady={() => setPreview("local")} />
        <DeployCard slug={slug} deploy={data.deploy} auth={data.auth} onLive={() => setPreview("live")} />
      </div>

      <section>
        <h3 className="mb-2 font-paper-utility text-[12px] font-medium tracking-[0.08em] text-paper-sage uppercase">
          {preview === "local" ? "Local preview" : "Live site"}
        </h3>
        {!previewUrl ? (
          <PaperCard className="p-5 text-[13.5px] text-paper-char">
            {preview === "local"
              ? "Start the local server to preview here. If the site blocks the frame, it opens in a native window instead."
              : "Link a Vercel project and deploy production to preview the live URL here."}
          </PaperCard>
        ) : blocked ? (
          <BlockedSitePanel url={previewUrl} projectId={slug} projectName={projectName} reason={data.live.embedReason} />
        ) : (
          <SitePreviewFrame key={`${preview}-${frameKey}-${previewUrl}`} url={previewUrl} viewport={viewport} title={`${preview} preview`} />
        )}
      </section>

      <ChangeList
        slug={slug}
        items={data.changes}
        statuses={statuses}
        priorities={priorities}
        previewUrl={previewUrl}
        onRePreview={() => {
          setPreview("local");
          setFrameKey((key) => key + 1);
        }}
      />
    </div>
  );
}

function GitCard({ slug, git, auth }: { slug: string; git: ShipSnapshot["git"]; auth: ShipSnapshot["auth"] }) {
  const init = useInitShipRepo(slug);
  const link = useLinkShipRepo(slug);
  const create = useCreateShipRepo(slug);
  const pull = usePullShipRepo(slug);
  const push = usePushShipRepo(slug);
  const [repo, setRepo] = useState("");
  const busy = init.isPending || link.isPending || create.isPending || pull.isPending || push.isPending;
  const error = init.error || link.error || create.error || pull.error || push.error;

  return (
    <PaperCard className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-paper-display text-[16px] font-bold">GitHub</h3>
        <PaperIndicator
          tone={git.remote ? "green" : git.isRepo ? "amber" : "muted"}
          label={git.remote ? git.remote.fullName : git.isRepo ? "Local only" : "Not connected"}
        />
      </div>
      {git.folder ? <p className="truncate font-mono text-[12px] text-paper-sage" title={git.folder}>{git.folder}</p> : null}
      {git.isRepo ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-paper-sage">Branch</dt>
          <dd className="text-paper-moss">{git.branch ?? "—"}</dd>
          <dt className="text-paper-sage">Commit</dt>
          <dd className="truncate text-paper-moss" title={git.subject}>{git.head ?? "—"}{git.subject ? ` · ${git.subject}` : ""}</dd>
          <dt className="text-paper-sage">Working tree</dt>
          <dd className="text-paper-moss">{git.dirty ? `Dirty (${git.changedFiles.length})` : "Clean"}</dd>
        </dl>
      ) : (
        <p className="text-[13px] text-paper-char">{git.setup ?? "Init the generated folder, or link an existing repo."}</p>
      )}
      {!git.remote ? (
        <div className="space-y-2">
          <FieldLabel>Existing repo</FieldLabel>
          <input className={cn(PAPER_INPUT, "w-full")} value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/name or github.com URL" />
          <div className="flex flex-wrap gap-2">
            <PaperButton variant="ghost" disabled={busy} onClick={() => init.mutate()}>Init folder</PaperButton>
            <PaperButton variant="ghost" disabled={busy || !repo.trim()} onClick={() => link.mutate(repo.trim())}>Link</PaperButton>
            <PaperButton variant="amber" disabled={busy} onClick={() => create.mutate({})}>Create & push</PaperButton>
          </div>
          {!auth.github ? <p className="text-[12.5px] text-paper-sage">{auth.githubHint}</p> : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <PaperButton variant="ghost" disabled={busy} onClick={() => pull.mutate()}>Pull</PaperButton>
          <PaperButton variant="ghost" disabled={busy} onClick={() => push.mutate()}>Push</PaperButton>
        </div>
      )}
      {error ? <p className="text-[12.5px] text-paper-flame">{error.message}</p> : null}
    </PaperCard>
  );
}

function DevCard({ slug, dev, onReady }: { slug: string; dev: ShipSnapshot["dev"]; onReady: () => void }) {
  const start = useStartShipDev(slug);
  const stop = useStopShipDev(slug);
  const busy = start.isPending || stop.isPending;

  return (
    <PaperCard className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-paper-display text-[16px] font-bold">Local</h3>
        <PaperIndicator
          tone={dev.status === "running" ? "green" : dev.status === "error" ? "flame" : dev.status === "stopped" ? "muted" : "amber"}
          label={shipDevLabel(dev.status)}
          detail={dev.port ? `:${dev.port}` : undefined}
        />
      </div>
      <p className="text-[13px] text-paper-char">
        {dev.packageManager && dev.script ? `${dev.packageManager} run ${dev.script}` : "No package.json dev script detected yet."}
      </p>
      <div className="flex flex-wrap gap-2">
        {dev.status === "running" || dev.status === "starting" || dev.status === "installing" ? (
          <PaperButton variant="ghost" disabled={busy} onClick={() => stop.mutate()}>Stop</PaperButton>
        ) : (
          <PaperButton
            variant="amber"
            disabled={busy}
            onClick={() => {
              start.mutate(undefined, { onSuccess: () => onReady() });
            }}
          >
            Start
          </PaperButton>
        )}
      </div>
      {dev.error ? <p className="text-[12.5px] text-paper-flame">{dev.error}</p> : null}
      {dev.logs.length > 0 ? (
        <pre className="max-h-36 overflow-auto bg-paper-linen p-2 font-mono text-[11px] leading-4 text-paper-char">{dev.logs.slice(-30).join("\n")}</pre>
      ) : null}
    </PaperCard>
  );
}

function DeployCard({
  slug,
  deploy,
  auth,
  onLive,
}: {
  slug: string;
  deploy: ShipSnapshot["deploy"];
  auth: ShipSnapshot["auth"];
  onLive: () => void;
}) {
  const projects = useVercelProjects();
  const link = useLinkShipVercel(slug);
  const create = useCreateShipVercel(slug);
  const run = useShipDeploy(slug);
  const [projectId, setProjectId] = useState(deploy.vercelProjectId ?? "");
  const busy = link.isPending || create.isPending || run.isPending;
  const error = link.error || create.error || run.error;
  const list = projects.data?.projects ?? [];

  return (
    <PaperCard className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-paper-display text-[16px] font-bold">Deploy</h3>
        <PaperIndicator
          tone={deploy.state === "READY" ? "green" : deploy.state === "ERROR" ? "flame" : deploy.state ? "amber" : "muted"}
          label={deploy.state ?? (deploy.vercelProjectId ? "Linked" : "Not linked")}
        />
      </div>
      {deploy.url ? <p className="truncate text-[13px] text-paper-moss">{deploy.url}</p> : null}
      {!deploy.vercelProjectId ? (
        <div className="space-y-2">
          <FieldLabel>Existing Vercel project</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Select…</option>
            {list.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <PaperButton
              variant="ghost"
              disabled={busy || !projectId}
              onClick={() => link.mutate({ projectId, projectName: list.find((project) => project.id === projectId)?.name })}
            >
              Link
            </PaperButton>
            <PaperButton variant="amber" disabled={busy} onClick={() => create.mutate()}>
              Create project
            </PaperButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <PaperButton variant="ghost" disabled={busy} onClick={() => run.mutate("preview")}>Preview</PaperButton>
          <PaperButton variant="amber" disabled={busy} onClick={() => run.mutate("production")}>Production</PaperButton>
          {deploy.url ? (
            <PaperButton variant="ghost" onClick={onLive}>
              View live
            </PaperButton>
          ) : null}
        </div>
      )}
      {!auth.vercel ? <p className="text-[12.5px] text-paper-sage">{auth.vercelHint}</p> : null}
      {deploy.error ? <p className="text-[12.5px] text-paper-flame">{deploy.error}</p> : null}
      {error ? <p className="text-[12.5px] text-paper-flame">{error.message}</p> : null}
    </PaperCard>
  );
}

function ChangeList({
  slug,
  items,
  statuses,
  priorities,
  previewUrl,
  onRePreview,
}: {
  slug: string;
  items: ShipChangeItem[];
  statuses: readonly string[];
  priorities: readonly string[];
  previewUrl?: string;
  onRePreview: () => void;
}) {
  const add = useAddShipChange(slug);
  const patch = usePatchShipChange(slug);
  const remove = useDeleteShipChange(slug);
  const send = useSendShipChanges(slug);
  const [text, setText] = useState("");
  const [page, setPage] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [shot, setShot] = useState<string>();
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (statuses.length === 0 || statuses.includes(item.status)) &&
          (priorities.length === 0 || priorities.includes(item.priority)),
      ),
    [items, priorities, statuses],
  );
  const selected = items.filter((item) => item.selected && item.status !== "done");
  const finished = items.some((item) => item.status === "done");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="font-paper-display text-[16px] font-bold">Change list</h3>
        <div className="flex flex-wrap gap-2">
          {finished ? (
            <PaperButton variant="ghost" onClick={onRePreview}>
              Re-preview
            </PaperButton>
          ) : null}
          <PaperButton
            variant="amber"
            disabled={send.isPending || selected.length === 0}
            onClick={() => send.mutate(selected.map((item) => item.id))}
          >
            Send to coding agent
          </PaperButton>
        </div>
      </div>
      <p className="text-[13px] text-paper-char">
        While you preview, add what to change. Selected items go as one Execute job through the existing worker system.
      </p>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_auto_auto] lg:items-end">
        <div>
          <FieldLabel>Change</FieldLabel>
          <input className={cn(PAPER_INPUT, "w-full")} value={text} onChange={(event) => setText(event.target.value)} placeholder="Tighten the hero headline" />
        </div>
        <div>
          <FieldLabel>Page / URL</FieldLabel>
          <input className={cn(PAPER_INPUT, "w-full")} value={page} onChange={(event) => setPage(event.target.value)} placeholder={previewUrl ?? "/"} />
        </div>
        <div>
          <FieldLabel>Priority</FieldLabel>
          <select className={PAPER_INPUT} value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
            {SHIP_CHANGE_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex min-h-9 cursor-pointer items-center text-[13px] text-paper-char">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void fileToDataUrl(file).then(setShot);
            }}
          />
          {shot ? "Screenshot attached" : "Attach screenshot"}
        </label>
      </div>
      <PaperButton
        variant="ghost"
        disabled={add.isPending || !text.trim()}
        onClick={() => {
          add.mutate(
            { text: text.trim(), page: page.trim() || undefined, url: previewUrl, priority, screenshot: shot },
            {
              onSuccess: () => {
                setText("");
                setPage("");
                setShot(undefined);
              },
            },
          );
        }}
      >
        Add change
      </PaperButton>
      {add.error ? <p className="text-[12.5px] text-paper-flame">{add.error.message}</p> : null}
      {send.error ? <p className="text-[12.5px] text-paper-flame">{send.error.message}</p> : null}

      <ul className="divide-y divide-paper-mist border border-paper-mist">
        {visible.length === 0 ? <li className="px-3 py-4 text-[13px] text-paper-sage">No changes yet.</li> : null}
        {visible.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-1"
              checked={item.selected}
              onChange={(event) => patch.mutate({ id: item.id, selected: event.target.checked })}
              disabled={item.status === "done"}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] text-paper-moss">{item.text}</p>
              <p className="text-[12px] text-paper-sage">
                {shipChangeStatusLabel(item.status)} · {item.priority}
                {item.page ? ` · ${item.page}` : ""}
                {item.jobHref ? (
                  <>
                    {" · "}
                    <Link to={item.jobHref} className="text-paper-blue hover:underline">
                      Job
                    </Link>
                  </>
                ) : null}
              </p>
              {item.error ? <p className="text-[12px] text-paper-flame">{item.error}</p> : null}
            </div>
            {item.screenshotId ? (
              <img src={shipScreenshotUrl(slug, item.screenshotId)} alt="" className="h-12 w-16 object-cover" />
            ) : null}
            <button type="button" className="text-[12px] text-paper-sage hover:text-paper-moss" onClick={() => remove.mutate(item.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
