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

  it("plays the looping WebM once the show delay has elapsed", () => {
    installMatchMedia(false);
    const html = render(createElement(DedsecLoader, { delayMs: 0 }));
    assert.match(html, /<video[^>]*autoplay/i);
    assert.match(html, /<video[^>]*loop/i);
    assert.match(html, /type="video\/webm"/);
    assert.match(html, /dedsec\.webm/);
  });

  it("hides the animation until the delay so a fast read does not flash", () => {
    installMatchMedia(false);
    const html = render(createElement(DedsecLoader, { delayMs: 150 }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Loading…/);
    assert.match(html, /sr-only/);
    assert.doesNotMatch(html, /<video/i);
    assert.doesNotMatch(html, /dedsec\.gif/);
    assert.doesNotMatch(html, /dedsec-still\.webp/);
  });

  it("shows a static first frame when the operator prefers reduced motion", () => {
    installMatchMedia(true);
    const html = render(createElement(DedsecLoader, { delayMs: 0 }));
    assert.match(html, /dedsec-still\.webp/);
    assert.doesNotMatch(html, /<video/i);
  });

  it("fills the parent with square, contained media and no backdrop for both variants", () => {
    installMatchMedia(false);
    const page = render(createElement(DedsecLoader, { variant: "page", delayMs: 0 }));
    const compact = render(createElement(DedsecLoader, { variant: "compact", delayMs: 0 }));
    assert.match(page, /data-variant="page"/);
    assert.match(compact, /data-variant="compact"/);
    for (const html of [page, compact]) {
      assert.match(html, /w-full/);
      assert.match(html, /h-auto/);
      assert.match(html, /max-h-full/);
      assert.match(html, /object-contain/);
      assert.match(html, /object-center/);
      assert.match(html, /aspect-square/);
      assert.match(html, /min-w-0/);
      assert.match(html, /image-rendering:pixelated/);
      assert.match(html, /overflow-hidden/);
      assert.match(html, /items-center/);
      assert.match(html, /justify-center/);
      assert.match(html, /min-h-0/);
      assert.doesNotMatch(html, /bg-black/);
      assert.doesNotMatch(html, /\bpy-/);
      assert.doesNotMatch(html, /\bpx-/);
      assert.doesNotMatch(html, /min-h-40/);
      assert.doesNotMatch(html, /min-h-\[/);
      assert.doesNotMatch(html, /w-36/);
      assert.doesNotMatch(html, /min\(20rem/);
    }
    installMatchMedia(true);
    const reduced = render(createElement(DedsecLoader, { variant: "compact", delayMs: 0 }));
    assert.match(reduced, /dedsec-still\.webp/);
    assert.match(reduced, /w-full/);
    assert.match(reduced, /h-auto/);
    assert.match(reduced, /max-h-full/);
    assert.match(reduced, /object-contain/);
    assert.match(reduced, /object-center/);
    assert.match(reduced, /aspect-square/);
    assert.match(reduced, /image-rendering:pixelated/);
    assert.doesNotMatch(reduced, /bg-black/);
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
