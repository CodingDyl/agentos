import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getVirtec, isVirtecConfigured, VIRTEC_PATHS, VirtecError, virtecConfigurationProblem } from "../client";
import { normaliseClients, normaliseFollowUps, normaliseInboundLeads, normaliseLeads, normaliseProjects, normaliseQuotes, normaliseRevenue, timestamp } from "../normalise";
import { clearVirtecCache, getVirtecSnapshot } from "../snapshot";

const KEY = "test-key-that-must-never-leak-0123456789";

describe("timestamp", () => {
  it("reads Firestore timestamps over JSON", () => {
    assert.equal(timestamp({ _seconds: 1705314600, _nanoseconds: 500_000_000 }), "2024-01-15T10:30:00.500Z");
    assert.equal(timestamp({ seconds: 1705314600, nanoseconds: 0 }), "2024-01-15T10:30:00.000Z");
  });

  it("reads ISO strings, epoch millis and epoch seconds", () => {
    assert.equal(timestamp("2024-01-15T10:30:00Z"), "2024-01-15T10:30:00.000Z");
    assert.equal(timestamp(1705314600000), "2024-01-15T10:30:00.000Z");
    assert.equal(timestamp(1705314600), "2024-01-15T10:30:00.000Z");
  });

  it("never invents a date", () => {
    assert.equal(timestamp(undefined), undefined);
    assert.equal(timestamp("not a date"), undefined);
    assert.equal(timestamp({ nope: 1 }), undefined);
  });
});

describe("normalise", () => {
  it("reads leads, keeps only what the screen uses, and skips what it cannot read", () => {
    const { items, skipped } = normaliseLeads({
      leads: [
        {
          id: "abc123",
          name: "Example Realty",
          phone: "+27123456789",
          websiteUrl: "https://example.com",
          score: 75,
          scoreReasons: ["Weak website", 3],
          outreachStage: "o1",
          createdAt: { _seconds: 1705314600, _nanoseconds: 0 },
          enrichError: "internal detail",
        },
        { id: "no-name" },
        "garbage",
      ],
    });

    assert.equal(skipped, 2);
    assert.equal(items[0].name, "Example Realty");
    assert.deepEqual(items[0].scoreReasons, ["Weak website"]);
    assert.equal(items[0].createdAt, "2024-01-15T10:30:00.000Z");
    assert.equal("phone" in items[0], false);
    assert.equal("enrichError" in items[0], false);
  });

  it("maps a client's boolean status to active", () => {
    const { items } = normaliseClients({ clients: [{ id: "c1", name: "John", companyName: "Acme", status: false, totalSpent: 45000 }] });
    assert.equal(items[0].active, false);
    assert.equal(items[0].totalSpent, 45000);
  });

  it("never keeps a quote's PDF link", () => {
    const { items } = normaliseQuotes({ quotes: [{ id: "q1", status: "pending", pdfUrl: "https://storage.googleapis.com/secret", totalAmount: 25000 }] });
    assert.equal("pdfUrl" in items[0], false);
  });

  it("preserves legacy quote amounts, dates, and links without exposing either PDF field", () => {
    const { items } = normaliseQuotes({ quotes: [{ id: "old", project_id: "p1", client_id: "c1", project_type: "Website", total_amount: 4500.25, created_at: "2026-03-26T13:01:48.524Z", pdf_url: "SECRET", pdfUrl: "SECRET" }] });
    assert.equal(items[0].totalAmount, 4500.25);
    assert.equal(items[0].createdAt, "2026-03-26T13:01:48.524Z");
    assert.equal(items[0].clientId, "c1");
    assert.equal(items[0].projectId, "p1");
    assert.equal(items[0].projectType, "Website");
    assert.equal(JSON.stringify(items).includes("SECRET"), false);
    const modern = normaliseQuotes([{ id: "new", totalAmount: 0, total_amount: 500 }]).items[0];
    assert.equal(modern.totalAmount, 0);
  });

  it("accepts a bare array as well as the documented envelope", () => {
    assert.equal(normaliseFollowUps([{ id: "f1", status: "open" }]).items.length, 1);
    assert.throws(() => normaliseFollowUps({ nothing: [] }));
  });

  it("reads the revenue summary, ignoring non-numbers", () => {
    const revenue = normaliseRevenue({ monthlyRecurringRevenue: 125000, quoteConversionRate: "68.5" });
    assert.equal(revenue.monthlyRecurringRevenue, 125000);
    assert.equal(revenue.quoteConversionRate, undefined);
  });
});

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("portal views", () => {
  it("reads when the client last opened the portal, and never the share link", () => {
    const { items } = normaliseProjects({ projects: [{ id: "p1", portalToken: "SECRET-SHARE-LINK", portalLastViewedAt: { _seconds: 1790000000, _nanoseconds: 0 } }] });
    assert.equal(items[0].portalLastViewedAt, new Date(1790000000 * 1000).toISOString());
    assert.equal(JSON.stringify(items).includes("SECRET"), false);
  });
});

