import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DedsecLoader } from "../dedsec-loader";
import { LoadingState } from "../loading-state";
import { PaperLoading } from "../../paper/paper-states";

type MatchMedia = (query: string) => {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
};

function installMatchMedia(reduce: boolean): void {
  const matchMedia: MatchMedia = (query) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, writable: true, value: matchMedia });
}

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

describe("DedsecLoader", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "matchMedia");
  });

  it("exposes a busy status with a screen-reader Loading… label", () => {
    installMatchMedia(false);
    const html = render(createElement(DedsecLoader, { delayMs: 0 }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Loading…/);
    assert.match(html, /sr-only/);
  });

  it("plays the looping WebM with a GIF fallback once the show delay has elapsed", () => {
    installMatchMedia(false);
    const html = render(createElement(DedsecLoader, { delayMs: 0 }));
    assert.match(html, /<video[^>]*autoplay/i);
    assert.match(html, /<video[^>]*loop/i);
    assert.match(html, /type="video\/webm"/);
    assert.match(html, /dedsec\.gif/);
  });

  it("hides the animation until the delay so a fast read does not flash", () => {
    installMatchMedia(false);
    const html = render(createElement(DedsecLoader, { delayMs: 150 }));
    assert.match(html, /role="status"/);
    assert.match(html, /Loading…/);
    assert.doesNotMatch(html, /<video/i);
    assert.doesNotMatch(html, /dedsec\.gif/);
  });

  it("shows a static first frame when the operator prefers reduced motion", () => {
    installMatchMedia(true);
    const html = render(createElement(DedsecLoader, { delayMs: 0 }));
    assert.match(html, /dedsec-still\.webp/);
    assert.doesNotMatch(html, /<video/i);
  });

  it("sizes the page variant to fill the stage and the compact variant for cards", () => {
    installMatchMedia(false);
    const page = render(createElement(DedsecLoader, { variant: "page", delayMs: 0 }));
    const compact = render(createElement(DedsecLoader, { variant: "compact", delayMs: 0 }));
    assert.match(page, /data-variant="page"/);
    assert.match(compact, /data-variant="compact"/);
    assert.match(page, /min-h-/);
    assert.ok(page.length !== compact.length);
  });
});

describe("shared loading states use DedsecLoader", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "matchMedia");
  });

  it("renders LoadingState as the DedSec status", () => {
    installMatchMedia(false);
    const html = render(
      createElement(LoadingState, { label: "AgentOS", message: "Reading workspace…", detail: "Vault / reading" }),
    );
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Loading…/);
  });

  it("renders PaperLoading as the DedSec status", () => {
    installMatchMedia(false);
    const html = render(createElement(PaperLoading, { title: "Activity", message: "Assembling the timeline…" }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Loading…/);
    assert.doesNotMatch(html, /animate-pulse/);
  });
});
