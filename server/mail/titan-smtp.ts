import nodemailer from "nodemailer";
import { MAIL_PROVIDER_LABEL, mailServersProblem, type MailProviderId } from "../../shared/mail-account-types";
import { describeTitanError, linkedCredentials, TitanError } from "./titan-client";
import type { TitanCredentials } from "./titan-credentials";

/**
 * Sending from the Virtara mailbox through its own SMTP server: the one
 * stored with the link (GoDaddy, Titan, Hostinger or custom), never a default.
 *
 * The message is built by `compose-mime.ts` and handed over whole (`raw`),
 * so nodemailer adds nothing and changes nothing. TLS from the first byte on
 * 465; on 587 the connection must upgrade with STARTTLS or nothing is sent.
 * Certificates are always verified. Logging is off: no protocol line,
 * address or password reaches a log.
 */

export interface SmtpEnvelope {
  from: string;
  to: readonly string[];
}

type SmtpLogin = Pick<TitanCredentials, "address" | "password" | "provider" | "smtpHost" | "smtpPort" | "imapHost" | "imapPort"> & { confirmServers?: true };

/** The transport options for a login. Exported for tests: they prove which host the password goes to. */
export function smtpOptions(credentials: SmtpLogin) {
  // Belt and braces: readTitanCredentials already refuses a link that fails
  // the guard, but the SMTP password must never reach another provider.
  const problem = mailServersProblem(credentials.provider, credentials, credentials.confirmServers === true);
  if (problem) throw new TitanError(`${problem} Unlink the mailbox and link it again.`, "not-connected");
  return {
    host: credentials.smtpHost,
    port: credentials.smtpPort,
    secure: credentials.smtpPort === 465,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" as const },
    auth: { user: credentials.address, pass: credentials.password },
    logger: false,
    debug: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  };
}

function providerName(provider: MailProviderId): string {
  return provider === "custom" ? "The mail server" : MAIL_PROVIDER_LABEL[provider];
}

/** Turns nodemailer's errors into one the Inbox can explain. Never includes the password. */
export function describeSmtpError(error: unknown, provider: MailProviderId): TitanError {
  const value = error as { code?: string; responseCode?: number; response?: string } | undefined;
  if (/AccountNotFound/i.test(value?.response ?? "")) return describeTitanError(error, provider);
  if (value?.code === "EAUTH" || value?.responseCode === 535) {
    return new TitanError(`${providerName(provider)} refused the login for sending. Check the password, or unlink and link the Virtara mailbox again.`, "unauthorized");
  }
  if (typeof value?.responseCode === "number" && value.responseCode >= 500) {
    return new TitanError(`${providerName(provider)} would not send that email (SMTP ${value.responseCode}). Check the recipients.`, "failed");
  }
  return describeTitanError(error, provider);
}

export interface SmtpTransportLike {
  sendMail(message: { envelope: { from: string; to: string[] }; raw: string }): Promise<unknown>;
  verify(): Promise<unknown>;
  close(): void;
}

export type SmtpTransportFactory = (options: ReturnType<typeof smtpOptions>) => SmtpTransportLike;

const realTransport: SmtpTransportFactory = (options) => nodemailer.createTransport(options);

export async function sendTitanRaw(raw: string, envelope: SmtpEnvelope, createTransport: SmtpTransportFactory = realTransport): Promise<void> {
  const credentials = await linkedCredentials();
  const transport = createTransport(smtpOptions(credentials));
  try {
    await transport.sendMail({ envelope: { from: envelope.from, to: [...envelope.to] }, raw });
  } catch (error) {
    throw describeSmtpError(error, credentials.provider);
  } finally {
    transport.close();
  }
}

/** Connects, says EHLO and signs in (AUTH). Sends no message. */
export async function verifySmtpLogin(credentials: SmtpLogin, createTransport: SmtpTransportFactory = realTransport): Promise<void> {
  const transport = createTransport(smtpOptions(credentials));
  try {
    await transport.verify();
  } catch (error) {
    throw describeSmtpError(error, credentials.provider);
  } finally {
    transport.close();
  }
}
