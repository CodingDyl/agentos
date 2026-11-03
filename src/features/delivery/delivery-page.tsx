import { useId, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { REBUILD_STAGES, type RebuildFunction, type RebuildStageId } from "@shared/website-rebuild-types";
import type { DeliveryDecision, DeliveryState, DeliveryWorkspace } from "@shared/delivery-types";
import { AppShell } from "@/components/os";
import { PaperBackLink, PaperButton, PaperEmpty, PaperError, PaperLoading, PaperPageHeader, PaperSection, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import { useDeliveryOverview, useRebuildForWorkspace, useStartDelivery } from "@/lib/agentos/rebuilds";
import { RebuildView } from "@/features/rebuild/rebuild-page";
import { RebuildBriefFields } from "@/features/rebuild/brief-fields";
import { readBrief } from "@/features/rebuild/brief-model";

const stageTitle = (id: RebuildStageId | undefined) => REBUILD_STAGES.find((stage) => stage.id === id)?.title ?? "";

const STATE: Record<DeliveryState, { label: string; tone: "flame" | "green" | "marigold" | "muted" | "blue" }> = {
  needs_you: { label: "Needs you", tone: "marigold" },
  blocked: { label: "Stopped", tone: "flame" },
  running: { label: "Working", tone: "blue" },
  done: { label: "Preview ready", tone: "green" },
  not_started: { label: "Not started", tone: "muted" },
};

const deliveryHref = (slug: string) => `/delivery/${encodeURIComponent(slug)}`;

function Shell({ children }: { children: React.ReactNode }) {
  const navigationItems = useNavigationItems();
  return (
    <AppShell navigationItems={navigationItems} pageId="delivery" activeHref="/delivery" modelLabel="Model / AgentOS V1">
      <PaperStage>{children}</PaperStage>
    </AppShell>
  );
}

/**
 * Delivery: every workspace beside the website rebuild it has, and everything
 * waiting on you across all of them. Pick one to start or carry on.
 */
export function DeliveryPage() {
  const overview = useDeliveryOverview();
  const data = overview.data;
  return (
    <Shell>
      <div className="grid gap-8">
        <PaperPageHeader title="Delivery" description="Pick a workspace to build its website from scratch, or carry on from where it stopped. Every approval still happens on the stage itself." />
        {overview.isPending ? (
          <PaperLoading title="Delivery" message="Reading workspaces" />
        ) : overview.error || !data ? (
          <PaperError title="Delivery could not load" detail={overview.error?.message} onRetry={() => void overview.refetch()} isRetrying={overview.isFetching} headingLevel="h2" />
        ) : (
          <>
            <PaperSection label="Needs you" count={data.decisions.length}>
              {data.decisions.length === 0 ? <PaperEmpty description="Nothing is waiting on you. Running stages carry on by themselves." /> : <DecisionList decisions={data.decisions} />}
            </PaperSection>
            <PaperSection label="Workspaces" count={data.workspaces.length}>
              {data.workspaces.length === 0 ? (
                <PaperEmpty description="There are no workspaces yet. Create one in Workspaces, then come back to start its website." />
              ) : (
                <WorkspaceList workspaces={data.workspaces} />
              )}
            </PaperSection>
          </>
        )}
      </div>
    </Shell>
  );
}

function DecisionList({ decisions }: { decisions: DeliveryDecision[] }) {
  return (
    <ul className="divide-y divide-paper-mist border border-paper-mist bg-paper-white">
      {decisions.map((decision) => {
        const href = decision.workspaceSlug ? deliveryHref(decision.workspaceSlug) : `/rebuilds/${encodeURIComponent(decision.runId)}`;
        const blockers = decision.review?.blockers ?? 0;
        return (
          <li key={`${decision.runId}-${decision.stage}`}>
            <Link to={href} className="group grid cursor-pointer gap-1 px-4 py-3 transition-colors duration-150 hover:bg-paper-linen focus-visible:bg-paper-linen focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-paper-blue sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span className="font-semibold text-paper-moss">{decision.company}</span>
                  <span className="text-paper-sage">·</span>
                  <span className="text-paper-char">{stageTitle(decision.stage)}</span>
                  {decision.kind === "review" ? <Tag tone="marigold">Review r{decision.revision}</Tag> : <Tag tone="flame">Stopped</Tag>}
                  {blockers > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-paper-flame-deep">
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      Reviewer found {blockers} blocker{blockers === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </p>
                {decision.detail ? <p className="mt-0.5 line-clamp-2 max-w-[90ch] text-[13px] leading-5 text-paper-char">{decision.detail}</p> : null}
              </div>
              <span className="inline-flex items-center gap-1 text-[12.5px] text-paper-sage sm:justify-end">
                {formatRelativeTime(decision.since) ?? ""}
                <ArrowRight className="size-3.5 text-paper-blue transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function WorkspaceList({ workspaces }: { workspaces: DeliveryWorkspace[] }) {
  return (
    <ul className="divide-y divide-paper-mist border border-paper-mist bg-paper-white">
      {workspaces.map((workspace) => {
        const state = STATE[workspace.state];
        const action = workspace.state === "not_started" ? "Start" : workspace.state === "done" ? "Open" : "Resume";
        return (
          <li key={workspace.slug}>
            <Link to={deliveryHref(workspace.slug)} className="group grid cursor-pointer gap-1 px-4 py-3 transition-colors duration-150 hover:bg-paper-linen focus-visible:bg-paper-linen focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-paper-blue sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span className="font-semibold text-paper-moss">{workspace.name}</span>
                  <Tag tone={state.tone}>{state.label}</Tag>
                </p>
                <p className="mt-0.5 text-[13px] text-paper-sage tabular-nums">
                  {workspace.runId ? (
                    <>
                      {workspace.done} of {workspace.total} stages
                      {workspace.stage ? ` · now ${stageTitle(workspace.stage)}` : ""}
                      {workspace.updatedAt ? ` · ${formatRelativeTime(workspace.updatedAt) ?? ""}` : ""}
                    </>
                  ) : (
                    "No website yet"
                  )}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-paper-blue">
                {action}
                <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** One workspace's delivery: its rebuild, live, or the brief to start one. */
export function DeliveryWorkspacePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const rebuild = useRebuildForWorkspace(slug);
  const overview = useDeliveryOverview();
  const workspace = overview.data?.workspaces.find((entry) => entry.slug === slug);
  const name = workspace?.name ?? rebuild.data?.company ?? slug;

  return (
    <Shell>
      <div className="grid gap-6">
        <div>
          <PaperBackLink to="/delivery">Delivery</PaperBackLink>
          <PaperPageHeader
            className="mt-2"
            title={name}
            actions={
              <Link to={`/workspaces/${encodeURIComponent(slug)}`} className="text-[13px] font-semibold text-paper-blue hover:underline">
                Open the workspace
              </Link>
            }
          />
        </div>
        {rebuild.isPending ? (
          <PaperLoading title={name} message="Reading the rebuild" />
        ) : rebuild.error ? (
          <PaperError title="The rebuild could not load" detail={rebuild.error.message} onRetry={() => void rebuild.refetch()} isRetrying={rebuild.isFetching} headingLevel="h2" />
        ) : rebuild.data ? (
          <RebuildView run={rebuild.data} inWorkspace />
        ) : overview.data && !workspace ? (
          <PaperEmpty title="No such workspace" description="It may have been renamed or archived. Pick another from Delivery." />
        ) : (
          <DeliveryStartForm slug={slug} name={name} />
        )}
      </div>
    </Shell>
  );
}

function DeliveryStartForm({ slug, name }: { slug: string; name: string }) {
  const id = useId();
  const start = useStartDelivery();
  const [functions, setFunctions] = useState<RebuildFunction[]>(["contact_form"]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    start.mutate({ workspaceSlug: slug, ...readBrief(new FormData(event.currentTarget)), requiredFunctions: functions });
  };

  return (
    <form onSubmit={submit} className="grid max-w-[880px] gap-4 border border-paper-mist bg-paper-white p-5" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="font-paper-display text-[21px] font-bold tracking-[-0.015em] text-paper-moss">
          Build {name}'s website from scratch
        </h2>
        <p className="mt-1 max-w-[72ch] text-[13.5px] leading-5 text-paper-char">
          Seven stages, from their current site to a private Vercel preview, all in this workspace. You approve the design, the copy and the features before anything moves on. Nothing is sent to the client.
        </p>
      </div>
      <RebuildBriefFields id={id} defaults={{ websiteUrl: "", targetMarket: "" }} functions={functions} onFunctions={setFunctions} />
      {start.error ? (
        <p role="alert" className="border border-paper-flame-deep p-3 text-[13px] text-paper-flame-deep">
          {start.error.message}
        </p>
      ) : null}
      <div>
        <PaperButton type="submit" variant="amber" disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start the website"}
        </PaperButton>
      </div>
    </form>
  );
}
