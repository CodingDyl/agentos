import nodemailer from "nodemailer";
import { describeTitanError, TitanError } from "./titan-client";
import { readTitanCredentials } from "./titan-credentials";

/**
 * Sending from the Virtara mailbox through Titan's SMTP server.
 *
 * The message is built by `compose-mime.ts` and handed over whole (`raw`),
 * so nodemailer adds nothing and changes nothing. TLS from the first byte on
 * 465; on 587 the connection must upgrade with STARTTLS or nothing is sent.
 * Logging is off: no protocol line, address or password reaches a log.
 */

export interface SmtpEnvelope {
  from: string;
  to: readonly string[];
}

export async function sendTitanRaw(raw: string, envelope: SmtpEnvelope): Promise<void> {
  const credentials = await readTitanCredentials();
  if (!credentials) throw new TitanError("The Virtara mailbox is not linked.", "not-connected");
  const transport = nodemailer.createTransport({
    host: credentials.smtpHost,
    port: credentials.smtpPort,
    secure: credentials.smtpPort === 465,
    requireTLS: true,
    auth: { user: credentials.address, pass: credentials.password },
    logger: false,
    debug: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  });
  try {
    await transport.sendMail({ envelope: { from: envelope.from, to: [...envelope.to] }, raw });
  } catch (error) {
    const value = error as { code?: string; responseCode?: number };
    if (value?.code === "EAUTH" || value?.responseCode === 535) {
      throw new TitanError("Titan refused the login for sending. Unlink and link the Virtara mailbox again with the current password.", "unauthorized");
    }
    if (typeof value?.responseCode === "number" && value.responseCode >= 500) {
      throw new TitanError(`Titan would not send that email (SMTP ${value.responseCode}). Check the recipients.`, "failed");
    }
    throw describeTitanError(error);
  } finally {
    transport.close();
  }
}
