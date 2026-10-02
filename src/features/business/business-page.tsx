import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BusinessClient, BusinessData, BusinessEntitySummary } from "@shared/business-types";
import { AppShell } from "@/components/os";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperSection, PaperStage, PaperTabs, SegmentedControl, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useBusiness, useLinkClientWorkspace, useRefreshBusiness, useSetEntityWorkspaces } from "@/lib/agentos/business";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { ClientDraftForm } from "./business-draft";
import { GrowthSection } from "./business-growth-section";
import { AgreementsSection, FollowUpsSection, MaintenanceSection, QuotesSection } from "./business-sections";
import { BUSINESS_TABS, formatRand, isBusinessTab, matchesClient, sortClients, type BusinessTab } from "./business-model";

/**
 * Business — the companies being run and the clients each one serves.
 *
 * Virtec is the system of record for clients while the CRM is taken over one
 * module at a time, so this screen reads from it and says so when it cannot.
 * Pantry Pilot and Voxmachine are their own businesses; they have no client
 * source yet and show that plainly instead of borrowing Virtec's.
 */
export function BusinessPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useBusiness();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get("tab");
  const tab: BusinessTab = isBusinessTab(requestedTab) ? requestedTab : "overview";

  const update = (changes: Record<string, string | undefined>) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <AppShell navigationItems={navigationItems} pageId="business" activeHref="/business" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        {isPending ? (
          <div aria-busy="true" aria-label="Reading Business">
            <div className="h-9 w-48 bg-paper-linen motion-safe:animate-pulse" />
            <div className="mt-8 h-40 border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
          </div>
        ) : !data ? (
          <div className="py-4">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">Business could not be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "The adapter did not answer."} Check that the AgentOS server is running.</p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <Business
            data={data}
            tab={tab}
            entityId={searchParams.get("entity") ?? data.entities[0]?.id}
            clientId={searchParams.get("client") ?? undefined}
            onTab={(next) => update({ tab: next === "overview" ? undefined : next, client: undefined })}
            onEntity={(entity) => update({ entity, client: undefined })}
            onClient={(client) => update({ tab: "clients", client })}
          />
        )}
      </PaperStage>
    </AppShell>
  );
}

function Business({
  data,
  tab,
  entityId,
  clientId,
  onTab,
  onEntity,
  onClient,
}: {
  data: BusinessData;
  tab: BusinessTab;
  entityId: string | undefined;
  clientId: string | undefined;
  onTab: (tab: BusinessTab) => void;
  onEntity: (id: string) => void;
  onClient: (id: string | undefined) => void;
}) {
  const refresh = useRefreshBusiness();
  const entity = data.entities.find((candidate) => candidate.id === entityId) ?? data.entities[0];
  if (!entity) return <p className="text-[14px] text-paper-char">No businesses are set up.</p>;

  const clients = data.clients.filter((client) => client.entityId === entity.id);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Business</h1>
          <p className="mt-1 text-[13px] text-paper-sage">
            {entity.kind === "agency" ? "Agency" : "Product"} · {entity.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl label="Business" value={entity.id} onChange={onEntity} options={data.entities.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
          {data.virtecConfigured ? (
            <PaperButton variant="ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Reading…" : "Refresh"}
            </PaperButton>
          ) : null}
        </div>
      </header>

      <VirtecNotice data={data} entity={entity} />

      <div className="mt-6">
        <PaperTabs label="Business sections" value={tab} onChange={onTab} options={BUSINESS_TABS} />
      </div>

      <div className="mt-6" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" ? (
          <Overview entity={entity} clients={clients} onOpenClient={onClient} />
        ) : tab === "growth" ? (
          <GrowthSection entity={entity} data={data} onTab={onTab} onClient={onClient} />
        ) : tab === "clients" ? (
          <Clients entity={entity} clients={clients} clientId={clientId} onClient={onClient} />
        ) : tab === "quotes" ? (
          <QuotesSection entity={entity} data={data} />
        ) : tab === "agreements" ? (
          <AgreementsSection entity={entity} data={data} />
        ) : tab === "maintenance" ? (
          <MaintenanceSection entity={entity} data={data} />
        ) : (
          <FollowUpsSection entity={entity} data={data} />
        )}
      </div>
    </div>
  );
}

/** Says why there is nothing to show, instead of showing a quiet zero. */
function VirtecNotice({ data, entity }: { data: BusinessData; entity: BusinessEntitySummary }) {
  if (entity.source !== "virtec") {
    return (
      <p className="mt-4 max-w-[70ch] text-[13.5px] leading-6 text-paper-char">
        {entity.name} has no client source yet. Its clients, quotes and retainers will live here once local records arrive; nothing from Virtec is shown against it.
      </p>
    );
  }
  if (!data.virtecConfigured) {
    return (
      <p role="status" className="mt-4 max-w-[70ch] border border-paper-mist bg-paper-cream p-3 text-[13.5px] leading-6 text-paper-char">
        Virtec is not connected. Set <code>VIRTEC_BASE_URL</code> and <code>VIRTEC_API_KEY</code> for the AgentOS server to read clients.
      </p>
    );
  }
  if (data.virtecProblem) {
    return (
      <p role="status" className="mt-4 max-w-[70ch] border border-paper-mist bg-paper-cream p-3 text-[13.5px] leading-6 text-paper-char">
        {data.virtecProblem} Figures below may be incomplete.
      </p>
    );
  }
  return null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12.5px] text-paper-sage">{label}</dt>
      <dd className="mt-0.5 font-paper-display text-[24px] font-bold tracking-[-0.01em]">{value}</dd>
    </div>
  );
}

