import dns from "node:dns";
import net from "node:net";
import { MAIL_PRESETS, providerOfHost, type MailConnectionTest, type MailConnectRequest, type MailPresetId } from "../../shared/mail-account-types";
import { NO_MAILBOX_MESSAGE, TitanError, verifyTitanLogin } from "./titan-client";
import type { TitanCredentials } from "./titan-credentials";
import { verifySmtpLogin } from "./titan-smtp";

/**
 * Checking a mailbox login before it is saved: IMAP (log in, open INBOX) and
 * SMTP (EHLO and AUTH only; no message is sent), each reported on its own.
 * Both server names must resolve to public addresses first, so the password
 * can't be pointed at this machine or the local network.
 *
 * Also: where an address's mail is hosted, read from its domain's MX record.
 */

const DNS_TIMEOUT_MS = 4_000;

/** True for loopback, private, link-local, CGNAT, unspecified and multicast addresses. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
  }
  return true;
}

export type LookupAll = (host: string) => Promise<readonly { address: string }[]>;
export type ResolveMx = (domain: string) => Promise<readonly { exchange: string; priority: number }[]>;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const realLookup: LookupAll = (host) => withTimeout(dns.promises.lookup(host, { all: true, verbatim: true }), DNS_TIMEOUT_MS, "DNS lookup timed out");

const realResolveMx: ResolveMx = (domain) => {
  const resolver = new dns.promises.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  return withTimeout(resolver.resolveMx(domain), DNS_TIMEOUT_MS + 500, "MX lookup timed out");
};

/** Refuses a host that doesn't resolve, or resolves to anything private. */
export async function assertPublicMailHost(host: string, lookup: LookupAll = realLookup): Promise<void> {
  let addresses: readonly { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new TitanError(`Could not find the server ${host}. Check the name.`, "offline");
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new TitanError(`${host} points to a private or local address. AgentOS only signs in to public mail servers.`, "failed");
  }
}

export interface MailProviderDetection {
  domain: string;
  provider?: MailPresetId;
  /** The lowest-priority MX host, for showing. */
  mx?: string;
}

/** Where an address's mail goes, from its domain's MX record. Never throws: unknown on any failure or timeout. */
export async function detectMailProvider(address: string, resolveMx: ResolveMx = realResolveMx): Promise<MailProviderDetection> {
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  try {
    const records = [...(await resolveMx(domain))].sort((a, b) => a.priority - b.priority);
    const mx = records[0]?.exchange;
    const provider = records.map((record) => providerOfHost(record.exchange)).find((found) => found !== undefined);
    return { domain, ...(provider ? { provider } : {}), ...(mx ? { mx } : {}) };
  } catch {
    return { domain };
  }
}

export interface ConnectionTestDeps {
  lookup: LookupAll;
  resolveMx: ResolveMx;
  imap: (credentials: TitanCredentials) => Promise<{ imapLoginMethod?: "LOGIN" }>;
  smtp: (credentials: TitanCredentials) => Promise<void>;
}

const realDeps: ConnectionTestDeps = {
  lookup: realLookup,
  resolveMx: realResolveMx,
  imap: verifyTitanLogin,
  smtp: (credentials) => verifySmtpLogin(credentials),
};

export interface ConnectionTestOutcome extends MailConnectionTest {
  /** Both passed: the link may be saved. */
  ok: boolean;
  imapLoginMethod?: "LOGIN";
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof TitanError ? error.message : fallback;
}

/** Adds what the domain's MX record says to a "no mailbox here" failure. */
async function withMxHint(message: string, input: MailConnectRequest, resolveMx: ResolveMx): Promise<string> {
  if (!message.startsWith(NO_MAILBOX_MESSAGE)) return message;
  const found = await detectMailProvider(input.address, resolveMx);
  if (!found.provider || found.provider === input.provider) return message;
  return `${message} ${found.domain}'s mail (MX) is handled by ${MAIL_PRESETS[found.provider].label}: choose that provider.`;
}

/** Tests IMAP and SMTP separately. Nothing is saved, and no email is sent. */
export async function testMailConnection(input: MailConnectRequest, deps: Partial<ConnectionTestDeps> = {}): Promise<ConnectionTestOutcome> {
  const used = { ...realDeps, ...deps };
  const credentials: TitanCredentials = {
    address: input.address,
    password: input.password,
    provider: input.provider,
    ...(input.confirmServers ? { confirmServers: true as const } : {}),
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
  };

  const imapCheck = (async () => {
    await assertPublicMailHost(input.imapHost, used.lookup);
    return used.imap(credentials);
  })();
  const smtpCheck = (async () => {
    await assertPublicMailHost(input.smtpHost, used.lookup);
    await used.smtp(credentials);
  })();
  const [imap, smtp] = await Promise.allSettled([imapCheck, smtpCheck]);

  const imapResult =
    imap.status === "fulfilled"
      ? { ok: true, message: `Signed in to ${input.imapHost} and opened INBOX.` }
      : { ok: false, message: await withMxHint(failureMessage(imap.reason, "The IMAP check failed."), input, used.resolveMx) };
  const smtpResult =
    smtp.status === "fulfilled"
      ? { ok: true, message: `Signed in to ${input.smtpHost} for sending. No email was sent.` }
      : { ok: false, message: await withMxHint(failureMessage(smtp.reason, "The SMTP check failed."), input, used.resolveMx) };

  return {
    ok: imapResult.ok && smtpResult.ok,
    imap: imapResult,
    smtp: smtpResult,
    ...(imap.status === "fulfilled" && imap.value.imapLoginMethod ? { imapLoginMethod: imap.value.imapLoginMethod } : {}),
  };
}
