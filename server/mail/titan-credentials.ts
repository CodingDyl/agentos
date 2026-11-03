import fs from "node:fs/promises";
import path from "node:path";
import type { TitanConnectRequest } from "../../shared/mail-account-types";
import { uiStateDir } from "../agentos/session-store";
import { openSecret, sealSecret, sealingKey, writePrivate, type SealedSecret } from "../agentos/sealed-secrets";

export { openSecret, sealSecret };

/**
 * The Virtara (Titan) mailbox login, kept on this machine only.
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


interface StoredTitanAccount extends Omit<TitanCredentials, "password"> {
  password: SealedSecret;
  linkedAt: string;
}

export class TitanCredentialsError extends Error {}

function accountFile(): string {
  return path.join(uiStateDir(), "titan-mail.json");
}

async function secretKey(create: boolean): Promise<Buffer | undefined> {
  return sealingKey("mail-secret.key", create);
}

async function readStored(): Promise<StoredTitanAccount | undefined> {
  try {
    return JSON.parse(await fs.readFile(accountFile(), "utf8")) as StoredTitanAccount;
  } catch {
    return undefined;
  }
}

/** The linked mailbox without its password, for showing on the page. */
export async function titanAccount(): Promise<Omit<TitanCredentials, "password"> | undefined> {
  const stored = await readStored();
  if (!stored) return undefined;
  return {
    address: stored.address,
    ...(stored.senderName ? { senderName: stored.senderName } : {}),
    imapHost: stored.imapHost,
    imapPort: stored.imapPort,
    smtpHost: stored.smtpHost,
    smtpPort: stored.smtpPort,
    ...(stored.imapLoginMethod ? { imapLoginMethod: stored.imapLoginMethod } : {}),
  };
}

/** The full login, password included. Only the IMAP and SMTP clients call this. */
export async function readTitanCredentials(): Promise<TitanCredentials | undefined> {
  const stored = await readStored();
  if (!stored) return undefined;
  const key = await secretKey(false);
  if (!key) throw new TitanCredentialsError("The Virtara mailbox key is missing. Link the mailbox again.");
  try {
    const visible = await titanAccount();
    if (!visible) return undefined;
    return { ...visible, password: openSecret(stored.password, key) };
  } catch {
    throw new TitanCredentialsError("The Virtara mailbox password could not be unlocked. Link the mailbox again.");
  }
}

export async function saveTitanCredentials(input: TitanConnectRequest, imapLoginMethod?: "LOGIN"): Promise<void> {
  const key = await secretKey(true);
  if (!key) throw new TitanCredentialsError("Could not create the mailbox key.");
  const stored: StoredTitanAccount = {
    address: input.address,
    ...(input.senderName ? { senderName: input.senderName } : {}),
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
