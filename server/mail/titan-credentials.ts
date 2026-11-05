import fs from "node:fs/promises";
import path from "node:path";
import { MAIL_PRESETS, MailProviderIdSchema, mailServersProblem, type MailConnectRequest, type MailProviderId } from "../../shared/mail-account-types";
import { uiStateDir } from "../agentos/session-store";
import { openSecret, sealSecret, sealingKey, writePrivate, type SealedSecret } from "../agentos/sealed-secrets";

export { openSecret, sealSecret };

/**
 * The Virtara mailbox login (GoDaddy, Titan, Hostinger or custom servers),
 * kept on this machine only. The file keeps its old name so existing links
 * keep working.
 *
 * The password is sealed with AES-256-GCM before it touches disk. The key is
 * 32 random bytes in its own file next to it, both mode 0600. Honest about
 * what that buys: it keeps the password out of a stray copy of the settings
 * file, a backup that skips the key, or a screen share of the JSON. It does
 * not stop someone who can already read every file in your account, which no
 * key stored on the same disk can.
 *
 * The password is never logged, never returned by a route, and only ever
 * sent to the mailbox's own IMAP and SMTP servers over TLS.
 */

export interface TitanCredentials {
  address: string;
  /** Shown to recipients next to the address. Absent: the bare address. */
  senderName?: string;
  password: string;
  /** Which preset the servers came from, or `custom`. */
  provider: MailProviderId;
  /** Custom only: the person confirmed both hosts belong to one provider. */
  confirmServers?: true;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /**
   * `LOGIN` when Titan refused SASL (AUTHENTICATE PLAIN) for this mailbox but
   * took the plain IMAP LOGIN command, found when the mailbox was linked.
   * Absent: IMAPFlow picks from what the server advertises.
   */
  imapLoginMethod?: "LOGIN";
}


interface StoredTitanAccount extends Omit<TitanCredentials, "password" | "provider"> {
  /** Absent in links saved before providers existed: see `migrateStored`. */
  provider?: MailProviderId;
  password: SealedSecret;
  linkedAt: string;
}

export type TitanAccount = Omit<TitanCredentials, "password"> & {
  /** Why the stored servers are refused. While set, the password is never opened, so nothing connects. */
  problem?: string;
};

export class TitanCredentialsError extends Error {}

function accountFile(): string {
  return path.join(uiStateDir(), "titan-mail.json");
}

async function secretKey(create: boolean): Promise<Buffer | undefined> {
  return sealingKey("mail-secret.key", create);
}

async function readStored(): Promise<StoredTitanAccount | undefined> {
  let stored: StoredTitanAccount;
  try {
    stored = JSON.parse(await fs.readFile(accountFile(), "utf8")) as StoredTitanAccount;
  } catch {
    return undefined;
  }
  const migrated = migrateStored(stored);
  if (migrated !== stored) await writePrivate(accountFile(), `${JSON.stringify(migrated, null, 2)}\n`);
  return migrated;
}

/**
 * Links saved before providers existed had no `provider`. One on Titan's own
 * servers becomes the Titan preset, unchanged otherwise. Anything else is
 * left without a provider, which the guard refuses until it is linked again:
 * that includes the unsafe case of a GoDaddy IMAP host saved with Titan's
 * SMTP default.
 */
export function migrateStored(stored: StoredTitanAccount): StoredTitanAccount {
  if (stored.provider !== undefined) return stored;
  const titan = MAIL_PRESETS.titan;
  const onTitan =
    stored.imapHost === titan.imapHost && stored.imapPort === titan.imapPort && stored.smtpHost === titan.smtpHost && stored.smtpPort === titan.smtpPort;
  return onTitan ? { ...stored, provider: "titan" } : stored;
}

/** Why these stored servers may not be used, or undefined when they may. */
function storedProblem(stored: StoredTitanAccount): string | undefined {
  const provider = MailProviderIdSchema.safeParse(stored.provider);
  if (!provider.success) return "This mailbox was linked before AgentOS knew its provider, and its servers don't match one. Unlink it and link it again.";
  const problem = mailServersProblem(provider.data, stored, stored.confirmServers === true);
  return problem ? `${problem} Unlink the mailbox and link it again.` : undefined;
}

/** The linked mailbox without its password, for showing on the page. */
export async function titanAccount(): Promise<TitanAccount | undefined> {
  const stored = await readStored();
  if (!stored) return undefined;
  const problem = storedProblem(stored);
  return {
    address: stored.address,
    provider: stored.provider ?? "custom",
    ...(stored.confirmServers ? { confirmServers: true as const } : {}),
    ...(stored.senderName ? { senderName: stored.senderName } : {}),
    imapHost: stored.imapHost,
    imapPort: stored.imapPort,
    smtpHost: stored.smtpHost,
    smtpPort: stored.smtpPort,
    ...(stored.imapLoginMethod ? { imapLoginMethod: stored.imapLoginMethod } : {}),
    ...(problem ? { problem } : {}),
  };
}

/**
 * The full login, password included. Only the IMAP and SMTP clients call
 * this. Refuses, without opening the password, when the stored servers fail
 * the guard: so no consumer (Inbox, compose, Outreach, the reply watch) can
 * send it to a server it doesn't belong to.
 */
export async function readTitanCredentials(): Promise<TitanCredentials | undefined> {
  const stored = await readStored();
  if (!stored) return undefined;
  const problem = storedProblem(stored);
  if (problem) throw new TitanCredentialsError(problem);
  const key = await secretKey(false);
  if (!key) throw new TitanCredentialsError("The Virtara mailbox key is missing. Link the mailbox again.");
  try {
    const visible = await titanAccount();
    if (!visible) return undefined;
    const credentials: TitanCredentials = { ...visible, password: openSecret(stored.password, key) };
    delete (credentials as TitanAccount).problem;
    return credentials;
  } catch {
    throw new TitanCredentialsError("The Virtara mailbox password could not be unlocked. Link the mailbox again.");
  }
}

export async function saveTitanCredentials(input: MailConnectRequest, imapLoginMethod?: "LOGIN"): Promise<void> {
  const problem = mailServersProblem(input.provider, input, input.confirmServers === true);
  if (problem) throw new TitanCredentialsError(problem);
  const key = await secretKey(true);
  if (!key) throw new TitanCredentialsError("Could not create the mailbox key.");
  const stored: StoredTitanAccount = {
    address: input.address,
    ...(input.senderName ? { senderName: input.senderName } : {}),
    provider: input.provider,
    ...(input.confirmServers ? { confirmServers: true as const } : {}),
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    ...(imapLoginMethod ? { imapLoginMethod } : {}),
    password: sealSecret(input.password, key),
    linkedAt: new Date().toISOString(),
  };
  await writePrivate(accountFile(), `${JSON.stringify(stored, null, 2)}\n`);
}

/** Sets or clears the sender name, keeping the sealed password as it is. */
export async function updateTitanSenderName(senderName: string): Promise<void> {
  const stored = await readStored();
  if (!stored) throw new TitanCredentialsError("The Virtara mailbox is not linked.");
  const next: StoredTitanAccount = { ...stored, senderName: senderName || undefined };
  await writePrivate(accountFile(), `${JSON.stringify(next, null, 2)}\n`);
}

export async function forgetTitanCredentials(): Promise<void> {
  await fs.rm(accountFile(), { force: true });
}
