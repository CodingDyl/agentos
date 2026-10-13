import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DASHBOARD_COLUMN_BREAKPOINTS,
  dashboardCardClass,
  dashboardCardSpan,
  dashboardColumnCount,
} from "../dashboard-layout";

/**
 * The Dashboard is built for an ultrawide: columns arrive as the viewport
 * grows, cards span 1–2 of them by importance, and nothing should force a
 * horizontal scroll.
 */

describe("dashboard column count", () => {
  it("is one column below 1280px", () => {
    assert.equal(dashboardColumnCount(375), 1);
    assert.equal(dashboardColumnCount(1279), 1);
  });

  it("is two columns from 1280px", () => {
    assert.equal(dashboardColumnCount(1280), 2);
    assert.equal(dashboardColumnCount(1439), 2);
    assert.equal(dashboardColumnCount(1440), 2);
    assert.equal(dashboardColumnCount(1599), 2);
  });

  it("is three to four columns around 1920px", () => {
    assert.equal(dashboardColumnCount(1600), 3);
    assert.equal(dashboardColumnCount(1919), 3);
    assert.equal(dashboardColumnCount(1920), 4);
    assert.equal(dashboardColumnCount(2559), 4);
  });

  it("is five to six columns at 2560px and ultrawide 3440px", () => {
    assert.equal(dashboardColumnCount(2560), 5);
    assert.equal(dashboardColumnCount(3439), 5);
    assert.equal(dashboardColumnCount(3440), 6);
    assert.equal(dashboardColumnCount(5120), 6);
  });

  it("keeps the documented breakpoint table in ascending order", () => {
    const widths = DASHBOARD_COLUMN_BREAKPOINTS.map((point) => point.minWidth);
    assert.deepEqual(widths, [...widths].sort((a, b) => a - b));
    const columns = DASHBOARD_COLUMN_BREAKPOINTS.map((point) => point.columns);
    assert.deepEqual(columns, [...columns].sort((a, b) => a - b));
  });
});

describe("dashboard card spans", () => {
  it("never spans more columns than exist, so a 2-span card cannot overflow a 1-column grid", () => {
    assert.equal(dashboardCardSpan("inbox", 1), 1);
    assert.equal(dashboardCardSpan("yourThree", 1), 1);
    assert.equal(dashboardCardSpan("activeWork", 1), 1);
    assert.equal(dashboardCardSpan("focus", 1), 1);
  });

  it("gives urgent cards two columns once the grid has them", () => {
    assert.equal(dashboardCardSpan("inbox", 2), 2);
    assert.equal(dashboardCardSpan("inbox", 6), 2);
    assert.equal(dashboardCardSpan("yourThree", 4), 2);
    assert.equal(dashboardCardSpan("activeWork", 5), 2);
    assert.equal(dashboardCardSpan("focus", 3), 2);
  });

  it("keeps the revenue strip full width at every breakpoint", () => {
    assert.equal(dashboardCardSpan("revenue", 1), 1);
    assert.equal(dashboardCardSpan("revenue", 2), 2);
    assert.equal(dashboardCardSpan("revenue", 4), 4);
    assert.equal(dashboardCardSpan("revenue", 6), 6);
  });

  it("keeps everything else to one column", () => {
    assert.equal(dashboardCardSpan("traction", 6), 1);
    assert.equal(dashboardCardSpan("finance", 4), 1);
    assert.equal(dashboardCardSpan("news", 2), 1);
    assert.equal(dashboardCardSpan("captured", 5), 1);
  });

  it("maps spans to CSS classes that the grid stylesheet can target", () => {
    assert.equal(dashboardCardClass("revenue"), "dashboard-span-full");
    assert.equal(dashboardCardClass("inbox"), "dashboard-span-2");
    assert.equal(dashboardCardClass("traction"), "dashboard-span-1");
  });
});

describe("dashboard stylesheet", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/styles/agentos.css"), "utf8");

  it("drops the max-width container and packs with dense auto-flow", () => {
    assert.match(css, /\.dashboard-workspace\s*\{[^}]*max-width:\s*none/);
    assert.match(css, /\.dashboard-grid\s*\{[^}]*grid-auto-flow:\s*dense/);
    assert.match(css, /\.dashboard-span-full\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
  });

  it("adds the same columns the layout table names, at the same widths", () => {
    for (const point of DASHBOARD_COLUMN_BREAKPOINTS) {
      if (point.minWidth === 0) {
        assert.match(css, /\.dashboard-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        continue;
      }
      const start = css.indexOf(`@media (min-width: ${point.minWidth}px)`);
      assert.ok(start >= 0, `missing media query at ${point.minWidth}px`);
      const rest = css.slice(start + 1);
      const next = rest.search(/@media \(min-width: \d+px\)/);
      const block = css.slice(start, next >= 0 ? start + 1 + next : undefined);
      const repeat = block.match(/\.dashboard-grid\s*\{[^}]*repeat\((\d+)/);
      assert.ok(repeat, `missing ${point.columns}-column rule at ${point.minWidth}px`);
      assert.equal(Number(repeat[1]), point.columns, `${point.minWidth}px should be ${point.columns} columns`);
    }
  });

  it("lets a 2-span card take two columns only once the grid has them", () => {
    assert.match(css, /\.dashboard-span-2\s*\{\s*grid-column:\s*span\s+1/);
    const start = css.indexOf("@media (min-width: 1280px)");
    const rest = css.slice(start + 1);
    const next = rest.search(/@media \(min-width: \d+px\)/);
    const block = css.slice(start, next >= 0 ? start + 1 + next : undefined);
    assert.match(block, /\.dashboard-span-2\s*\{\s*grid-column:\s*span\s+2/);
  });
});
