import "@/styles/mail.css";
import type { MailClassifier } from "@shared/mail-types";
import { AppShell } from "@/components/os";
import { mailConnectUrl } from "@/lib/agentos/client";
import { useNavigationItems } from "@/config/use-navigation";
import { useDisconnectMail, useMail, useMailStatus, useSyncMail } from "@/lib/agentos/queries";
import { BucketSection } from "./bucket-section";
import { MailEmptyState } from "./mail-empty-state";

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

export function MailPage() {
  const navigationItems = useNavigationItems();
  const status = useMailStatus();
  const mail = useMail();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();

  const configured = status.data?.configured ?? false;
  const connected = status.data?.connected ?? false;

  const totalThreads = mail.data
    ? mail.data.needsYou.length + mail.data.fyi.length + mail.data.lowPriority.length
    : 0;

  return (
    <AppShell navigationItems={navigationItems} pageId="mail" activeHref="/inbox">
      <div className="mail-stage">
        <div className="mail-window">
          <div className="mail-toolbar">
            <div>
              <h1 className="mail-title">Inbox</h1>
              <div className="mail-meta">
                {mail.data ? `${totalThreads} thread${totalThreads === 1 ? "" : "s"}` : "-"}
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

          <div className="mail-content">
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
                    ? "Click Refresh to fetch and sort your most recent inbox threads."
                    : "Click Refresh to fetch your most recent inbox threads. No classifier is active, so they will be listed unsorted."
                }
              />
            ) : (
              <>
                <BucketSection label="Needs you" tone="needs" threads={mail.data.needsYou} />
                <BucketSection label="FYI" tone="fyi" threads={mail.data.fyi} />
                <BucketSection label="Low priority" tone="low" threads={mail.data.lowPriority} />
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
