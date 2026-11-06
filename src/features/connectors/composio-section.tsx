import { ChevronDown, Plug, Search } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ComposioAccount, ComposioActionClass, ComposioApp, ComposioToolkit } from "@shared/composio-types";
import type { CapabilityPolicy } from "@shared/connector-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, PaperSwitch, SegmentedControl, Tag } from "@/components/paper";
import {
  useComposioApps,
  useComposioCategories,
  useComposioToolkits,
  useConnectComposioApp,
  useDisconnectComposioAccount,
  useUpdateComposioApp,
} from "@/lib/agentos/composio";
import { cn } from "@/lib/utils";
import { ACTION_CLASSES, accountSummary, needsSignIn, policySummary } from "./composio-model";
import { POLICY_OPTIONS } from "./connectors-model";

/**
 * Apps reached through Composio, on top of the connectors AgentOS has its own
 * code for: the ones connected, what an agent may do in each, and the catalog
 * to connect more from.
 *
 * Read on its own query, so a Composio problem never hides the rest of the page.
 */
export function ComposioSection({ className }: { className?: string }) {
  const { data, isPending, error, isFetching, refetch } = useComposioApps();
  const ready = Boolean(data?.configured && data.enabled);
  const connected = useMemo(() => new Set(data?.apps.map((app) => app.slug)), [data]);

  return (
    <PaperSection
      id="composio"
      label="Apps through Composio"
      count={ready ? data?.apps.length : undefined}
      className={className}
      action={
        <Link to="/connectors/composio" className={cn("rounded-sm text-[13px] font-medium text-paper-blue hover:underline", PAPER_FOCUS)}>
          Composio settings
        </Link>
      }
    >
      {isPending ? (
        <p className="text-[14px] text-paper-sage">Reading your connected apps…</p>
      ) : !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="max-w-[72ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "The connected apps couldn't be read."}</p>
          <PaperButton variant="ghost" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Trying again…" : "Try again"}
          </PaperButton>
        </div>
      ) : !data.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-md border border-paper-mist px-4 py-3">
          <p className="max-w-[68ch] text-[14px] leading-6 text-paper-char">
            Connect Notion, Slack, Linear and 1,700 more with one Composio key. Agents can then use them, under limits you set for each app.
          </p>
          <Link
            to="/connectors/composio"
            className={cn("inline-flex min-h-[var(--control-height)] items-center rounded-md border border-paper-mist bg-paper-linen px-3.5 text-[14px] font-medium text-paper-moss hover:bg-paper-stone", PAPER_FOCUS)}
          >
            Add your key
          </Link>
        </div>
      ) : !data.enabled ? (
        <p className="text-[14px] leading-6 text-paper-char">
          Composio is switched off, so AgentOS isn't contacting it and agents can't use your connected apps. Turn it on in{" "}
          <Link to="/connectors/composio" className={cn("rounded-sm font-medium text-paper-blue hover:underline", PAPER_FOCUS)}>
            Composio settings
          </Link>
          .
        </p>
      ) : (
        <>
          {data.apps.length > 0 ? (
            <ul className="divide-y divide-paper-stone rounded-md border border-paper-mist">
              {data.apps.map((app) => (
                <AppRow key={app.slug} app={app} />
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-paper-sage">No apps connected yet. Find one below.</p>
          )}
          <AppCatalog connected={connected} />
        </>
      )}
    </PaperSection>
  );
}

function AppLogo({ logo }: { logo?: string }) {
  const [failed, setFailed] = useState(false);
  return logo && !failed ? (
    // A light tile, because most logos are drawn for a light page.
    <span className="inline-grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-paper-moss p-1" aria-hidden="true">
      <img src={logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain" onError={() => setFailed(true)} />
    </span>
  ) : (
    <span className="inline-grid size-8 shrink-0 place-items-center rounded-md border border-paper-mist bg-paper-linen text-paper-moss" aria-hidden="true">
      <Plug className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** Where a sign-in stands, once it has been started from this row. */
function SignInNote({ toolkit, connect }: { toolkit: string; connect: ReturnType<typeof useConnectComposioApp> }) {
  if (connect.variables?.toolkit !== toolkit) return null;
  if (connect.isError) {
    return (
      <p role="alert" className="basis-full text-[13px] leading-5 text-paper-flame-deep">
        {connect.error.message}
      </p>
    );
  }
  if (connect.isSuccess) {
    return (
      <p role="status" className="basis-full text-[13px] leading-5 text-paper-char">
        {connect.data ? (
          <>
            Your browser stopped the sign-in page from opening.{" "}
            <a href={connect.data} target="_blank" rel="noopener noreferrer" className={cn("rounded-sm font-medium text-paper-blue hover:underline", PAPER_FOCUS)}>
              Open it here
            </a>
            .
          </>
        ) : (
          "Finish signing in on Composio's page. The app shows up here when you come back."
        )}
      </p>
    );
  }
  return null;
}

function AppRow({ app }: { app: ComposioApp }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const update = useUpdateComposioApp();
  const signedOut = needsSignIn(app);

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
        <div className="flex min-w-0 basis-full items-center gap-4 sm:basis-auto sm:flex-1">
          <AppLogo logo={app.logo} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-paper-moss">
              {app.name}
              {signedOut ? <Tag tone="flame" className="whitespace-nowrap">Signed out</Tag> : null}
              {!app.enabled ? <Tag tone="muted" className="whitespace-nowrap">Off for agents</Tag> : null}
            </p>
            <p className="text-[13px] text-paper-sage sm:truncate">
              {accountSummary(app.accounts)} · {policySummary(app.policies)}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <PaperSwitch
            checked={app.enabled}
            disabled={update.isPending}
            label={`${app.enabled ? "Stop" : "Let"} agents ${app.enabled ? "using" : "use"} ${app.name}`}
            onChange={(enabled) => update.mutate({ slug: app.slug, patch: { enabled } })}
          />
          <PaperButton variant="quiet" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)} aria-label={`Manage ${app.name}`}>
            Manage
            <ChevronDown className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
          </PaperButton>
        </div>
      </div>
      {update.isError ? (
        <p role="alert" className="px-4 pb-3 text-[13px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}
      {open ? <AppPanel id={panelId} app={app} /> : null}
    </li>
  );
}

function AppPanel({ id, app }: { id: string; app: ComposioApp }) {
  return (
    <div id={id} className="grid gap-6 border-t border-paper-stone bg-paper-cream px-4 py-4 lg:grid-cols-2">
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-paper-moss">Accounts</h3>
        <ul className="mt-2 divide-y divide-paper-stone">
          {app.accounts.map((account) => (
            <AccountRow key={account.id} toolkit={app.slug} account={account} appName={app.name} />
          ))}
        </ul>
        <AddAccount app={app} />
      </div>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-paper-moss">What agents may do</h3>
        <ul className="mt-2 grid gap-3">
          {ACTION_CLASSES.map((actionClass) => (
            <PolicyRow key={actionClass.id} app={app} actionClass={actionClass.id} label={actionClass.label} hint={actionClass.hint} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function AccountRow({ toolkit, account, appName }: { toolkit: string; account: ComposioAccount; appName: string }) {
  const [confirming, setConfirming] = useState(false);
  const disconnect = useDisconnectComposioAccount();
  const connect = useConnectComposioApp();
  const active = account.status === "ACTIVE";

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-paper-moss">{account.label}</span>
        {active ? null : <span className="block text-[13px] text-paper-sage">{account.statusReason ?? "This sign-in no longer works."}</span>}
      </span>
      {active ? null : <Tag tone="flame">{account.status === "EXPIRED" ? "Expired" : "Inactive"}</Tag>}
      {confirming ? (
        <span className="flex basis-full flex-wrap items-center gap-2" role="group" aria-label={`Confirm disconnecting ${account.label}`}>
          <span className="basis-full text-[13px] text-paper-char">Disconnect this {appName} account? You'd need to sign in again.</span>
          <PaperButton variant="danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate(account.id, { onSettled: () => setConfirming(false) })}>
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </PaperButton>
          <PaperButton variant="quiet" onClick={() => setConfirming(false)}>
            Cancel
          </PaperButton>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          {active ? null : (
            <PaperButton variant="ghost" disabled={connect.isPending} onClick={() => connect.mutate({ toolkit })}>
              {connect.isPending ? "Opening…" : "Sign in again"}
            </PaperButton>
          )}
          <PaperButton variant="quiet" aria-label={`Disconnect ${account.label}`} onClick={() => setConfirming(true)}>
            Disconnect
          </PaperButton>
        </span>
      )}
      <SignInNote toolkit={toolkit} connect={connect} />
      {disconnect.isError ? (
        <p role="alert" className="basis-full text-[13px] text-paper-flame-deep">
          {disconnect.error.message}
        </p>
      ) : null}
    </li>
  );
}

function AddAccount({ app }: { app: ComposioApp }) {
  const [label, setLabel] = useState("");
  const connect = useConnectComposioApp();
  const fieldId = useId();

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        connect.mutate({ toolkit: app.slug, label: label.trim() || undefined }, { onSuccess: () => setLabel("") });
      }}
    >
      <label htmlFor={fieldId} className="min-w-[12rem] flex-1">
        <FieldLabel>Add another account</FieldLabel>
        <input id={fieldId} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} placeholder="A name for it, like Work" className={cn(PAPER_INPUT, "w-full", PAPER_FOCUS)} />
      </label>
      <PaperButton type="submit" variant="ghost" disabled={connect.isPending}>
        {connect.isPending ? "Opening…" : "Connect"}
      </PaperButton>
      <SignInNote toolkit={app.slug} connect={connect} />
    </form>
  );
}

function PolicyRow({ app, actionClass, label, hint }: { app: ComposioApp; actionClass: ComposioActionClass; label: string; hint: string }) {
  const update = useUpdateComposioApp();
  const value = app.policies[actionClass];
  const overridden = app.overridden.includes(actionClass);
  const set = (policy: CapabilityPolicy | null) => update.mutate({ slug: app.slug, patch: { policies: { [actionClass]: policy } } });

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-[12rem] flex-1">
        <p className="text-[14px] font-medium text-paper-moss">{label}</p>
        <p className="text-[13px] leading-5 text-paper-sage">{overridden ? `${hint} Set for this app.` : hint}</p>
        {update.isError ? (
          <p role="alert" className="text-[13px] text-paper-flame-deep">
            {update.error.message}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {overridden ? (
          <PaperButton variant="quiet" disabled={update.isPending} onClick={() => set(null)} title="Follow the default in Composio settings" aria-label={`Reset ${label} for ${app.name}`}>
            Reset
          </PaperButton>
        ) : null}
        <SegmentedControl
          label={`${label} in ${app.name}`}
          options={POLICY_OPTIONS}
          value={value}
          onChange={(policy) => {
            if (policy !== value) set(policy);
          }}
        />
      </div>
    </li>
  );
}

/** Long enough that typing a word sends one search, not one per letter. */
const SEARCH_DEBOUNCE_MS = 300;

function AppCatalog({ connected }: { connected: ReadonlySet<string> }) {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const searchId = useId();
  const categoryId = useId();

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const categories = useComposioCategories(true);
  const catalog = useComposioToolkits({ search, category, enabled: true });
  const connect = useConnectComposioApp();
  const toolkits = useMemo(() => catalog.data?.pages.flatMap((page) => page.items) ?? [], [catalog.data]);
  const total = catalog.data?.pages[0]?.total;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={searchId} className="min-w-[14rem] flex-1">
          <FieldLabel>Find an app</FieldLabel>
          <span className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" aria-hidden="true" />
            <input
              id={searchId}
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Notion, HubSpot, Stripe…"
              autoComplete="off"
              className={cn(PAPER_INPUT, "w-full pl-9", PAPER_FOCUS)}
            />
          </span>
        </label>
        <label htmlFor={categoryId} className="w-full sm:w-56">
          <FieldLabel>Category</FieldLabel>
          <select id={categoryId} value={category} onChange={(event) => setCategory(event.target.value)} className={cn(PAPER_INPUT, "w-full", PAPER_FOCUS)}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-3 text-[13px] text-paper-sage tabular-nums" aria-live="polite">
        {catalog.isFetching && !catalog.isFetchingNextPage ? "Searching…" : total !== undefined ? `${total.toLocaleString("en-ZA")} ${total === 1 ? "app" : "apps"}` : " "}
      </p>

      {catalog.isError && toolkits.length === 0 ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-3">
          <p className="max-w-[72ch] text-[14px] leading-6 text-paper-char">{catalog.error.message}</p>
          <PaperButton variant="ghost" onClick={() => void catalog.refetch()}>
            Try again
          </PaperButton>
        </div>
      ) : !catalog.isPending && toolkits.length === 0 ? (
        <p className="mt-2 text-[14px] text-paper-sage">{search ? `Nothing matches “${search}”.` : "No apps in this category."}</p>
      ) : toolkits.length > 0 ? (
        <ul className="mt-2 divide-y divide-paper-stone rounded-md border border-paper-mist">
          {toolkits.map((toolkit) => (
            <CatalogRow key={toolkit.slug} toolkit={toolkit} connected={connected.has(toolkit.slug)} connect={connect} />
          ))}
        </ul>
      ) : null}

      {catalog.hasNextPage ? (
        <PaperButton variant="ghost" className="mt-3" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>
          {catalog.isFetchingNextPage ? "Loading…" : "Show more"}
        </PaperButton>
      ) : null}
    </div>
  );
}

function CatalogRow({ toolkit, connected, connect }: { toolkit: ComposioToolkit; connected: boolean; connect: ReturnType<typeof useConnectComposioApp> }) {
  const starting = connect.isPending && connect.variables?.toolkit === toolkit.slug;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap has-[[role=alert],[role=status]]:flex-wrap">
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-4">
        <AppLogo logo={toolkit.logo} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-paper-moss">{toolkit.name}</p>
          <p className="truncate text-[13px] text-paper-sage">{toolkit.description ?? "No description."}</p>
        </div>
      </div>
      {toolkit.toolsCount ? <span className="hidden shrink-0 text-[13px] text-paper-sage tabular-nums md:inline">{toolkit.toolsCount} actions</span> : null}
      {connected ? (
        <Tag tone="green" className="whitespace-nowrap">Connected</Tag>
      ) : toolkit.noAuth ? (
        <Tag tone="muted" className="whitespace-nowrap">No sign-in needed</Tag>
      ) : (
        <PaperButton variant="ghost" disabled={connect.isPending} aria-label={`Connect ${toolkit.name}`} onClick={() => connect.mutate({ toolkit: toolkit.slug })}>
          {starting ? "Opening…" : "Connect"}
        </PaperButton>
      )}
      <SignInNote toolkit={toolkit.slug} connect={connect} />
    </li>
  );
}
