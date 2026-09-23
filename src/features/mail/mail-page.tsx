import "@/styles/mail.css";
import { AppShell } from "@/components/os";
import { mailConnectUrl } from "@/lib/agentos/client";
import { useNavigationItems } from "@/config/use-navigation";
import { useDisconnectMail, useMail, useMailStatus, useSyncMail } from "@/lib/agentos/queries";
import { BucketSection } from "./bucket-section";
import { MailEmptyState } from "./mail-empty-state";

/**
 * Mail: Gmail, read-only, classified by Jev into Needs you / FYI / Low
 * priority. Opening this page never calls Gmail or Jev — only Refresh does.
 */
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
    <AppShell navigationItems={navigationItems} pageId="mail" activeHref="/mail">
      <div className="mail-stage">
        <div className="mail-window">
          <div className="mail-titlebar">
            <div className="mail-titlebar-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="mail-titlebar-filename">mail.inbox</div>
          </div>

          <div className="mail-toolbar">
            <div>
              <h1 className="mail-title">Mail</h1>
              <div className="mail-meta">
                {mail.data ? `${totalThreads} thread${totalThreads === 1 ? "" : "s"}` : "—"}
                {status.data?.lastSyncedAt
                  ? ` · last synced ${new Date(status.data.lastSyncedAt).toLocaleString()}`
                  : ""}
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
                title="Mail is not configured"
                description="Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and JEV_API_KEY to .env, then restart the server."
              />
            ) : !connected ? (
              <MailEmptyState
                title="Gmail is not connected"
                description="Connect a Gmail account to start triaging your inbox. Access is read-only — AgentOS never sends, labels, or deletes anything."
                action={{ label: "Connect Gmail", href: mailConnectUrl() }}
              />
            ) : mail.isPending ? (
              <p className="mail-meta">Reading stored mail…</p>
            ) : !mail.data || totalThreads === 0 ? (
              <MailEmptyState
                title="No mail synced yet"
                description="Click Refresh to fetch and classify your most recent inbox threads."
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
