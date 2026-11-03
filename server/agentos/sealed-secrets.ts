import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "./session-store";

/**
 * Secrets kept on this machine, sealed with AES-256-GCM. Each kind has its own
 * 32-byte key in its own file next to the settings, both mode 0600. That keeps
 * a secret out of a stray copy of a settings file or database, a backup that
 * skips the key, or a screen share; it does not stop someone who can already
 * read every file in the account, which no key on the same disk can.
 */

export interface SealedSecret {
  iv: string;
  tag: string;
  data: string;
}

export async function writePrivate(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600);
}

/** The key in `~/.agentos-ui/<file>`, made on first use when `create` is set. */
export async function sealingKey(file: string, create: boolean): Promise<Buffer | undefined> {
  const target = path.join(uiStateDir(), file);
  try {
    const key = Buffer.from((await fs.readFile(target, "utf8")).trim(), "base64");
    if (key.length === 32) return key;
  } catch {
    // Not created yet.
  }
  if (!create) return undefined;
  const key = crypto.randomBytes(32);
  await writePrivate(target, `${key.toString("base64")}\n`);
  return key;
}

export function sealSecret(value: string, key: Buffer): SealedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function openSecret(sealed: SealedSecret, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
}
