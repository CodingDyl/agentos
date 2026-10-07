import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { embedVerdict } from "../site";

const site = "https://example.com/";

describe("whether a site can be framed in AgentOS", () => {
  it("allows a site that says nothing about framing", () => {
    assert.deepEqual(embedVerdict(200, site, new Headers()), { allowed: true });
  });

  it("refuses X-Frame-Options DENY and SAMEORIGIN", () => {
    assert.equal(embedVerdict(200, site, new Headers({ "x-frame-options": "DENY" })).allowed, false);
    assert.match(embedVerdict(200, site, new Headers({ "x-frame-options": "sameorigin" })).reason ?? "", /SAMEORIGIN/);
  });

  it("lets frame-ancestors override X-Frame-Options, as browsers do", () => {
    const headers = new Headers({ "x-frame-options": "DENY", "content-security-policy": "default-src 'self'; frame-ancestors *" });
    assert.deepEqual(embedVerdict(200, site, headers), { allowed: true });
  });

  it("refuses frame-ancestors 'none', 'self', or a named host", () => {
    const csp = (value: string) => new Headers({ "content-security-policy": value });
    assert.match(embedVerdict(200, site, csp("frame-ancestors 'none'")).reason ?? "", /'none'/);
    assert.match(embedVerdict(200, site, csp("frame-ancestors 'self'")).reason ?? "", /by itself/);
    assert.match(embedVerdict(200, site, csp("frame-ancestors 'self' https://app.example.com")).reason ?? "", /app\.example\.com/);
  });

  it("names Vercel Deployment Protection rather than a blank frame", () => {
    assert.match(embedVerdict(401, site, new Headers()).reason ?? "", /Deployment Protection/);
    assert.equal(embedVerdict(200, "https://vercel.com/sso-api?url=x", new Headers()).allowed, false);
  });
});
