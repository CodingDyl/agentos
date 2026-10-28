import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import express from "express";
import { placesRouter } from "../routes";
import { assessSite, checkSite, checkSites, copyrightYear } from "../site-check";
import { SafeFetchError } from "../../web/safe-fetch";

const NOW = new Date("2026-10-28T10:00:00Z");

const MODERN = `<!doctype html><html><head><title>Smit Attorneys</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Family law in Sandton.">
<meta property="og:title" content="Smit Attorneys">
<script type="application/ld+json">{"@type":"LegalService"}</script></head>
<body><h1>Smit Attorneys</h1><a href="tel:+27115550100">Call</a><a href="/book">Book a consultation</a><form action="/contact"></form>
<footer>© 2026 Smit Attorneys</footer></body></html>`;

const DATED = `<html><head><title>Smit</title></head><body><h1>Welcome</h1><p>Copyright 2014 Smit &amp; Partners</p></body></html>`;

describe("copyrightYear", () => {
  it("reads the common ways a footer states it, and takes the latest year of a range", () => {
    assert.equal(copyrightYear("<footer>© 2019 Acme</footer>", NOW), 2019);
    assert.equal(copyrightYear("<footer>&copy; 2015 - 2021 Acme</footer>", NOW), 2021);
    assert.equal(copyrightYear("<p>Copyright (c) Acme 2012. All rights reserved</p>", NOW), 2012);
  });

  it("ignores years that are not copyright notices, and years in the future", () => {
    assert.equal(copyrightYear("<p>Founded in 1996 in Sandton</p>", NOW), undefined);
    assert.equal(copyrightYear("<footer>© 2099 Acme</footer>", NOW), undefined);
    assert.equal(copyrightYear("<p>no notice at all</p>", NOW), undefined);
  });
});

describe("assessSite", () => {
  it("finds nothing to fix on a current, complete page", () => {
    const result = assessSite(MODERN, "https://smit.example/", NOW);
    assert.deepEqual(result.problems, []);
    assert.equal(result.score, 0);
    assert.equal(result.copyrightYear, 2026);
  });

  it("lists what is wrong worst first on a dated page, and keeps the score within 10", () => {
    const result = assessSite(DATED, "http://smit.example/", NOW);
    assert.deepEqual(result.problems.slice(0, 3), [
      "Not secure: the site has no HTTPS",
      "Not built for phones: no mobile viewport",
      "Looks abandoned: the footer says © 2014",
    ]);
    // The missing form is said once, by the booking leak, not again as a problem.
    assert.equal(result.problems.length, 7);
    assert.deepEqual(result.leaks, ["No way to book or ask for a quote online: a visitor ready to buy has to phone"]);
    assert.equal(result.score, 10);
  });

  it("is gentler about a footer a year or two old", () => {
    const twoYears = assessSite(MODERN.replace("© 2026", "© 2024"), "https://smit.example/", NOW);
    assert.deepEqual(twoYears.problems, ["Footer says © 2024"]);
    assert.equal(twoYears.score, 1);
    assert.deepEqual(assessSite(MODERN.replace("© 2026", "© 2025"), "https://smit.example/", NOW).problems, []);
  });
});

describe("assessSite: conversion leaks", () => {
  it("weighs a leak more than an out-of-date detail, and says which ads they run", () => {
    const html = MODERN.replace('<a href="/book">Book a consultation</a>', "").replace("</head>", "<script async src=\"https://www.googletagmanager.com/gtag/js?id=AW-123456789\"></script><script>gtag('config', 'AW-123456789');</script></head>");
    const result = assessSite(html, "https://smit.example/", NOW, { rating: 4.8, count: 210 });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.leaks, [
      "No Book or Get a quote button: visitors have to find the contact form themselves",
      "Hides its 4.8-star rating from 210 Google reviews: the site never mentions them",
    ]);
    assert.equal(result.score, 4);
    assert.deepEqual(result.advertising, ["Google Ads"]);
  });
});

describe("checkSite", () => {
  it("scores a site that did not load as a lead, with the reason", async () => {
    const check = await checkSite("https://gone.example", async () => {
      throw new SafeFetchError("The website answered 503.");
    }, NOW);
    assert.deepEqual(check, { website: "https://gone.example", reachable: false, problems: ["The site did not load: The website answered 503."], score: 8, leaks: [], advertising: [] });
  });

  it("does not leak the text of an unexpected failure", async () => {
    const check = await checkSite("https://odd.example", async () => {
      throw new Error("ECONNRESET at 10.0.0.5:443");
    }, NOW);
    assert.equal(check.reachable, false);
    assert.ok(!JSON.stringify(check).includes("10.0.0.5"));
  });
});

describe("checkSites", () => {
  it("answers in the order asked, reads each address once, and never reads more than four at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const read: string[] = [];
    const sites = Array.from({ length: 10 }, (_, index) => `https://site${index}.example`);

    const checks = await checkSites([...sites, sites[0]], async (url) => {
      read.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { url, html: MODERN };
    }, NOW);

    assert.deepEqual(checks.map((check) => check.website), [...sites, sites[0]]);
    assert.equal(read.length, 10);
    assert.ok(peak <= 4, `peak ${peak}`);
  });
});

describe("the check-sites route", () => {
  let server: Server;
  let base = "";

  beforeEach(() => {
    const app = express();
    app.use(express.json());
    app.use("/api/traction/places", placesRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/traction/places`;
  });
  afterEach(() => server.close());

  const post = async (body: unknown) => {
    const response = await fetch(`${base}/check-sites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as { error?: string; checks?: { website: string; reachable: boolean; problems: string[] }[] } };
  };

  it("rejects an empty list, too many addresses and the wrong shape", async () => {
    for (const bad of [{}, { websites: [] }, { websites: "https://a.example" }, { websites: Array.from({ length: 21 }, (_, i) => `https://s${i}.example`) }, { websites: ["x".repeat(301)] }]) {
      assert.equal((await post(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
  });

  it("refuses to read a private or local address, and says the site did not load", async () => {
    const { status, body } = await post({ websites: ["http://127.0.0.1:1/", "http://169.254.169.254/latest/meta-data/", "http://localhost/"] });
    assert.equal(status, 200);
    assert.deepEqual(body.checks?.map((check) => check.reachable), [false, false, false]);
    assert.ok(body.checks?.every((check) => check.problems[0]?.startsWith("The site did not load")));
  });
});
