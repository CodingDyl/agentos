import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversionLeaks } from "../conversion-leaks";

const filler = `<p>${"We have served Sandton families for twenty years with honest, careful work. ".repeat(30)}</p>`;

describe("conversionLeaks", () => {
  it("says when there is no way to book at all, and when there is only a form", () => {
    assert.deepEqual(conversionLeaks("<body><h1>Plumber</h1></body>").leaks, ["No way to book or ask for a quote online: a visitor ready to buy has to phone"]);
    assert.deepEqual(conversionLeaks('<body><form action="/c"></form></body>').leaks, ["No Book or Get a quote button: visitors have to find the contact form themselves"]);
  });

  it("counts a booking platform link or a quote button as a way to book", () => {
    assert.deepEqual(conversionLeaks('<body><a href="https://calendly.com/smit">Pick a time</a></body>').leaks, []);
    assert.deepEqual(conversionLeaks("<body><button>Get a quote</button></body>").leaks, []);
  });

  it("says when the first call or book button comes after most of the page", () => {
    const late = `<body><h1>Smit</h1>${filler}<a href="tel:+27115550100">Call us</a><a href="/book">Book now</a></body>`;
    assert.deepEqual(conversionLeaks(late).leaks, ["The first call or book button is far down the page, after most of the content"]);
    const early = `<body><a href="tel:+27115550100">Call us</a><a href="/book">Book now</a>${filler}</body>`;
    assert.deepEqual(conversionLeaks(early).leaks, []);
  });

  it("only calls a hidden rating a leak when it is worth showing and the page never mentions reviews", () => {
    const page = '<body><a href="/book">Book now</a></body>';
    assert.equal(conversionLeaks(page, { rating: 4.9, count: 120 }).leaks.length, 1);
    assert.deepEqual(conversionLeaks(page, { rating: 3.9, count: 120 }).leaks, []);
    assert.deepEqual(conversionLeaks(page, { rating: 4.9, count: 5 }).leaks, []);
    assert.deepEqual(conversionLeaks('<body><a href="/book">Book now</a><p>Rated 4.9 on Google Reviews</p></body>', { rating: 4.9, count: 120 }).leaks, []);
  });

  it("finds Google Ads and Meta tracking, and nothing on a page without it", () => {
    const tracked = `<head><script src="https://connect.facebook.net/en_US/fbevents.js"></script><script>fbq('init', '1');gtag('config', 'AW-987654321');</script></head>`;
    assert.deepEqual(conversionLeaks(tracked).advertising, ["Google Ads", "Meta"]);
    assert.deepEqual(conversionLeaks("<body><a href='/book'>Book</a></body>").advertising, []);
  });
});
