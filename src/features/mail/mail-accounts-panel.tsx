import { useId, useState, type FormEvent } from "react";
import type { MailAccountSummary, MailProviderId } from "@shared/mail-account-types";
import { useLinkTitanMailbox, useTestTitanMailbox, useUnlinkTitanMailbox, useUpdateTitanSenderName } from "@/lib/agentos/queries";
import { detectMailProvider, mailConnectUrl } from "@/lib/agentos/client";
import { connectRequestFrom, INITIAL_PROVIDER, PROVIDER_OPTIONS, serverFieldsFor, testedKey, type ConnectFormState, type ServerFields } from "./mail-account-form-model";

interface MailAccountsPanelProps {
  accounts: readonly MailAccountSummary[];
  onClose: () => void;
  onNotice: (message: string) => void;
}

/**
 * The mailboxes the Inbox reads. Gmail connects through Google; the Virtara
 * mailbox with its provider, address and password. Test checks IMAP and SMTP
 * separately (no email is sent); Link re-checks both on the server and only
 * then seals the password on this computer. The password field is cleared
 * once the mailbox is linked, and nothing ever shows it again.
 */
export function MailAccountsPanel({ accounts, onClose, onNotice }: MailAccountsPanelProps) {
  const id = useId();
  const link = useLinkTitanMailbox();
  const unlink = useUnlinkTitanMailbox();
  const rename = useUpdateTitanSenderName();
  const gmail = accounts.find((account) => account.id === "gmail");
  const titan = accounts.find((account) => account.id === "titan");

  const [address, setAddress] = useState("dylanpetzer@virtara.co.za");
  const [senderName, setSenderName] = useState("Dylan Petzer");
  // Once linked, the name is edited in place; undefined means "as saved".
  const [editedName, setEditedName] = useState<string | undefined>();
  const savedName = titan?.senderName ?? "";
  const nameDraft = editedName ?? savedName;
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState<MailProviderId>(INITIAL_PROVIDER);
  const [servers, setServers] = useState<ServerFields>(() => serverFieldsFor(INITIAL_PROVIDER));
  const [confirmServers, setConfirmServers] = useState(false);
  const [detected, setDetected] = useState<string | undefined>();
  const test = useTestTitanMailbox();
  const [testedFor, setTestedFor] = useState<string | undefined>();

  const form: ConnectFormState = { address, password, senderName, provider, servers, confirmServers };
  const currentKey = testedKey(form);
  const testIsCurrent = testedFor === currentKey;
  const passed = testIsCurrent && test.data?.ok === true;
  const providerName = PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? "the mail provider";

  const chooseProvider = (next: MailProviderId) => {
    setProvider(next);
    setServers(serverFieldsFor(next));
    setConfirmServers(false);
  };

  const editServer = (field: keyof ServerFields, value: string) => setServers((current) => ({ ...current, [field]: value }));

  /** Looks up the domain's MX record and suggests the matching preset. Only a hint; the choice stays the person's. */
  const detect = () => {
    const value = address.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return;
    detectMailProvider(value)
      .then((found) => {
        if (!found.provider) {
          setDetected(undefined);
          return;
        }
        const label = PROVIDER_OPTIONS.find((option) => option.id === found.provider)?.label ?? found.provider;
        setDetected(found.provider === provider ? undefined : `${found.domain}'s mail is handled by ${label} (MX ${found.mx ?? "record"}).`);
      })
      .catch(() => setDetected(undefined));
  };

  const runTest = () => {
    const key = currentKey;
    test.mutate(connectRequestFrom(form), { onSettled: () => setTestedFor(key) });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!passed) return;
    link.mutate(connectRequestFrom(form), {
      onSuccess: () => {
        setPassword("");
        test.reset();
        onNotice(`The Virtara mailbox (${address.trim().toLowerCase()}) is linked on ${providerName}. Press Refresh to read it.`);
      },
    });
  };

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    const name = nameDraft.trim();
    rename.mutate(name, {
      onSuccess: () => {
        setEditedName(undefined);
        onNotice(name ? `Virtara mail now goes out as ${name}.` : "Virtara mail now goes out from the bare address.");
      },
    });
  };

  const disconnectTitan = () => {
    if (!window.confirm(`Unlink the Virtara mailbox? AgentOS forgets its password. Your mail stays on ${titan?.providerLabel ?? "the mail server"}.`)) return;
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
          <div className="mail-account-name">{titan?.connected && titan.providerLabel ? `Virtara (${titan.providerLabel})` : "Virtara"}</div>
          <div className="mail-account-detail">
            {titan?.connected ? `${titan.address ?? ""} · IMAP ${titan.server ?? ""} · SMTP ${titan.smtpServer ?? ""}` : "Not linked"}
          </div>
          {titan?.problem ? (
            <p className="mail-action-error" role="alert">
              {titan.problem}
            </p>
          ) : null}
        </div>
        {titan?.connected ? (
          <button type="button" className="mail-btn-ghost" onClick={disconnectTitan} disabled={unlink.isPending}>
            {unlink.isPending ? "Unlinking…" : "Unlink"}
          </button>
        ) : null}
      </div>

      {titan?.connected ? (
        <form className="mail-account-form" onSubmit={saveName} aria-label="Virtara sender name">
          <div className="mail-composer-row">
            <label htmlFor={`${id}-sender`}>Name</label>
            <input
              id={`${id}-sender`}
              type="text"
              autoComplete="name"
              maxLength={100}
              placeholder="Shown to recipients, e.g. Dylan Petzer"
              value={nameDraft}
              onChange={(event) => setEditedName(event.target.value)}
            />
          </div>
          <p className="mail-account-help">
            Recipients see{" "}
            <strong>{nameDraft.trim() ? `${nameDraft.trim()} <${titan.address ?? ""}>` : (titan.address ?? "")}</strong>.
          </p>
          {rename.error ? (
            <p className="mail-action-error" role="alert">
              {rename.error instanceof Error ? rename.error.message : "Could not save the name."}
            </p>
          ) : null}
          <div className="mail-account-actions">
            <button type="submit" className="mail-btn-ghost" disabled={rename.isPending || nameDraft.trim() === savedName}>
              {rename.isPending ? "Saving…" : "Save name"}
            </button>
          </div>
        </form>
      ) : (
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
              onBlur={detect}
            />
          </div>
          <div className="mail-composer-row">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              id={`${id}-name`}
              type="text"
              autoComplete="name"
              maxLength={100}
              placeholder="Shown to recipients"
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
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
          <div className="mail-composer-row">
            <label htmlFor={`${id}-provider`}>Host</label>
            <select
              id={`${id}-provider`}
              className="mail-composer-from"
              value={provider}
              onChange={(event) => chooseProvider(event.target.value as MailProviderId)}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {detected ? (
            <p className="mail-account-help" role="status">
              {detected}
            </p>
          ) : null}
          {provider === "custom" ? (
            <fieldset className="mail-account-servers">
              <legend className="mail-account-help">Servers (TLS only: IMAP 993; SMTP 465, or 587 with STARTTLS)</legend>
              <div className="mail-composer-row">
                <label htmlFor={`${id}-imap`}>IMAP</label>
                <input id={`${id}-imap`} type="text" required inputMode="url" placeholder="imap.example.com" value={servers.imapHost} onChange={(event) => editServer("imapHost", event.target.value)} />
                <select aria-label="IMAP port" className="mail-composer-from mail-port" value={servers.imapPort} onChange={(event) => editServer("imapPort", event.target.value)}>
                  <option value="993">993</option>
                </select>
              </div>
              <div className="mail-composer-row">
                <label htmlFor={`${id}-smtp`}>SMTP</label>
                <input id={`${id}-smtp`} type="text" required inputMode="url" placeholder="smtp.example.com" value={servers.smtpHost} onChange={(event) => editServer("smtpHost", event.target.value)} />
                <select aria-label="SMTP port" className="mail-composer-from mail-port" value={servers.smtpPort} onChange={(event) => editServer("smtpPort", event.target.value)}>
                  <option value="465">465</option>
                  <option value="587">587</option>
                </select>
              </div>
              <label className="mail-account-help mail-account-confirm">
                <input type="checkbox" checked={confirmServers} onChange={(event) => setConfirmServers(event.target.checked)} /> Both servers belong to my mail
                provider.
              </label>
            </fieldset>
          ) : (
            <p className="mail-account-detail">
              IMAP {servers.imapHost}:{servers.imapPort} · SMTP {servers.smtpHost}:{servers.smtpPort}
            </p>
          )}
          <p className="mail-account-help">
            The password for this mailbox. AgentOS sends this password only to the mail servers above, over TLS, and keeps it encrypted on this
            computer.
          </p>
          {testIsCurrent && test.data ? (
            <ul className="mail-account-checks" aria-label="Connection test results">
              <li className={test.data.imap.ok ? "mail-account-check-ok" : "mail-action-error"}>
                IMAP: {test.data.imap.ok ? "passed" : "failed"}. {test.data.imap.message}
              </li>
              <li className={test.data.smtp.ok ? "mail-account-check-ok" : "mail-action-error"}>
                SMTP: {test.data.smtp.ok ? "passed" : "failed"}. {test.data.smtp.message}
              </li>
            </ul>
          ) : null}
          {test.error && testIsCurrent ? (
            <p className="mail-action-error" role="alert">
              {test.error instanceof Error ? test.error.message : "Could not test the mailbox."}
            </p>
          ) : null}
          {link.error ? (
            <p className="mail-action-error" role="alert">
              {link.error instanceof Error ? link.error.message : "Could not link the mailbox."}
            </p>
          ) : null}
          <div className="mail-account-actions">
            <button type="button" className="mail-btn-ghost" onClick={runTest} disabled={test.isPending || link.isPending || !password || !address.trim()}>
              {test.isPending ? "Testing…" : "Test connection"}
            </button>
            <button type="submit" className="mail-btn-amber" disabled={!passed || link.isPending}>
              {link.isPending ? "Linking…" : "Link mailbox"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
