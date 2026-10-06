import "@/styles/mail.css";
import { useMemo, useRef, useState } from "react";
import { PenSquare } from "lucide-react";
import { MAIL_MAX_AGE_DAYS, MAIL_THREAD_LIMIT, type MailClassifier } from "@shared/mail-types";
import { AppShell } from "@/components/os";
import { mailConnectUrl } from "@/lib/agentos/client";
import { useNavigationItems } from "@/config/use-navigation";
import { useDisconnectMail, useMail, useMailStatus, useSyncMail } from "@/lib/agentos/queries";
import { BucketSection } from "./bucket-section";
import { MailEmptyState } from "./mail-empty-state";
import { MailBulkBar } from "./mail-bulk-bar";
import { MailFilters } from "./mail-filters";
import { MailPager } from "./mail-pager";
import { MailProgressBar } from "./mail-progress";
import { MailComposer, type ComposerTarget } from "./mail-composer";
import { MailOutbox } from "./mail-outbox";
import { MailAccountsPanel } from "./mail-accounts-panel";
import type { ThreadRowActions } from "./thread-row";
import { useMailTriage } from "./use-mail-triage";
import {
  flattenMail,
  matchesStatus,
  paginateMail,
  statusCounts,
  type MailBucketTone,
  type MailStatusFilter,
} from "./mail-model";

/**
 * Inbox: what arrived, in Gmail and the Virtara (Titan) mailbox, merged into one list.
 *
 * Sorting into Needs you / FYI / Low priority is done by whichever classifier
 * is active — Jev when it is configured, otherwise `manual`, which lists every
 * thread unsorted under FYI. The Inbox never requires a classifier, and it is
 * built to take more sources than email later. Opening this page never calls
 * Gmail or a classifier — only Refresh does.
 */
const CLASSIFIER_LABEL: Record<MailClassifier, string> = {
  manual: "unsorted, no classifier active",
  jev: "sorted by Jev",
};

const BUCKET_LABEL: Record<MailBucketTone, string> = {
  needs: "Needs you",
  fyi: "FYI",
  low: "Low priority",
};

const PAGE_SIZE = 25;

const FILTER_LABEL: Record<MailStatusFilter, string> = {
  all: "All mail",
  needs: "Needs you",
  fyi: "FYI",
  low: "Low priority",
  unsorted: "Awaiting Jev",
};

const FILTER_EMPTY: Record<Exclude<MailStatusFilter, "all">, string> = {
  needs: "Nothing needs you right now.",
  fyi: "No FYI threads in the latest mail.",
  low: "No low-priority threads in the latest mail.",
  unsorted: "Jev has sorted everything.",
};

type MailAccountFilter = "all" | "gmail" | "titan";

const ACCOUNT_FILTERS: readonly { value: MailAccountFilter; label: string }[] = [
  { value: "all", label: "All accounts" },
  { value: "gmail", label: "Gmail" },
  { value: "titan", label: "Virtara" },
];

