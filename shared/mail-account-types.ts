import { z } from "zod";

/**
 * The mailboxes the Inbox reads. Gmail through Google's API; the Virtara
 * business mailbox (GoDaddy, Titan, Hostinger or a custom host) over IMAP. One merged Inbox, each thread knowing
 * which account it came from.
 */
export const MailAccountIdSchema = z.enum(["gmail", "titan"]);
export type MailAccountId = z.infer<typeof MailAccountIdSchema>;

export const MAIL_ACCOUNT_LABEL: Record<MailAccountId, string> = {
  gmail: "Gmail",
  titan: "Virtara",
};

/**
 * Where the Virtara mailbox is hosted. The account id stays `titan` (stored
 * thread ids and Traction records use it), but the mailbox can live on any of
 * these. Every preset is TLS from the first byte; nothing is sent in the clear.
 */
export const MailProviderIdSchema = z.enum(["godaddy", "titan", "hostinger", "custom"]);
export type MailProviderId = z.infer<typeof MailProviderIdSchema>;
export type MailPresetId = Exclude<MailProviderId, "custom">;

export interface MailServers {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface MailPreset extends MailServers {
  label: string;
  /** Host suffixes that belong to this provider: its IMAP, SMTP and MX servers. */
  hostSuffixes: readonly string[];
}

export const MAIL_PRESETS: Record<MailPresetId, MailPreset> = {
  godaddy: {
    label: "GoDaddy Workspace Email",
    imapHost: "imap.secureserver.net",
    imapPort: 993,
    smtpHost: "smtpout.secureserver.net",
    smtpPort: 465,
    hostSuffixes: ["secureserver.net"],
  },
  titan: {
    label: "Titan",
    imapHost: "imap.titan.email",
    imapPort: 993,
    smtpHost: "smtp.titan.email",
    smtpPort: 465,
    hostSuffixes: ["titan.email"],
  },
  hostinger: {
    label: "Hostinger",
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    hostSuffixes: ["hostinger.com"],
  },
};

export const MAIL_PROVIDER_LABEL: Record<MailProviderId, string> = {
  godaddy: MAIL_PRESETS.godaddy.label,
  titan: MAIL_PRESETS.titan.label,
  hostinger: MAIL_PRESETS.hostinger.label,
  custom: "Custom server",
};

/** The preset the connect form opens on. virtara.co.za is on GoDaddy. */
export const DEFAULT_MAIL_PROVIDER: MailPresetId = "godaddy";

/** Which known provider a host (IMAP, SMTP or MX) belongs to, if any. */
export function providerOfHost(host: string): MailPresetId | undefined {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  for (const id of Object.keys(MAIL_PRESETS) as MailPresetId[]) {
    if (MAIL_PRESETS[id].hostSuffixes.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) return id;
  }
  return undefined;
}

/** Ports AgentOS will use: IMAP over TLS only; SMTP over TLS (465) or STARTTLS that must succeed (587). */
export const IMAP_PORTS = [993] as const;
export const SMTP_PORTS = [465, 587] as const;

const TITAN_PREFIX = "titan:";

/**
 * IMAP has no Gmail-style thread ids, so each Titan message is one Inbox row,
 * named by its mailbox's UIDVALIDITY and its UID. The prefix keeps it from
 * ever colliding with a Gmail thread id, and says where to send any action.
 */
export function titanThreadId(uidValidity: string, uid: number): string {
  return `${TITAN_PREFIX}${uidValidity}:${uid}`;
}

export function parseTitanThreadId(threadId: string): { uidValidity: string; uid: number } | undefined {
  const match = /^titan:(\d{1,20}):(\d{1,10})$/.exec(threadId);
  if (!match) return undefined;
  return { uidValidity: match[1], uid: Number(match[2]) };
}

export function mailAccountOf(threadId: string): MailAccountId {
  return threadId.startsWith(TITAN_PREFIX) ? "titan" : "gmail";
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** The name recipients see next to the address. One line, no angle brackets, so it can't change the From address. */
export const SenderNameSchema = z
  .string()
  .trim()
  .max(100, "Keep the sender name under 100 characters.")
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001F\u007F<>]/.test(value), "The sender name can't contain line breaks or angle brackets.");

/** A mail server name: a real DNS name, never an IP literal, `localhost` or a local-only name. */
export const MailHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HOST, "That is not a server name.")
  .refine((value) => !/^[\d.]+$/.test(value), "Use the server's name, not an IP address.")
  .refine((value) => !/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/.test(value), "That is a local name, not a mail server.");

/**
 * Checks a set of servers against the chosen provider. Returns why it is
 * refused, or undefined when it is fine. The rules:
 * - a preset uses exactly the preset's servers;
 * - SMTP on a known provider needs IMAP on that same provider, always: a
 *   password for one provider is never sent to another's SMTP server;
 * - any other split (unknown or different hosts) is Custom only, and only
 *   with `confirmServers`.
 */