describe("website leads", () => {
  it("keeps what a reply needs, drops malformed answers, and skips a lead with no name", () => {
    const { items, skipped } = normaliseInboundLeads({
      leads: [
        {
          id: "in1",
          track: "jurivo",
          source: "demo-request",
          status: "new",
          name: "Jane",
          email: "jane@smith.test",
          phone: "082 123 4567",
          details: { practiceArea: "Family", "bad key": "x", nested: { a: 1 }, monthlyLeads: "21-50 leads" },
          createdAt: "2026-09-28T08:00:00.000Z",
          dedupeKey: "internal",
        },
        { id: "in2", email: "no-name@test" },
      ],
    });
    assert.equal(skipped, 1);
    assert.deepEqual(items[0].details, { practiceArea: "Family", monthlyLeads: "21-50 leads" });
    assert.equal(items[0].phone, "082 123 4567");
    assert.equal("dedupeKey" in items[0], false);
  });
});

describe("client", () => {
  beforeEach(() => {
    process.env.VIRTEC_BASE_URL = "https://crm.example.test";
    process.env.VIRTEC_API_KEY = KEY;
    clearVirtecCache();
  });

  afterEach(() => {
    delete process.env.VIRTEC_BASE_URL;
    delete process.env.VIRTEC_API_KEY;
    clearVirtecCache();
  });

  it("sends the key as a bearer token, to the fixed path, and never follows redirects", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetcher = (async (url: URL, init?: RequestInit) => {
      seen = { url: String(url), init };
      return respond(200, { leads: [] });
    }) as unknown as typeof fetch;

    await getVirtec(VIRTEC_PATHS.leads, fetcher);
    assert.equal(seen?.url, "https://crm.example.test/api/agentos/leads?limit=500");
    assert.equal((seen?.init?.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    assert.equal(seen?.init?.redirect, "manual");
  });

  it("explains 401 and 503 without ever mentioning the key", async () => {
    for (const [status, reason] of [
      [401, "unauthorized"],
      [503, "not-configured"],
    ] as const) {
      const fetcher = (async () => respond(status, { error: `bad ${KEY}` })) as unknown as typeof fetch;
      await assert.rejects(getVirtec(VIRTEC_PATHS.clients, fetcher), (error: unknown) => {
        assert.ok(error instanceof VirtecError);
        assert.equal(error.reason, reason);
        assert.equal(error.message.includes(KEY), false);
        return true;
      });
    }
  });

  it("refuses plain http except on this machine", () => {
    process.env.VIRTEC_BASE_URL = "http://crm.example.test";
    assert.equal(isVirtecConfigured(), false);
    assert.match(virtecConfigurationProblem() ?? "", /https/);

    process.env.VIRTEC_BASE_URL = "http://localhost:3000";
    assert.equal(isVirtecConfigured(), true);
  });

  it("settles each endpoint on its own, and caches a good snapshot", async () => {
    let calls = 0;
    const fetcher = (async (url: URL) => {
      calls += 1;
      const path = url.pathname;
      if (path.endsWith("/quotes")) return respond(500, {});
      if (path.endsWith("/revenue-summary")) return respond(200, { monthlyRecurringRevenue: 1000 });
      const key = path.endsWith("/follow-ups") ? "followUps" : (path.split("/").pop() as string);
      return respond(200, { [key]: [{ id: "x1", name: "Acme", status: "open" }] });
    }) as unknown as typeof fetch;

    const snapshot = await getVirtecSnapshot({ fetcher });
    assert.equal(snapshot.sources?.quotes.ok, false);
    assert.equal(snapshot.sources?.leads.ok, true);
    assert.equal(snapshot.leads.length, 1);
    assert.equal(snapshot.revenue?.monthlyRecurringRevenue, 1000);

    await getVirtecSnapshot({ fetcher });
    assert.equal(calls, 7, "the second read came from the cache");
  });

  it("does not request anything when unconfigured", async () => {
    delete process.env.VIRTEC_API_KEY;
    const fetcher = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const snapshot = await getVirtecSnapshot({ fetcher });
    assert.equal(snapshot.configured, false);
  });
});

describe("diagnosing a connection that does not work", () => {
  let server: import("node:http").Server;
  let port = 0;
  let handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void = () => undefined;
  const logged: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(async () => {
    const http = await import("node:http");
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    process.env.VIRTEC_BASE_URL = `http://localhost:${port}`;
    process.env.VIRTEC_API_KEY = KEY;
    clearVirtecCache();
    logged.length = 0;
    console.log = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  });

  afterEach(async () => {
    console.log = originalLog;
    console.error = originalError;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.VIRTEC_BASE_URL;
    delete process.env.VIRTEC_API_KEY;
    clearVirtecCache();
  });

  it("names the address a redirect points to, without following it", async () => {
    let followed = false;
    handler = (req, res) => {
      if (req.url?.startsWith("/elsewhere")) followed = true;
      res.writeHead(308, { Location: "https://www.virtec.example/api/agentos/leads?limit=500" });
      res.end();
    };

    await assert.rejects(getVirtec(VIRTEC_PATHS.leads), (error: unknown) => {
      assert.ok(error instanceof VirtecError);
      assert.equal(error.reason, "redirected");
      assert.match(error.message, /https:\/\/www\.virtec\.example\. Set VIRTEC_BASE_URL/);
      return true;
    });
    assert.equal(followed, false);
  });

  it("tells a login page in front of Virtec apart from a wrong key", async () => {
    handler = (_req, res) => {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html>Log in to Vercel</html>");
    };
    await assert.rejects(getVirtec(VIRTEC_PATHS.clients), /Deployment Protection/);

    handler = (_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":"Invalid API key"}');
    };
    await assert.rejects(getVirtec(VIRTEC_PATHS.clients), /must equal AGENTOS_API_KEY/);
  });

  it("names a refused connection", async () => {
    // A port that was open a moment ago and is now closed.
    const http = await import("node:http");
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closed = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    process.env.VIRTEC_BASE_URL = `http://localhost:${closed}`;
    await assert.rejects(getVirtec(VIRTEC_PATHS.clients), /refused the connection/);
  });

  it("logs each failing endpoint once, with its status, and never the key", async () => {
    handler = (_req, res) => {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("not here");
    };

    await getVirtecSnapshot();
    await getVirtecSnapshot();

    const failures = logged.filter((line) => line.includes("virtec leads:"));
    assert.equal(failures.length, 1, "the second identical failure is not reprinted");
    assert.match(failures[0], /HTTP 404: .*wrong domain/);
    assert.ok(logged.some((line) => /0\/7 sources read from localhost:\d+ in \d+ms/.test(line)));
    assert.equal(logged.some((line) => line.includes(KEY)), false);
  });
});

describe("write-back", () => {
  const WRITE_KEY = "write-key-that-must-never-leak-abcdefgh";

  beforeEach(() => {
    process.env.VIRTEC_BASE_URL = "https://crm.example.test";
    process.env.VIRTEC_API_KEY = KEY;
    process.env.VIRTEC_WRITE_API_KEY = WRITE_KEY;
  });

  afterEach(() => {
    delete process.env.VIRTEC_BASE_URL;
    delete process.env.VIRTEC_API_KEY;
    delete process.env.VIRTEC_WRITE_API_KEY;
  });

  it("PATCHes the fixed route with the write key and only the given fields", async () => {
    const { patchVirtec } = await import("../client");
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetcher = (async (url: URL, init?: RequestInit) => {
      seen = { url: String(url), init };
      return respond(200, { followUp: { id: "f1", status: "sent" } });
    }) as unknown as typeof fetch;

    await patchVirtec({ kind: "follow-up", id: "f1", body: { status: "sent" } }, fetcher);
    assert.equal(seen?.url, "https://crm.example.test/api/agentos/follow-ups/f1");
    assert.equal(seen?.init?.method, "PATCH");
    assert.equal((seen?.init?.headers as Record<string, string>).Authorization, `Bearer ${WRITE_KEY}`);
    assert.equal(seen?.init?.body, '{"status":"sent"}');
  });

  it("is off without a separate write key, and never writes with the read key", async () => {
    const { isVirtecWritable, patchVirtec } = await import("../client");
    const fetcher = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;

    delete process.env.VIRTEC_WRITE_API_KEY;
    assert.equal(isVirtecWritable(), false);
    await assert.rejects(patchVirtec({ kind: "lead", id: "l1", body: { status: "reviewing" } }, fetcher), /Write-back is off/);

    process.env.VIRTEC_WRITE_API_KEY = KEY;
    assert.equal(isVirtecWritable(), false, "a write key equal to the read key does not count");
  });

  it("writes a website lead's status to its own route", async () => {
    const { patchVirtec } = await import("../client");
    let url: string | undefined;
    const fetcher = (async (target: URL) => {
      url = String(target);
      return respond(200, { lead: { id: "in1", status: "replied" } });
    }) as unknown as typeof fetch;

    await patchVirtec({ kind: "inbound-lead", id: "in1", body: { status: "replied" } }, fetcher);
    assert.equal(url, "https://crm.example.test/api/agentos/inbound-leads/in1");
  });

  it("publishes a lead magnet email with PUT, to its own route", async () => {
    const { patchVirtec } = await import("../client");
    let seen: { url: string; method?: string } | undefined;
    const fetcher = (async (target: URL, init?: RequestInit) => {
      seen = { url: String(target), method: init?.method };
      return respond(200, { email: { slug: "intake" } });
    }) as unknown as typeof fetch;

    await patchVirtec(
      { kind: "magnet-email", id: "intake", body: { track: "jurivo", subject: "S", body: "B {{link}}", readUrl: "https://x.test/r", enabled: true } },
      fetcher,
    );
    assert.deepEqual(seen, { url: "https://crm.example.test/api/agentos/lead-magnet-emails/intake", method: "PUT" });
  });

  it("asks for a scan with POST to its fixed route, and only with the write key", async () => {
    const { postVirtecScan } = await import("../client");
    let seen: { url: string; method?: string; auth?: string; body?: string } | undefined;
    const fetcher = (async (target: URL, init?: RequestInit) => {
      seen = { url: String(target), method: init?.method, auth: (init?.headers as Record<string, string>).Authorization, body: String(init?.body) };
      return respond(200, { summary: {}, budget: {} });
    }) as unknown as typeof fetch;

    await postVirtecScan({ area: "sandton", track: "virtara", categories: ["cafe"] }, fetcher);
    assert.equal(seen?.url, "https://crm.example.test/api/agentos/local-leads/scan");
    assert.equal(seen?.method, "POST");
    assert.equal(seen?.auth, `Bearer ${WRITE_KEY}`);
    assert.equal(seen?.body, '{"area":"sandton","track":"virtara","categories":["cafe"]}');

    delete process.env.VIRTEC_WRITE_API_KEY;
    await assert.rejects(postVirtecScan({ area: "sandton", track: "virtara", categories: ["cafe"] }, fetcher), /Write-back is off/);
  });

  it("passes Virtec's reason through when a scan is refused for want of a cap", async () => {
    const { postVirtecScan } = await import("../client");
    const off = (async () => respond(503, { error: "Scans from AgentOS are off until PLACES_MONTHLY_REQUEST_CAP is set" })) as unknown as typeof fetch;
    await assert.rejects(postVirtecScan({ area: "sandton", track: "virtara", categories: ["cafe"] }, off), /Virtec says: Scans from AgentOS are off until PLACES_MONTHLY_REQUEST_CAP/);

    // With no reason given, the old advice about the write key still applies.
    const bare = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(postVirtecScan({ area: "sandton", track: "virtara", categories: ["cafe"] }, bare), /AGENTOS_WRITE_API_KEY is missing there/);
  });

  it("counts a scan's requests by distinct Places type, and drops the snapshot cache after one", async () => {
    const { requestsFor, runScan } = await import("../scan");
    const info = {
      categories: [
        { category: "attorneys", track: "jurivo", types: ["lawyer"] },
        { category: "notaries", track: "jurivo", types: ["lawyer"] },
        { category: "salon", track: "virtara", types: ["beauty_salon", "hair_care"] },
        { category: "dental/aesthetics", track: "virtara", types: ["dentist", "beauty_salon"] },
      ],
    };
    assert.equal(requestsFor(info, "jurivo", ["attorneys", "notaries"]), 1, "two categories, one request");
    assert.equal(requestsFor(info, "virtara", ["salon", "dental/aesthetics"]), 3, "beauty_salon is shared");
    assert.equal(requestsFor(info, "virtara", ["attorneys"]), 0, "a category from the other site is not counted");

    const good = { summary: { fetched: 12, upserted: 12, skipped: 0, requests: 3, errors: [] }, budget: { month: "2026-10", used: 3, cap: 100, remaining: 97 } };
    const ok = (async () => respond(200, good)) as unknown as typeof fetch;
    assert.equal((await runScan({ area: "sandton", track: "virtara", categories: ["salon"] }, ok)).summary.requests, 3);

    const odd = (async () => respond(200, { hello: "there" })) as unknown as typeof fetch;
    await assert.rejects(runScan({ area: "sandton", track: "virtara", categories: ["salon"] }, odd), /not in a shape AgentOS can read/);
  });

  it("refuses an id that is not a record id, before any request", async () => {
    const { patchVirtec } = await import("../client");
    const fetcher = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    await assert.rejects(patchVirtec({ kind: "lead", id: "../clients", body: { status: "reviewing" } }, fetcher), /Not a Virtec record id/);
  });

  it("passes Virtec's reason through on a refused write, and names the write key on 401", async () => {
    const { patchVirtec } = await import("../client");
    const conflict = (async () => respond(409, { error: "Follow-up is already sent" })) as unknown as typeof fetch;
    await assert.rejects(patchVirtec({ kind: "follow-up", id: "f1", body: { status: "sent" } }, conflict), /409: Follow-up is already sent/);

    const refused = (async () => respond(401, { error: "Invalid API key" })) as unknown as typeof fetch;
    await assert.rejects(patchVirtec({ kind: "follow-up", id: "f1", body: { status: "sent" } }, refused), (error: unknown) => {
      assert.ok(error instanceof VirtecError);
      assert.match(error.message, /VIRTEC_WRITE_API_KEY/);
      assert.equal(error.message.includes(WRITE_KEY), false);
      return true;
    });
  });
});
