import "@/styles/mail.css";
import { useMemo, useRef, useState } from "react";
import { MAIL_THREAD_LIMIT, type MailClassifier } from "@shared/mail-types";
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
 * Inbox: what arrived. Today that is Gmail, read-only.
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

export function MailPage() {
  const navigationItems = useNavigationItems();
  const status = useMailStatus();
  const mail = useMail();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();

  const configured = status.data?.configured ?? false;
  const connected = status.data?.connected ?? false;

  const [filter, setFilter] = useState<MailStatusFilter>("all");
  const [page, setPage] = useState(1);
  const listTop = useRef<HTMLDivElement>(null);

  const sorted = status.data?.classifier === "jev";
  const canModify = status.data?.canModify ?? false;

  const allRows = useMemo(() => (mail.data ? flattenMail(mail.data) : []), [mail.data]);
  const triage = useMailTriage(canModify);

  const rows = useMemo(() => allRows.filter((row) => !triage.gone.has(row.thread.threadId)), [allRows, triage.gone]);
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
                  ? `${totalThreads} thread${totalThreads === 1 ? "" : "s"}${
                      totalThreads >= MAIL_THREAD_LIMIT ? ` (latest ${MAIL_THREAD_LIMIT})` : ""
                    }`
                  : "-"}
                {status.data?.lastSyncedAt
                  ? ` · last synced ${new Date(status.data.lastSyncedAt).toLocaleString()}`
                  : ""}
                {connected ? ` · ${CLASSIFIER_LABEL[status.data?.classifier ?? "manual"]}` : ""}
              </div>
            </div>
            {connected ? (
              <div className="mail-toolbar-actions">
                <button
                  type="button"
                  className="mail-btn-amber"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                >
                  {sync.isPending ? "Refreshing…" : "Refresh"}
                </button>
                <button type="button" className="mail-btn-ghost" onClick={() => disconnect.mutate()}>
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>

          <div className="mail-content" ref={listTop}>
            {status.isPending ? (
              <p className="mail-meta">Checking Mail configuration…</p>
            ) : !configured ? (
              <MailEmptyState
                title="The inbox is not connected yet"
                description="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the server. A classifier such as Jev (JEV_API_KEY) is optional. Without one, threads are listed unsorted."
              />
            ) : !connected ? (
              <MailEmptyState
                title="Gmail is not connected"
                description="Connect a Gmail account to start triaging your inbox. Access is read-only: AgentOS never sends, labels, or deletes anything."
                action={{ label: "Connect Gmail", href: mailConnectUrl() }}
              />
            ) : mail.isPending ? (
              <p className="mail-meta">Reading stored mail…</p>
            ) : !mail.data || totalThreads === 0 ? (
              <MailEmptyState
                title="No mail synced yet"
                description={
                  status.data?.classifier === "jev"
                    ? `Click Refresh to fetch and sort your ${MAIL_THREAD_LIMIT} most recent inbox threads.`
                    : `Click Refresh to fetch your ${MAIL_THREAD_LIMIT} most recent inbox threads. No classifier is active, so they will be listed unsorted.`
                }
              />
            ) : (
              <>
                {!canModify ? (
                  <div className="mail-notice">
                    <span>
                      AgentOS has read-only access to this Gmail account. Reconnect once to mark mail read and move it
                      to Trash. It still can't send or permanently delete anything.
                    </span>
                    <a className="mail-btn-ghost" href={mailConnectUrl()}>
                      Reconnect Gmail
                    </a>
                  </div>
                ) : null}
                <div className="mail-controls">
                  {sorted ? <MailFilters value={filter} counts={counts} onChange={changeFilter} /> : <span />}
                  <MailBulkBar
                    key={filter}
                    threadIds={filteredIds}
                    unreadIds={unreadIds}
                    scopeLabel={FILTER_LABEL[filter]}
                    canModify={canModify}
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
                      canModify={canModify}
                      canReprofile={sorted}
                      actions={triage.actions}
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
    </AppShell>
  );
}
