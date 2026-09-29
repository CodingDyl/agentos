import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetches a public web page on behalf of a person who typed its address.
 *
 * The address is not trusted: it could point at this machine, the local
 * network, or a cloud metadata service. So the connection itself is checked,
 * not just the text of the address: every IP the name resolves to is tested
 * at connect time (which also defeats a name that answers differently a
 * second later), every redirect is re-checked, and the response is capped in
 * size and time. Only http(s) on the ordinary ports, no credentials in the
 * address, and only HTML comes back.
 */

export class SafeFetchError extends Error {}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Whether an IP is one a public website could legitimately sit on. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) {
    const lower = address.toLowerCase();
    // ::ffff:a.b.c.d is an IPv4 address wearing an IPv6 coat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicV4(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex) {
      const high = Number.parseInt(hex[1], 16);
      const low = Number.parseInt(hex[2], 16);
      return isPublicV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // unique local
    if (/^fe[89ab]/.test(lower)) return false; // link local
    if (/^ff/.test(lower)) return false; // multicast
    if (/^(64:ff9b:|100:|2001:db8|2002:)/.test(lower)) return false; // NAT64, discard, docs, 6to4
    return true;
  }
  return false;
}

function isPublicV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false; // multicast and reserved
  return true;
}

/** A DNS lookup that refuses to hand back anything non-public. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      (callback as (error: NodeJS.ErrnoException) => void)(error);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }];
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      (callback as (error: NodeJS.ErrnoException) => void)(new SafeFetchError("That address does not point at a public website."));
      return;
    }
    if (options.all) (callback as (error: null, addresses: dns.LookupAddress[]) => void)(null, list);
    else (callback as (error: null, address: string, family: number) => void)(null, list[0].address, list[0].family);
  });
};

/** The address, if it is one this module will visit. Throws a sentence otherwise. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("That is not a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SafeFetchError("Only http and https addresses can be read.");
  if (url.username || url.password) throw new SafeFetchError("Addresses with a username or password are not read.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SafeFetchError("Only the ordinary web ports are read.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) throw new SafeFetchError("That address does not point at a public website.");
  if (!net.isIP(host) && (host === "localhost" || !host.includes(".") || /\.(local|internal|localhost|lan|home|corp)$/i.test(host))) {
    throw new SafeFetchError("That address does not point at a public website.");
  }
  return url;
}

export interface FetchedPage {
  /** Where the page ended up after redirects. */
  url: string;
  html: string;
}

function once(url: URL): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": "AgentOS-page-reader/1.0", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
        const contentType = String(response.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, contentType, body: Buffer.alloc(0) });
          return;
        }
        if (!/text\/html|application\/xhtml/i.test(contentType)) {
          response.destroy();
          reject(new SafeFetchError("That address did not return a web page."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            response.destroy();
            // Keep what fits: the top of a page holds what matters.
            resolve({ status, location, contentType, body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks) }));
        response.on("error", () => reject(new SafeFetchError("The connection dropped while reading the page.")));
      },
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new SafeFetchError("The website took too long to answer."));
    });
    request.on("error", (error) => reject(error instanceof SafeFetchError ? error : new SafeFetchError("Could not reach that website.")));
    request.end();
  });
}

export async function fetchPage(raw: string): Promise<FetchedPage> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await once(url);
    if (result.status >= 300 && result.status < 400) {
      if (!result.location) throw new SafeFetchError("The website redirected without saying where.");
      url = checkUrl(new URL(result.location, url).toString());
      continue;
    }
    if (result.status < 200 || result.status >= 300) throw new SafeFetchError(`The website answered ${result.status}.`);
    return { url: url.toString(), html: result.body.toString("utf8") };
  }
  throw new SafeFetchError("The website redirected too many times.");
}
