import type { MailSendTag } from "@shared/mail-compose-types";

export const TAG_LABEL: Record<MailSendTag, string> = {
  normal: "Normal",
  business: "Business",
  virtara: "Virtara",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Splits "a@x.com, b@y.com; c@z.com" into addresses. Validation is the server's. */
export function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function replySubjectFor(subject: string): string {
  const clean = subject.trim() || "your message";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}