function Overview({ entity, clients, onOpenClient }: { entity: BusinessEntitySummary; clients: BusinessClient[]; onOpenClient: (id: string) => void }) {
  const waiting = sortClients(clients).filter((client) => client.openFollowUps > 0 || client.pendingQuoteValue > 0).slice(0, 6);

  return (
    <div className="grid gap-8">
      <PaperCard>
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Clients" value={String(entity.clientCount)} />
          <Stat label="Live projects" value={String(entity.activeProjectCount)} />
          <Stat label="Quotes waiting" value={formatRand(entity.pendingQuoteValue)} />
          <Stat label="On maintenance" value={String(entity.maintenanceClientCount)} />
        </dl>
      </PaperCard>

      <PaperSection label="Needs a nudge" count={waiting.length}>
        {waiting.length === 0 ? (
          <p className="text-[14px] text-paper-char">No client has a quote or follow-up waiting.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {waiting.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <button type="button" onClick={() => onOpenClient(client.id)} className={cn("cursor-pointer text-left text-[15px] font-semibold text-paper-moss hover:underline", PAPER_FOCUS)}>
                  {client.companyName ?? client.name}
                </button>
                <span className="flex gap-2">
                  {client.pendingQuoteValue > 0 ? <Tag tone="marigold">{formatRand(client.pendingQuoteValue)} quoted</Tag> : null}
                  {client.openFollowUps > 0 ? <Tag tone="flame">{client.openFollowUps} follow-up{client.openFollowUps === 1 ? "" : "s"}</Tag> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PaperSection>

      <EntityWorkspaces entity={entity} />
    </div>
  );
}

/** Which workspaces do this business's work. */
function EntityWorkspaces({ entity }: { entity: BusinessEntitySummary }) {
  const { data: projects } = useProjects();
  const save = useSetEntityWorkspaces();
  const all = projects?.projects ?? [];

  const toggle = (slug: string) => {
    const next = entity.workspaces.includes(slug) ? entity.workspaces.filter((entry) => entry !== slug) : [...entity.workspaces, slug];
    save.mutate({ entityId: entity.id, workspaces: next });
  };

  return (
    <PaperSection label={`${entity.name} workspaces`} count={entity.workspaces.length}>
      {all.length === 0 ? (
        <p className="text-[14px] text-paper-char">No workspaces yet. <Link to="/workspaces" className="text-paper-blue hover:underline">Create one</Link>.</p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {all.map((project) => {
            const checked = entity.workspaces.includes(project.slug);
            return (
              <li key={project.slug}>
                <label className={cn("flex min-h-9 cursor-pointer items-center gap-2 px-1 text-[14px]", PAPER_FOCUS)}>
                  <input type="checkbox" checked={checked} disabled={save.isPending} onChange={() => toggle(project.slug)} />
                  <span className="min-w-0 truncate">{project.name}</span>
                  {checked ? (
                    <Link to={`/workspaces/${project.slug}`} className="ml-auto text-[12.5px] text-paper-blue hover:underline">
                      Open
                    </Link>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {save.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{save.error.message}</p> : null}
    </PaperSection>
  );
}

function Clients({ entity, clients, clientId, onClient }: { entity: BusinessEntitySummary; clients: BusinessClient[]; clientId: string | undefined; onClient: (id: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const shown = sortClients(clients).filter((client) => matchesClient(client, query));
  const selected = clients.find((client) => client.id === clientId);

  if (clients.length === 0) {
    return <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">{entity.name} has no clients recorded.</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div>
        <label>
          <FieldLabel>Search clients</FieldLabel>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, company or email" className={cn(PAPER_INPUT, "w-full")} />
        </label>
        <ul className="mt-3 divide-y divide-paper-mist border-y border-paper-mist" aria-label="Clients">
          {shown.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => onClient(client.id)}
                aria-current={client.id === selected?.id ? "true" : undefined}
                className={cn("flex w-full cursor-pointer items-center justify-between gap-3 px-2 py-3 text-left", PAPER_FOCUS, client.id === selected?.id ? "bg-paper-linen" : "hover:bg-paper-cream")}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold">{client.companyName ?? client.name}</span>
                  {client.companyName ? <span className="block truncate text-[12.5px] text-paper-sage">{client.name}</span> : null}
                </span>
                {!client.active ? <Tag>Inactive</Tag> : client.maintenance ? <Tag tone="green">Retainer</Tag> : null}
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-2 py-3 text-[14px] text-paper-char">No client matches “{query}”.</li> : null}
        </ul>
      </div>

      {selected ? <ClientDetail key={selected.id} client={selected} /> : <p className="text-[14px] text-paper-sage">Select a client to see their work.</p>}
    </div>
  );
}

function ClientDetail({ client }: { client: BusinessClient }) {
  const { data: projects } = useProjects();
  const [replyingTo, setReplyingTo] = useState<string>();
  const link = useLinkClientWorkspace();
  const workspace = projects?.projects.find((project) => project.slug === client.workspace);

  return (
    <article aria-label={client.companyName ?? client.name} className="grid gap-6">
      <header>
        <h2 className="font-paper-display text-[22px] font-bold tracking-[-0.015em]">{client.companyName ?? client.name}</h2>
        <p className="mt-1 text-[13.5px] text-paper-sage">
          {client.name}
          {client.email ? <> · <a href={`mailto:${client.email}`} className="text-paper-blue hover:underline">{client.email}</a></> : null}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Spent" value={formatRand(client.totalSpent)} />
          <Stat label="Live projects" value={String(client.activeProjectCount)} />
          <Stat label="Quoted, waiting" value={formatRand(client.pendingQuoteValue)} />
          <Stat label="Follow-ups" value={String(client.openFollowUps)} />
        </dl>
      </header>

      <PaperSection label="Workspace">
        <div className="flex flex-wrap items-center gap-3">
          <label>
            <span className="sr-only">Linked workspace</span>
            <select
              className={cn(PAPER_INPUT, "min-w-56")}
              value={client.workspace ?? ""}
              disabled={link.isPending}
              onChange={(event) => link.mutate({ clientId: client.id, workspace: event.target.value || null })}
            >
              <option value="">Not linked</option>
              {client.workspace && !workspace ? <option value={client.workspace}>{client.workspace} (not found)</option> : null}
              {(projects?.projects ?? []).map((project) => (
                <option key={project.slug} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {workspace ? (
            <Link to={`/workspaces/${workspace.slug}`} className="text-[13.5px] text-paper-blue hover:underline">
              Open workspace
            </Link>
          ) : null}
        </div>
        {link.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{link.error.message}</p> : null}
      </PaperSection>

      <PaperSection label="Mail" count={client.mail.length}>
        {client.mail.length === 0 ? (
          <p className="text-[14px] text-paper-char">No recent Inbox threads from {client.email ? client.email : "this client"}.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {client.mail.map((thread) => (
              <li key={thread.threadId} className="grid gap-0.5 py-3">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("min-w-0 truncate text-[14px]", thread.unread && "font-semibold")}>{thread.subject}</span>
                  <span className="flex items-center gap-2 text-[12.5px] text-paper-sage">
                    {thread.needsYou ? <Tag tone="flame">Needs you</Tag> : null}
                    <time dateTime={thread.messageDate}>{new Date(thread.messageDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>
                  </span>
                </span>
                <span className="truncate text-[12.5px] text-paper-sage">{thread.snippet}</span>
                {replyingTo === thread.threadId ? (
                  <div className="mt-2">
                    <ClientDraftForm request={{ clientId: client.id, threadId: thread.threadId }} showSubject={false} onClose={() => setReplyingTo(undefined)} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setReplyingTo(thread.threadId)} className={cn("mt-1 w-fit cursor-pointer text-[12.5px] text-paper-blue hover:underline", PAPER_FOCUS)}>
                    Draft reply
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link to="/inbox" className="mt-2 inline-block text-[13px] text-paper-blue hover:underline">Open Inbox</Link>
      </PaperSection>

      <PaperSection label="Projects" count={client.projects.length}>
        {client.projects.length === 0 ? (
          <p className="text-[14px] text-paper-char">No projects.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {client.projects.map((project) => (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[14px]">
                <span>{project.projectType ?? "Project"}{project.maintenanceFrequency ? ` · ${project.maintenanceFrequency}` : ""}</span>
                <span className="flex items-center gap-2 text-paper-char">
                  {project.completion !== undefined ? `${Math.round(project.completion)}%` : null}
                  {project.amount !== undefined ? formatRand(project.amount) : null}
                  {project.status ? <Tag>{project.status}</Tag> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PaperSection>

      <PaperSection label="Quotes" count={client.quotes.length}>
        {client.quotes.length === 0 ? (
          <p className="text-[14px] text-paper-char">No quotes.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {client.quotes.map((quote) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[14px]">
                <span>{quote.projectType ?? "Quote"}</span>
                <span className="flex items-center gap-2 text-paper-char">
                  {quote.totalAmount !== undefined ? formatRand(quote.totalAmount) : null}
                  {quote.status ? <Tag tone={quote.status === "accepted" ? "green" : quote.status === "pending" ? "marigold" : "muted"}>{quote.status}</Tag> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PaperSection>
    </article>
  );
}
