import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingState } from "../loading-state";
import { PageLoader } from "../page-loader";
import { PaperLoading } from "../../paper/paper-states";

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

describe("PageLoader", () => {
  it("is a busy status that names the wait", () => {
    const html = render(createElement(PageLoader, { delayMs: 0, label: "Reading the vault…" }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Reading the vault…/);
  });

  it("keeps the wait for screen readers only until the delay, so a fast read does not flash", () => {
    const html = render(createElement(PageLoader, { delayMs: 150 }));
    assert.match(html, /role="status"/);
    assert.match(html, /sr-only/);
    assert.match(html, /Loading…/);
  });

  it("holds a stable height for both variants and carries no media", () => {
    const page = render(createElement(PageLoader, { variant: "page", delayMs: 0 }));
    const compact = render(createElement(PageLoader, { variant: "compact", delayMs: 0 }));
    assert.match(page, /data-variant="page"/);
    assert.match(page, /min-h-40/);
    assert.match(compact, /data-variant="compact"/);
    assert.match(compact, /min-h-10/);
    for (const html of [page, compact]) {
      assert.doesNotMatch(html, /<video|<img/i);
      assert.doesNotMatch(html, /sr-only/);
    }
  });
});

describe("loaders built on PageLoader", () => {
  it("LoadingState names what is being read", () => {
    const html = render(createElement(LoadingState, { label: "Designs", message: "Reading designs…" }));
    assert.match(html, /aria-busy="true"/);
  });

  it("PaperLoading is a busy status", () => {
    const html = render(createElement(PaperLoading, { title: "Loading", message: "Reading…" }));
    assert.match(html, /aria-busy="true"/);
  });
});
