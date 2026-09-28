import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getVirtec, isVirtecConfigured, VIRTEC_PATHS, VirtecError, virtecConfigurationProblem } from "../client";
import { normaliseClients, normaliseFollowUps, normaliseLeads, normaliseQuotes, normaliseRevenue, timestamp } from "../normalise";
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
    assert.equal(calls, 6, "the second read came from the cache");
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
      assert.match(error.message, /https:\/\/www\.virtec\.example — set VIRTEC_BASE_URL/);
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
    assert.match(failures[0], /HTTP 404 — .*wrong domain/);
    assert.ok(logged.some((line) => /0\/6 sources read from localhost:\d+ in \d+ms/.test(line)));
    assert.equal(logged.some((line) => line.includes(KEY)), false);
  });
});