export function MailPage() {
  const navigationItems = useNavigationItems();
  const status = useMailStatus();
  const mail = useMail();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();

  const configured = status.data?.configured ?? false;
  const connected = status.data?.connected ?? false;
  const accounts = status.data?.accounts ?? [];
  const titanLinked = accounts.some((account) => account.id === "titan" && account.connected);
  // Either mailbox makes the Inbox usable: Gmail, or the Virtara mailbox on its own.
  const anyConnected = connected || titanLinked;
  const [accountFilter, setAccountFilter] = useState<MailAccountFilter>("all");
  const [showAccounts, setShowAccounts] = useState(false);

  const [filter, setFilter] = useState<MailStatusFilter>("all");
  const [view, setView] = useState<"inbox" | "outbox">("inbox");
  const [composer, setComposer] = useState<ComposerTarget | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const listTop = useRef<HTMLDivElement>(null);

  const sorted = status.data?.classifier === "jev";
  const canModify = status.data?.canModify ?? false;
  // Virtara mail can always be marked read or moved; Gmail needs its write grant (the server checks each thread).
  const canAct = canModify || titanLinked;

  const allRows = useMemo(() => (mail.data ? flattenMail(mail.data) : []), [mail.data]);
  const triage = useMailTriage(canAct);
  const openComposer = (target: ComposerTarget) => {
    if (composer && !window.confirm("Replace the email you are writing? It has not been sent or saved.")) return;
    setNotice(undefined);
    setComposer(target);
  };

  // `gmail.modify` covers sending; a read-only grant from before it cannot, so rows offer no Reply.
  const rowActions: ThreadRowActions = canModify
    ? {
        ...triage.actions,
        reply: (thread) =>
          openComposer({ kind: "reply", threadId: thread.threadId, to: thread.fromEmail, subject: thread.subject }),
      }
    : triage.actions;

  const rows = useMemo(
    () =>
      allRows.filter(
        (row) => !triage.gone.has(row.thread.threadId) && (accountFilter === "all" || (row.thread.account ?? "gmail") === accountFilter),
      ),
    [allRows, triage.gone, accountFilter],
  );
  const counts = useMemo(() => statusCounts(rows), [rows]);
  const current = paginateMail(rows, filter, page, PAGE_SIZE);
  const totalThreads = rows.length;

  const filteredRows = useMemo(() => rows.filter((row) => matchesStatus(row, filter)), [rows, filter]);
  const filteredIds = useMemo(() => filteredRows.map((row) => row.thread.threadId), [filteredRows]);
  const unreadIds = useMemo(
    () => filteredRows.filter((row) => row.thread.unread).map((row) => row.thread.threadId),
    [filteredRows],
  );

  // Bucket totals under the active filter, so a label reads "FYI 62" even
  // when only part of that bucket is on this page.
  const bucketTotals = useMemo(() => {
    const totals: Record<MailBucketTone, number> = { needs: 0, fyi: 0, low: 0 };
    for (const row of rows) if (matchesStatus(row, filter)) totals[row.tone] += 1;
    return totals;
  }, [rows, filter]);

  const changeAccount = (value: MailAccountFilter) => {
    setAccountFilter(value);
    setPage(1);
  };

  const refresh = () =>
    sync.mutate(undefined, {
      onSuccess: (result) => {
        if (result.warnings?.length) setNotice(`Some mail could not be read. ${result.warnings.join(" ")}`);
      },
    });

  const changeFilter = (value: MailStatusFilter) => {
    setFilter(value);
    setPage(1);
  };

  const changePage = (value: number) => {
    setPage(value);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listTop.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  };

  return (
    <AppShell navigationItems={navigationItems} pageId="mail" activeHref="/inbox">
      <div className="mail-stage">
        <div className="mail-window">
          <div className="mail-toolbar">
            <div>
              <h1 className="mail-title">Inbox</h1>
              <div className="mail-meta">
                {mail.data
                  ? `${totalThreads} thread${totalThreads === 1 ? "" : "s"} from the last ${MAIL_MAX_AGE_DAYS} days${
                      totalThreads >= MAIL_THREAD_LIMIT ? ` (latest ${MAIL_THREAD_LIMIT})` : ""
                    }`
                  : "-"}
                {status.data?.lastSyncedAt
                  ? ` · last synced ${new Date(status.data.lastSyncedAt).toLocaleString()}`
                  : ""}
                {anyConnected ? ` · ${CLASSIFIER_LABEL[status.data?.classifier ?? "manual"]}` : ""}
              </div>
            </div>
            <div className="mail-toolbar-actions">
              <button
                type="button"
                className="mail-btn-ghost"
                aria-expanded={showAccounts}
                onClick={() => setShowAccounts((open) => !open)}
                disabled={status.isPending}
              >
                Accounts
              </button>
              {anyConnected ? (
                <>
                <button
                  type="button"
                  className="mail-btn-amber mail-btn-icon"
                  onClick={() => openComposer({ kind: "new" })}
                  disabled={!canModify}
                  title={canModify ? "Write a new email (sent from Gmail)" : connected ? "Reconnect Gmail to allow sending" : "Connect Gmail to send"}
                >
                  <PenSquare size={15} aria-hidden="true" /> Compose
                </button>
                <button
                  type="button"
                  className="mail-btn-ghost"
                  onClick={refresh}
                  disabled={sync.isPending}
                >
                  {sync.isPending ? "Refreshing…" : "Refresh"}
                </button>
                {connected ? (
                  <button type="button" className="mail-btn-ghost" onClick={() => disconnect.mutate()}>
                    Disconnect Gmail
                  </button>
                ) : null}
                </>
              ) : null}
            </div>
          </div>

          {showAccounts ? (
            <MailAccountsPanel accounts={accounts} onClose={() => setShowAccounts(false)} onNotice={setNotice} />
          ) : null}

          {anyConnected ? (
            <div className="mail-views" role="group" aria-label="Mail view">
              <button
                type="button"
                className={`mail-view${view === "inbox" ? " mail-view--active" : ""}`}
                aria-pressed={view === "inbox"}
                onClick={() => setView("inbox")}
              >
                Inbox
              </button>
              <button
                type="button"
                className={`mail-view${view === "outbox" ? " mail-view--active" : ""}`}
                aria-pressed={view === "outbox"}
                onClick={() => setView("outbox")}
              >
                Sent &amp; drafts
              </button>
            </div>
          ) : null}

          {notice ? (
            <div className="mail-notice mail-notice--quiet" role="status">
              <span>{notice}</span>
              <button type="button" className="mail-link-btn" onClick={() => setNotice(undefined)}>
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="mail-content" ref={listTop}>
            {status.isPending ? (
              <p className="mail-meta">Checking Mail configuration…</p>
            ) : !configured && !titanLinked ? (
              <MailEmptyState
                title="The inbox is not connected yet"
                description="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the server, or link the Virtara mailbox under Accounts. A classifier such as Jev (JEV_API_KEY) is optional. Without one, threads are listed unsorted."
              />
            ) : !anyConnected ? (
              <MailEmptyState
                title="Gmail is not connected"
                description="Connect a Gmail account to triage, reply, and send from AgentOS, or link the Virtara mailbox under Accounts. Email is only sent when you press Send, and nothing is ever permanently deleted."
                action={{ label: "Connect Gmail", href: mailConnectUrl() }}
              />
            ) : view === "outbox" ? (
              <MailOutbox onNotice={setNotice} />
            ) : mail.isPending ? (
              <p className="mail-meta">Reading stored mail…</p>
            ) : !mail.data || totalThreads === 0 ? (
              <MailEmptyState
                title="No mail synced yet"
                description={
                  status.data?.classifier === "jev"
                    ? `Click Refresh to fetch and sort your inbox from the last ${MAIL_MAX_AGE_DAYS} days.`
                    : `Click Refresh to fetch your inbox from the last ${MAIL_MAX_AGE_DAYS} days. No classifier is active, so it will be listed unsorted.`
                }
              />
            ) : (
              <>
                {connected && !canModify ? (
                  <div className="mail-notice">
                    <span>
                      AgentOS has read-only access to this Gmail account. Reconnect once to reply, send, mark mail
                      read, and move it to Trash. It still can't permanently delete anything.
                    </span>
                    <a className="mail-btn-ghost" href={mailConnectUrl()}>
                      Reconnect Gmail
                    </a>
                  </div>
                ) : null}
                {titanLinked ? (
                  <div className="mail-filters mail-account-filter" role="group" aria-label="Filter by account">
                    {ACCOUNT_FILTERS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`mail-filter${accountFilter === option.value ? " mail-filter--active" : ""}`}
                        aria-pressed={accountFilter === option.value}
                        onClick={() => changeAccount(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mail-controls">
                  {sorted ? <MailFilters value={filter} counts={counts} onChange={changeFilter} /> : <span />}
                  <MailBulkBar
                    key={filter}
                    threadIds={filteredIds}
                    unreadIds={unreadIds}
                    scopeLabel={FILTER_LABEL[filter]}
                    canModify={canAct}
                    canReprofile={sorted}
                  />
                </div>
                <MailProgressBar />
                {triage.error ? (
                  <p className="mail-action-error" role="alert">
                    {triage.error}{" "}
                    <button type="button" className="mail-link-btn" onClick={triage.dismissError}>
                      Dismiss
                    </button>
                  </p>
                ) : null}
                {current.total === 0 && filter !== "all" ? (
                  <p className="mail-filter-empty">
                    {FILTER_EMPTY[filter]}{" "}
                    <button type="button" className="mail-link-btn" onClick={() => changeFilter("all")}>
                      Show all mail
                    </button>
                  </p>
                ) : (
                  current.groups.map((group) => (
                    <BucketSection
                      key={`${current.page}-${group.tone}`}
                      label={BUCKET_LABEL[group.tone]}
                      tone={group.tone}
                      rows={group.rows}
                      total={bucketTotals[group.tone]}
                      canModify={canAct}
                      canReprofile={sorted}
                      actions={rowActions}
                    />
                  ))
                )}
                <MailPager
                  page={current.page}
                  pageCount={current.pageCount}
                  firstIndex={current.firstIndex}
                  lastIndex={current.lastIndex}
                  total={current.total}
                  onChange={changePage}
                />
                <p className="mail-shortcuts" aria-label="Keyboard shortcuts">
                  <kbd className="mail-kbd">j</kbd> <kbd className="mail-kbd">k</kbd> move ·{" "}
                  <kbd className="mail-kbd">o</kbd> open · <kbd className="mail-kbd">e</kbd> done ·{" "}
                  <kbd className="mail-kbd">#</kbd> delete · <kbd className="mail-kbd">1</kbd>{" "}
                  <kbd className="mail-kbd">2</kbd> <kbd className="mail-kbd">3</kbd> needs you / FYI / low ·{" "}
                  <kbd className="mail-kbd">u</kbd> read
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      {composer ? (
        <MailComposer
          key={composer.kind === "reply" ? composer.threadId : "new"}
          target={composer}
          onClose={() => setComposer(undefined)}
          onDone={setNotice}
        />
      ) : null}
    </AppShell>
  );
}
