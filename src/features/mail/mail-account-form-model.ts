import { DEFAULT_MAIL_PROVIDER, MAIL_PRESETS, MAIL_PROVIDER_LABEL, type MailProviderId } from "@shared/mail-account-types";
import type { MailConnectInput } from "@/lib/agentos/client";

/** The provider choices in the connect form, in the order shown. GoDaddy first: virtara.co.za is on it. */
export const PROVIDER_OPTIONS: readonly { id: MailProviderId; label: string }[] = (["godaddy", "titan", "hostinger", "custom"] as const).map((id) => ({
  id,
  label: MAIL_PROVIDER_LABEL[id],
}));

export const INITIAL_PROVIDER: MailProviderId = DEFAULT_MAIL_PROVIDER;

export interface ServerFields {
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
}

/** The servers a provider shows in the form. Custom starts empty: nothing is pre-filled from another provider. */
export function serverFieldsFor(provider: MailProviderId): ServerFields {
  if (provider === "custom") return { imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" };
  const preset = MAIL_PRESETS[provider];
  return { imapHost: preset.imapHost, imapPort: String(preset.imapPort), smtpHost: preset.smtpHost, smtpPort: String(preset.smtpPort) };
}

export interface ConnectFormState {
  address: string;
  password: string;
  senderName: string;
  provider: MailProviderId;
  servers: ServerFields;
  confirmServers: boolean;
}

/**
 * The request the form sends. A preset sends only its id, so the server fills
 * in that preset's servers and nobody can mix them; Custom sends all four.
 */
export function connectRequestFrom(form: ConnectFormState): MailConnectInput {
  const base = {
    address: form.address.trim(),
    password: form.password,
    ...(form.senderName.trim() ? { senderName: form.senderName.trim() } : {}),
  };
  if (form.provider !== "custom") return { ...base, provider: form.provider };
  return {
    ...base,
    provider: "custom",
    imapHost: form.servers.imapHost.trim(),
    imapPort: Number(form.servers.imapPort),
    smtpHost: form.servers.smtpHost.trim(),
    smtpPort: Number(form.servers.smtpPort),
    confirmServers: form.confirmServers,
  };
}

/** A key for "the inputs that were tested", so Link is only offered for exactly what passed. */
export function testedKey(form: ConnectFormState): string {
  return JSON.stringify(connectRequestFrom(form));
}
