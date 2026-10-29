import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { ShipChangeItem, ShipChangePriority, ShipPreviewSource, ShipSnapshot } from "@shared/ship-types";
import { DedsecLoader, FilterToolbar, type FilterGroup } from "@/components/os";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperError, PaperIndicator, PaperNotice, SegmentedControl } from "@/components/paper";
import { BlockedSitePanel, SiteFrame } from "@/features/site";
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
  confirmsProduction,
  fileToDataUrl,
  filterChanges,
  productionConfirmationName,
  SHIP_CHANGE_PRIORITY_OPTIONS,
  SHIP_CHANGE_STATUS_OPTIONS,
  SHIP_PREVIEW_OPTIONS,
  shipChangeStatusLabel,
  shipDevLabel,
} from "./ship-model";

type Viewport = "desktop" | "mobile";

const VIEWPORTS: readonly { value: Viewport; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

const CARD_TITLE = "font-paper-display text-[16px] font-bold text-paper-moss";
const ERROR_TEXT = "text-[12.5px] text-paper-flame-deep";

/**
 * Ship: finish a generated project without leaving its workspace.
 *
 * GitHub, the local dev server (the Dev tab's, run in this folder), Vercel,
 * a framed preview of either, and a change list that goes to a coding agent
 * as one Execute job. Production is reached only through a typed confirmation.
 */
export function ShipPanel({ slug, projectName }: { slug: string; projectName: string }) {
  const ship = useShip(slug);
  const [preview, setPreview] = useState<ShipPreviewSource>("local");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [frameKey, setFrameKey] = useState(0);

  if (ship.isPending) return <DedsecLoader variant="compact" />;
  if (ship.isError) {
    return <PaperError headingLevel="h2" title="Ship could not be read." detail={ship.error.message} onRetry={() => void ship.refetch()} isRetrying={ship.isFetching} />;
  }

  const data = ship.data;
  const previewUrl = preview === "local" ? (data.dev.status === "running" ? data.dev.url : undefined) : data.live.url;
  const blocked = preview === "live" && data.live.embedAllowed === false;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-paper-display text-[24px] font-bold tracking-[-0.01em] text-paper-moss">Ship</h2>
          <p className="mt-1 max-w-[72ch] text-[13.5px] text-paper-char">
            Connect the repo, preview locally, deploy, and send visual changes to a coding agent, without leaving this workspace.
          </p>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <GitCard slug={slug} snapshot={data} />
        <DevCard slug={slug} dev={data.dev} onRunning={() => setPreview("local")} />
        <DeployCard slug={slug} snapshot={data} onLive={() => setPreview("live")} />
      </div>

      <section aria-labelledby={`${slug}-ship-preview`} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${slug}-ship-preview`} className="font-paper-utility text-[12px] font-medium tracking-[0.08em] text-paper-sage uppercase">
            {preview === "local" ? "Local preview" : "Live site"}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl label="Preview source" options={SHIP_PREVIEW_OPTIONS} value={preview} onChange={setPreview} />
            <SegmentedControl label="Preview width" options={VIEWPORTS} value={viewport} onChange={setViewport} />
            <PaperButton variant="ghost" disabled={!previewUrl} onClick={() => setFrameKey((key) => key + 1)}>
              Reload
            </PaperButton>
          </div>
        </div>
        {!previewUrl ? (
          <PaperCard className="text-[13.5px] text-paper-char">
            {preview === "local" ? "Start the local server to preview the site here." : "Link a Vercel project and deploy to production to see the live site here."}
          </PaperCard>
        ) : blocked ? (
          <BlockedSitePanel url={previewUrl} projectId={data.deploy.vercelProjectId ?? slug} projectName={projectName} reason={data.live.embedReason} />
        ) : (
          <SiteFrame key={`${preview}-${frameKey}-${previewUrl}`} url={previewUrl} viewport={viewport} />
        )}
      </section>

      <ChangeList
        slug={slug}
        items={data.changes}
        canSend={Boolean(data.git.folder)}
        previewUrl={previewUrl}
        onRePreview={() => {
          setPreview("local");
          setFrameKey((key) => key + 1);
        }}
      />
    </div>
  );
}

/** "Type the project's name": the confirmation step in front of anything that reaches production. */
function ProductionConfirm({
  expected,
  action,
  pending,
  onConfirm,
  onCancel,
}: {
  expected: string;
  action: string;
  pending: boolean;
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const ok = confirmsProduction(typed, expected);

  return (
    <form
      role="alertdialog"
      aria-labelledby={`${inputId}-title`}
      className="space-y-2 border-[1.5px] border-paper-flame-deep bg-paper-linen p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) onConfirm(typed.trim());
      }}
    >
      <p id={`${inputId}-title`} className="text-[13px] text-paper-char">
        {action} goes to <strong>production</strong> on Vercel. Type <code className="bg-paper-stone px-1 font-mono text-[12.5px]">{expected}</code> to confirm.
      </p>
      <label htmlFor={inputId} className="sr-only">
        Vercel project name
      </label>
      <input id={inputId} className={cn(PAPER_INPUT, "w-full")} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} autoFocus />
      <div className="flex flex-wrap gap-2">
        <PaperButton type="submit" variant="danger" disabled={!ok || pending}>
          Confirm production
        </PaperButton>
        <PaperButton variant="quiet" onClick={onCancel}>
          Cancel
        </PaperButton>
      </div>
    </form>
  );
}

function GitCard({ slug, snapshot }: { slug: string; snapshot: ShipSnapshot }) {
  const { git, auth, deploy } = snapshot;
  const init = useInitShipRepo(slug);
  const link = useLinkShipRepo(slug);
  const create = useCreateShipRepo(slug);
  const pull = usePullShipRepo(slug);
  const push = usePushShipRepo(slug);
  const [repo, setRepo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const repoInput = useId();
  const busy = init.isPending || link.isPending || create.isPending || pull.isPending || push.isPending;
  const error = init.error || link.error || create.error || pull.error || push.error;
  const expected = productionConfirmationName(deploy);
  const pushNeedsConfirm = Boolean(git.pushDeploysProduction && expected);

  return (
    <PaperCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={CARD_TITLE}>GitHub</h3>
        <PaperIndicator tone={git.remote ? "green" : git.isRepo ? "amber" : "muted"} label={git.remote ? git.remote.fullName : git.isRepo ? "Local only" : "Not connected"} />
      </div>
      {git.folder ? (
        <p className="truncate font-mono text-[12px] text-paper-sage" title={git.folder}>
          {git.folder}
        </p>
      ) : null}
      {git.isRepo ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-paper-sage">Branch</dt>
          <dd className="text-paper-moss">{git.branch ?? "Detached"}</dd>
          <dt className="text-paper-sage">Commit</dt>
          <dd className="truncate text-paper-moss" title={git.subject}>
            {git.head ?? "None yet"}
            {git.subject ? ` · ${git.subject}` : ""}
          </dd>
          <dt className="text-paper-sage">Working tree</dt>
          <dd className="text-paper-moss">{git.dirty ? `${git.changedFiles.length} changed` : "Clean"}</dd>
          {git.remote && git.ahead ? (
            <>
              <dt className="text-paper-sage">Unpushed</dt>
              <dd className="text-paper-moss">{git.ahead}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-[13px] text-paper-char">{git.setup ?? "Init the folder as a repository, or link an existing GitHub repo."}</p>
      )}

      {!git.remote ? (
        <div className="space-y-2">
          <label htmlFor={repoInput}>
            <FieldLabel>Existing GitHub repo</FieldLabel>
          </label>
          <input id={repoInput} className={cn(PAPER_INPUT, "w-full")} value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/name or github.com URL" />
          <div className="flex flex-wrap gap-2">
            {git.folder && !git.isRepo ? (
              <PaperButton variant="ghost" disabled={busy} onClick={() => init.mutate()}>
                Init folder
              </PaperButton>
            ) : null}
            <PaperButton variant="ghost" disabled={busy || !repo.trim()} onClick={() => link.mutate(repo.trim())}>
              Link
            </PaperButton>
            {git.folder ? (
              <PaperButton variant="amber" disabled={busy || !auth.github} onClick={() => create.mutate({})}>
                Create private repo &amp; push
              </PaperButton>
            ) : null}
          </div>
          {!auth.github ? <p className="text-[12.5px] text-paper-sage">{auth.githubHint}</p> : null}
        </div>
      ) : confirming && expected ? (
        <ProductionConfirm
          expected={expected}
          action={`Pushing ${git.branch ?? "this branch"}`}
          pending={push.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={(typed) => push.mutate({ confirmProduction: typed }, { onSettled: () => setConfirming(false) })}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <PaperButton variant="ghost" disabled={busy} onClick={() => pull.mutate()}>
            Pull
          </PaperButton>
          <PaperButton variant="ghost" disabled={busy || !git.branch} onClick={() => (pushNeedsConfirm ? setConfirming(true) : push.mutate({}))}>
            Push{pushNeedsConfirm ? " (production)" : ""}
          </PaperButton>
        </div>
      )}
      {push.data?.message && !push.isPending ? <p className="text-[12.5px] text-paper-sage">{push.data.message}</p> : null}
      {error ? <p className={ERROR_TEXT}>{error.message}</p> : null}
    </PaperCard>
  );
}

function DevCard({ slug, dev, onRunning }: { slug: string; dev: ShipSnapshot["dev"]; onRunning: () => void }) {
  const start = useStartShipDev(slug);
  const stop = useStopShipDev(slug);
  const busy = start.isPending || stop.isPending;
  const active = dev.status === "running" || dev.status === "starting" || dev.status === "installing";
  const plan = dev.plan?.ok ? dev.plan : undefined;

  return (
    <PaperCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={CARD_TITLE}>Local</h3>
        <PaperIndicator
          tone={dev.status === "running" ? "green" : dev.status === "failed" ? "flame" : dev.status === "stopped" ? "muted" : "amber"}
          label={shipDevLabel(dev.status)}
          detail={dev.port ? `:${dev.port}` : undefined}
        />
      </div>
      <p className="text-[13px] text-paper-char">
        {dev.command ?? plan?.command ?? (dev.plan && !dev.plan.ok ? dev.plan.reason : "No project folder yet.")}
        {plan?.needsInstall && !active ? ` (runs ${plan.installCommand} first)` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {active ? (
          <PaperButton variant="danger" disabled={busy} onClick={() => stop.mutate()}>
            Stop
          </PaperButton>
        ) : (
          <PaperButton variant="amber" disabled={busy || !plan} onClick={() => start.mutate(undefined, { onSuccess: onRunning })}>
            {dev.status === "failed" ? "Try again" : "Start"}
          </PaperButton>
        )}
        <Link to={`/workspaces/${encodeURIComponent(slug)}?tab=dev`} className="inline-flex min-h-9 items-center text-[13px] text-paper-blue hover:underline">
          Full output
        </Link>
      </div>
      {dev.error ? <p className={ERROR_TEXT}>{dev.error}</p> : null}
      {start.error || stop.error ? <p className={ERROR_TEXT}>{(start.error ?? stop.error)?.message}</p> : null}
      {dev.output.length > 0 ? (
        <pre tabIndex={0} aria-label="Server output" className="max-h-36 overflow-auto bg-paper-char p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-paper-linen">
          {dev.output.slice(-30).join("\n")}
        </pre>
      ) : null}
    </PaperCard>
  );
}

function DeployCard({ slug, snapshot, onLive }: { slug: string; snapshot: ShipSnapshot; onLive: () => void }) {
  const { deploy, auth, git } = snapshot;
  const projects = useVercelProjects();
  const link = useLinkShipVercel(slug);
  const create = useCreateShipVercel(slug);
  const run = useShipDeploy(slug);
  const [projectId, setProjectId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const selectId = useId();
  const busy = link.isPending || create.isPending || run.isPending;
  const error = link.error || create.error || run.error;
  const list = auth.vercel ? (projects.data?.projects ?? []) : [];
  const expected = productionConfirmationName(deploy);

  return (
    <PaperCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={CARD_TITLE}>Vercel</h3>
        <PaperIndicator
          tone={deploy.state === "READY" ? "green" : deploy.state === "ERROR" ? "flame" : deploy.state ? "amber" : "muted"}
          label={deploy.state ? `${deploy.target === "production" ? "Production" : "Preview"} ${deploy.state.toLowerCase()}` : deploy.vercelProjectId ? "Linked" : "Not linked"}
        />
      </div>
      {deploy.vercelProjectName ? <p className="text-[13px] text-paper-char">{deploy.vercelProjectName}</p> : null}
      {deploy.url ? (
        <a href={deploy.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[13px] text-paper-blue hover:underline">
          {deploy.url}
        </a>
      ) : null}

      {!deploy.vercelProjectId ? (
        <div className="space-y-2">
          <label htmlFor={selectId}>
            <FieldLabel>Existing Vercel project</FieldLabel>
          </label>
          <select id={selectId} className={cn(PAPER_INPUT, "w-full")} value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!auth.vercel}>
            <option value="">Select…</option>
            {list.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <PaperButton variant="ghost" disabled={busy || !projectId} onClick={() => link.mutate(projectId)}>
              Link
            </PaperButton>
            <PaperButton variant="amber" disabled={busy || !auth.vercel || !git.remote} onClick={() => create.mutate()}>
              Create project
            </PaperButton>
          </div>
          {auth.vercel && !git.remote ? <p className="text-[12.5px] text-paper-sage">Connect a GitHub repo first to create a project.</p> : null}
        </div>
      ) : confirming && expected ? (
        <ProductionConfirm
          expected={expected}
          action={`Deploying ${git.branch ?? "this branch"} at ${git.head ?? "HEAD"}`}
          pending={run.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={(typed) => run.mutate({ target: "production", confirm: typed }, { onSettled: () => setConfirming(false) })}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <PaperButton variant="ghost" disabled={busy || !auth.vercel || !git.remote} onClick={() => run.mutate({ target: "preview" })}>
            Deploy preview
          </PaperButton>
          <PaperButton variant="danger" disabled={busy || !auth.vercel || !git.remote} onClick={() => setConfirming(true)}>
            Production…
          </PaperButton>
          {snapshot.live.url ? (
            <PaperButton variant="quiet" onClick={onLive}>
              View live
            </PaperButton>
          ) : null}
        </div>
      )}
      {!auth.vercel ? <p className="text-[12.5px] text-paper-sage">{auth.vercelHint}</p> : null}
      {deploy.error ? <p className={ERROR_TEXT}>{deploy.error}</p> : null}
      {error ? <p className={ERROR_TEXT}>{error.message}</p> : null}
    </PaperCard>
  );
}

function ChangeList({
  slug,
  items,
  canSend,
  previewUrl,
  onRePreview,
}: {
  slug: string;
  items: ShipChangeItem[];
  canSend: boolean;
  previewUrl?: string;
  onRePreview: () => void;
}) {
  const add = useAddShipChange(slug);
  const patch = usePatchShipChange(slug);
  const remove = useDeleteShipChange(slug);
  const send = useSendShipChanges(slug);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [page, setPage] = useState("");
  const [priority, setPriority] = useState<ShipChangePriority>("medium");
  const [shot, setShot] = useState<string>();
  const [shotError, setShotError] = useState<string>();
  const ids = { text: useId(), page: useId(), priority: useId() };
  const visible = filterChanges(items, statuses, priorities);
  const selected = items.filter((item) => item.selected && item.status === "open");
  const finished = items.some((item) => item.status === "done");
  const filters: FilterGroup[] = [
    { id: "status", label: "Status", mode: "multiple", values: statuses, onChange: setStatuses, options: SHIP_CHANGE_STATUS_OPTIONS },
    { id: "priority", label: "Priority", mode: "multiple", values: priorities, onChange: setPriorities, options: SHIP_CHANGE_PRIORITY_OPTIONS },
  ];

  return (
    <section aria-labelledby={`${slug}-ship-changes`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id={`${slug}-ship-changes`} className={CARD_TITLE}>
          Change list
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <FilterToolbar groups={filters} label="Filter" />
          {finished ? (
            <PaperButton variant="ghost" onClick={onRePreview}>
              Re-preview
            </PaperButton>
          ) : null}
          <PaperButton variant="amber" disabled={!canSend || send.isPending || selected.length === 0} onClick={() => send.mutate(selected.map((item) => item.id))}>
            Send {selected.length || ""} to coding agent
          </PaperButton>
        </div>
      </div>
      <p className="text-[13px] text-paper-char">While you preview, note what to change. The selected items go to the worker system as one Execute job. A finished job never deploys anything.</p>

      <form
        className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_auto_auto_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
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
        <div>
          <label htmlFor={ids.text}>
            <FieldLabel>Change</FieldLabel>
          </label>
          <input id={ids.text} className={cn(PAPER_INPUT, "w-full")} value={text} maxLength={2_000} onChange={(event) => setText(event.target.value)} placeholder="Tighten the hero headline" />
        </div>
        <div>
          <label htmlFor={ids.page}>
            <FieldLabel>Page</FieldLabel>
          </label>
          <input id={ids.page} className={cn(PAPER_INPUT, "w-full")} value={page} maxLength={300} onChange={(event) => setPage(event.target.value)} placeholder="/" />
        </div>
        <div>
          <label htmlFor={ids.priority}>
            <FieldLabel>Priority</FieldLabel>
          </label>
          <select id={ids.priority} className={PAPER_INPUT} value={priority} onChange={(event) => setPriority(event.target.value as ShipChangePriority)}>
            {SHIP_CHANGE_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex min-h-9 cursor-pointer items-center border border-paper-ash bg-paper-linen px-3 text-[13px] text-paper-moss focus-within:outline-2 focus-within:outline-paper-blue">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setShotError(undefined);
              if (!file) return;
              if (file.size > 4 * 1024 * 1024) {
                setShotError("Screenshots must be under 4 MB.");
                return;
              }
              void fileToDataUrl(file).then(setShot, (reason: Error) => setShotError(reason.message));
            }}
          />
          {shot ? "Screenshot attached" : "Attach screenshot"}
        </label>
        <PaperButton type="submit" variant="ghost" disabled={add.isPending || !text.trim()}>
          Add change
        </PaperButton>
      </form>
      {shotError ? <p className={ERROR_TEXT}>{shotError}</p> : null}
      {add.error ? <p className={ERROR_TEXT}>{add.error.message}</p> : null}
      {send.error ? <p className={ERROR_TEXT}>{send.error.message}</p> : null}
      {send.data ? (
        <PaperNotice>
          Sent as one job.{" "}
          <Link to={send.data.href} className="text-paper-blue hover:underline">
            Open the job
          </Link>
        </PaperNotice>
      ) : null}

      <ul className="divide-y divide-paper-mist border border-paper-mist">
        {visible.length === 0 ? <li className="px-3 py-4 text-[13px] text-paper-sage">{items.length === 0 ? "No changes yet." : "No changes match the filter."}</li> : null}
        {visible.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-1 size-4"
              aria-label={`Send “${item.text}”`}
              checked={item.selected && item.status === "open"}
              onChange={(event) => patch.mutate({ id: item.id, selected: event.target.checked })}
              disabled={item.status !== "open"}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] break-words text-paper-moss">{item.text}</p>
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
              {item.error ? <p className="text-[12px] text-paper-flame-deep">{item.error}</p> : null}
            </div>
            {item.screenshotId ? <img src={shipScreenshotUrl(slug, item.screenshotId)} alt={`Screenshot for “${item.text}”`} className="h-12 w-16 object-cover" /> : null}
            <PaperButton variant="quiet" className="min-h-0 px-2 text-[12px]" onClick={() => remove.mutate(item.id)} aria-label={`Remove “${item.text}”`}>
              Remove
            </PaperButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
