/**
 * Which client a mail thread is from.
 *
 * Mail stores only the sender, so matching is on that: an exact address
 * match first, then the same company domain. A personal-mail domain never
 * matches by domain — two strangers on gmail.com are not the same client.
 */

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mweb.co.za",
  "telkomsa.net",
  "webmail.co.za",
  "vodamail.co.za",
]);

export interface MailMatchable {
  id: string;
  email?: string;
}

function parts(email: string | undefined): { address: string; domain: string } | undefined {
  const address = email?.trim().toLowerCase();
  const at = address?.lastIndexOf("@") ?? -1;
  if (!address || at < 1 || at === address.length - 1) return undefined;
  return { address, domain: address.slice(at + 1) };
}

/** Builds a lookup once, so matching a whole inbox is linear. */
export function clientMailMatcher<T extends MailMatchable>(clients: readonly T[]): (fromEmail: string | undefined) => T | undefined {
  const byAddress = new Map<string, T>();
  const byDomain = new Map<string, T | null>();

  for (const client of clients) {
    const own = parts(client.email);
    if (!own) continue;
    if (!byAddress.has(own.address)) byAddress.set(own.address, client);
    if (PERSONAL_DOMAINS.has(own.domain)) continue;
    // Two clients on one domain is ambiguous: match neither by domain.
    byDomain.set(own.domain, byDomain.has(own.domain) && byDomain.get(own.domain)?.id !== client.id ? null : client);
  }

  return (fromEmail) => {
    const from = parts(fromEmail);
    if (!from) return undefined;
    return byAddress.get(from.address) ?? byDomain.get(from.domain) ?? undefined;
  };
}
