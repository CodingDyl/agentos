import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressesOnPage,
  contactLinks,
  decodeCloudflareEmail,
  rankCandidates,
} from "../email-finder";

const page = (url: string, html: string) => ({ url, html });

describe("email finder", () => {
  it("reads mailto links, plain text and spelled-out addresses", () => {
    const found = addressesOnPage(
      '<a href="mailto:Info@Shop.co.za?subject=Hi">x</a> Write to sam [at] shop [dot] co [dot] za today',
    ).map((entry) => entry.address);
    assert.ok(found.includes("info@shop.co.za"));
    assert.ok(found.includes("sam@shop.co.za"));
  });

  it("decodes Cloudflare-hidden addresses", () => {
    // "a@b.co" with key 0x42
    const hex = "42" + [..."a@b.co"].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, "0")).join("");
    assert.equal(decodeCloudflareEmail(hex), "a@b.co");
  });

  it("ranks an owner's named mailbox above a role mailbox", () => {
    const ranked = rankCandidates(
      [
        page(
          "https://www.shop.co.za/about",
          "<p>Meet Sam, owner and founder: sam@shop.co.za. General: info@shop.co.za</p>",
        ),
      ],
      "www.shop.co.za",
    );
    assert.equal(ranked[0].address, "sam@shop.co.za");
    assert.equal(ranked[0].kind, "owner");
    assert.equal(ranked[1].kind, "role");
  });

  it("drops no-reply, platform and other companies' addresses, keeps free mail", () => {
    const ranked = rankCandidates(
      [
        page(
          "https://shop.co.za/",
          "noreply@shop.co.za abc@sentry.io designer@agency.com owner.shop@gmail.com",
        ),
      ],
      "shop.co.za",
    );
    assert.deepEqual(
      ranked.map((entry) => entry.address),
      ["owner.shop@gmail.com"],
    );
  });

  it("follows only contact-like links on the same site", () => {
    const links = contactLinks(
      '<a href="/contact-us">c</a><a href="https://other.com/contact">o</a><a href="/products">p</a><a href="/team/">t</a>',
      "https://shop.co.za/",
    );
    assert.deepEqual(links.sort(), ["https://shop.co.za/contact-us", "https://shop.co.za/team/"]);
  });
});