export function mailServersProblem(provider: MailProviderId, servers: MailServers, confirmServers = false): string | undefined {
  if (!(IMAP_PORTS as readonly number[]).includes(servers.imapPort)) return "IMAP must use port 993 (TLS).";
  if (!(SMTP_PORTS as readonly number[]).includes(servers.smtpPort)) return "SMTP must use port 465 (TLS) or 587 (STARTTLS).";
  const imapProvider = providerOfHost(servers.imapHost);
  const smtpProvider = providerOfHost(servers.smtpHost);
  if (smtpProvider && smtpProvider !== imapProvider) {
    return `The SMTP server (${servers.smtpHost}) belongs to ${MAIL_PRESETS[smtpProvider].label}, but the IMAP server does not. AgentOS won't send this mailbox's password there.`;
  }
  if (provider !== "custom") {
    const preset = MAIL_PRESETS[provider];
    const same =
      servers.imapHost === preset.imapHost &&
      servers.imapPort === preset.imapPort &&
      servers.smtpHost === preset.smtpHost &&
      servers.smtpPort === preset.smtpPort;
    return same ? undefined : `Those servers are not ${preset.label}'s. Choose Custom to use other servers.`;
  }
  if (imapProvider && imapProvider === smtpProvider) return undefined;
  if (!confirmServers) return "Confirm that the IMAP and SMTP servers belong to the same mail provider.";
  return undefined;
}

/** What the person types to link (or test) the mailbox. The password is never sent back by any route. */
export const MailConnectRequestSchema = z
  .object({
    address: z.string().trim().toLowerCase().email("Enter the full mailbox address."),
    password: z.string().min(1, "Enter the mailbox password.").max(512),
    senderName: SenderNameSchema.optional(),
    provider: MailProviderIdSchema,
    imapHost: MailHostSchema.optional(),
    imapPort: z.number().int().min(1).max(65535).optional(),
    smtpHost: MailHostSchema.optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    /** Custom only: the person confirms the two hosts belong to one provider. */
    confirmServers: z.boolean().optional(),
  })
  .strict()
  .transform((value, context) => {
    // A preset fills in its own servers; Custom must name all four. Never a
    // fallback to another provider's defaults.
    const base = value.provider === "custom" ? undefined : MAIL_PRESETS[value.provider];
    const servers = {
      imapHost: value.imapHost ?? base?.imapHost,
      imapPort: value.imapPort ?? base?.imapPort,
      smtpHost: value.smtpHost ?? base?.smtpHost,
      smtpPort: value.smtpPort ?? base?.smtpPort,
    };
    if (servers.imapHost === undefined || servers.imapPort === undefined || servers.smtpHost === undefined || servers.smtpPort === undefined) {
      context.addIssue({ code: "custom", message: "Enter the IMAP and SMTP server and port." });
      return z.NEVER;
    }
    const complete: MailServers = { imapHost: servers.imapHost, imapPort: servers.imapPort, smtpHost: servers.smtpHost, smtpPort: servers.smtpPort };
    const problem = mailServersProblem(value.provider, complete, value.confirmServers === true);
    if (problem) {
      context.addIssue({ code: "custom", message: problem });
      return z.NEVER;
    }
    return {
      address: value.address,
      password: value.password,
      ...(value.senderName !== undefined ? { senderName: value.senderName } : {}),
      provider: value.provider,
      ...complete,
      ...(value.provider === "custom" && value.confirmServers ? { confirmServers: true as const } : {}),
    };
  });
export type MailConnectRequest = z.infer<typeof MailConnectRequestSchema>;

/** Looking up where an address's mail is hosted, from its domain's MX record. */
export const MailDetectQuerySchema = z.object({ address: z.string().trim().toLowerCase().email().max(254) });

/** One side of a connection test. `message` is safe to show; it never contains the password. */
export interface MailCheckResult {
  ok: boolean;
  message: string;
}

export interface MailConnectionTest {
  imap: MailCheckResult;
  smtp: MailCheckResult;
}

/** Changes to a linked mailbox that need no new login. An empty name clears it. */
export const TitanUpdateRequestSchema = z.object({ senderName: SenderNameSchema });

/** One linked account as the page sees it: never a password. */
export const MailAccountSummarySchema = z.object({
  id: MailAccountIdSchema,
  label: z.string(),
  connected: z.boolean(),
  address: z.string().optional(),
  server: z.string().optional(),
  smtpServer: z.string().optional(),
  provider: MailProviderIdSchema.optional(),
  providerLabel: z.string().optional(),
  /** Set when the stored servers fail the consistency guard: nothing is sent until it is linked again. */
  problem: z.string().optional(),
  senderName: z.string().optional(),
});
export type MailAccountSummary = z.infer<typeof MailAccountSummarySchema>;
