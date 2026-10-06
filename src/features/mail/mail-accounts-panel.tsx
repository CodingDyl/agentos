import { useId, useState, type FormEvent } from "react";
import type { MailAccountSummary } from "@shared/mail-account-types";
import { useLinkTitanMailbox, useUnlinkTitanMailbox } from "@/lib/agentos/queries";
import { mailConnectUrl } from "@/lib/agentos/client";

interface MailAccountsPanelProps {
  accounts: readonly MailAccountSummary[];
  onClose: () => void;
  onNotice: (message: string) => void;
}

/**
 * The mailboxes the Inbox reads. Gmail connects through Google; the Virtara
 * mailbox (Titan) with its address and password, which the server checks
 * with Titan before sealing it on this computer. The password field is
 * cleared as soon as it has been sent, and nothing ever shows it again.
 */
export function MailAccountsPanel({ accounts, onClose, onNotice }: MailAccountsPanelProps) {
  const id = useId();
  const link = useLinkTitanMailbox();
  const unlink = useUnlinkTitanMailbox();
  const gmail = accounts.find((account) => account.id === "gmail");
  const titan = accounts.find((account) => account.id === "titan");

  const [address, setAddress] = useState("dylanpetzer@virtara.co.za");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [imapHost, setImapHost] = useState("imap.titan.email");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const sent = password;
    setPassword("");
    link.mutate(
      { address, password: sent, ...(showServer ? { imapHost } : {}) },
      { onSuccess: () => onNotice(`The Virtara mailbox (${address.trim().toLowerCase()}) is linked. Press Refresh to read it.`) },
    );
  };

  const disconnectTitan = () => {
    if (!window.confirm("Unlink the Virtara mailbox? AgentOS forgets its password. Your mail stays in Titan.")) return;
    unlink.mutate(undefined, { onSuccess: () => onNotice("The Virtara mailbox is unlinked.") });
  };

  return (
    <section className="mail-accounts" aria-labelledby={`${id}-title`}>
      <div className="mail-accounts-head">
        <h2 id={`${id}-title`} className="mail-accounts-title">
          Mail accounts
        </h2>
        <button type="button" className="mail-link-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mail-account">
        <div>
          <div className="mail-account-name">Gmail</div>
          <div className="mail-account-detail">{gmail?.connected ? "Connected" : "Not connected"}</div>
        </div>
        {gmail?.connected ? null : (
          <a className="mail-btn-ghost" href={mailConnectUrl()}>
            Connect Gmail
          </a>
        )}
      </div>

      <div className="mail-account">
        <div>
          <div className="mail-account-name">Virtara (Titan)</div>
          <div className="mail-account-detail">
            {titan?.connected ? `${titan.address ?? ""} · ${titan.server ?? ""}` : "Not linked"}
          </div>
        </div>
        {titan?.connected ? (
          <button type="button" className="mail-btn-ghost" onClick={disconnectTitan} disabled={unlink.isPending}>
            {unlink.isPending ? "Unlinking…" : "Unlink"}
          </button>
        ) : null}
      </div>

      {titan?.connected ? null : (
        <form className="mail-account-form" onSubmit={submit} aria-label="Link the Virtara mailbox">
          <div className="mail-composer-row">
            <label htmlFor={`${id}-address`}>Email</label>
            <input
              id={`${id}-address`}
              type="email"
              autoComplete="username"
              required
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className="mail-composer-row">
            <label htmlFor={`${id}-password`}>Password</label>
            <input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {showServer ? (
            <div className="mail-composer-row">
              <label htmlFor={`${id}-server`}>Server</label>
              <input id={`${id}-server`} type="text" required value={imapHost} onChange={(event) => setImapHost(event.target.value)} />
            </div>
          ) : null}
          <p className="mail-account-help">
            The password you sign in to the Titan app with. AgentOS checks it with Titan first, then keeps it
            encrypted on this computer only. It is only ever sent to Titan&apos;s own servers.
            {showServer ? null : (
              <>
                {" "}
                <button type="button" className="mail-link-btn" onClick={() => setShowServer(true)}>
                  Change server
                </button>
              </>
            )}
          </p>
          {link.error ? (
            <p className="mail-action-error" role="alert">
              {link.error instanceof Error ? link.error.message : "Could not link the mailbox."}
            </p>
          ) : null}
          <div className="mail-account-actions">
            <button type="submit" className="mail-btn-amber" disabled={link.isPending || !password || !address.trim()}>
              {link.isPending ? "Checking with Titan…" : "Link mailbox"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
