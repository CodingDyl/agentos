import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterToolbar, type FilterGroup } from "../filter-toolbar";

function group(overrides: Partial<FilterGroup> = {}): FilterGroup {
  return {
    id: "type",
    label: "Type",
    value: "all",
    emptyValue: "all",
    onChange: () => undefined,
    options: [
      { value: "all", label: "All" },
      { value: "hermes", label: "Hermes", count: 4 },
      { value: "user", label: "User", count: 2 },
    ],
    ...overrides,
  } as FilterGroup;
}

function render(groups: FilterGroup[], extras: { open?: boolean; label?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(FilterToolbar, { groups, open: extras.open, label: extras.label }),
  );
}

describe("FilterToolbar", () => {
  it("hides chips and Clear all while nothing is active", () => {
    const html = render([group(), group({ id: "workspace", label: "Workspace" })]);
    assert.match(html, />Filter</);
    assert.doesNotMatch(html, /Clear all/);
    assert.doesNotMatch(html, /Type: /);
    assert.doesNotMatch(html, /data-filter-count/);
  });

  it("shows an active-count badge, removable chips, and Clear all when filters are on", () => {
    const html = render([
      group({ value: "hermes" }),
      group({
        id: "workspace",
        label: "Workspace",
        value: "pantry-pilot",
        options: [
          { value: "all", label: "All workspaces" },
          { value: "pantry-pilot", label: "Pantry Pilot" },
        ],
      }),
    ]);

    assert.match(html, /data-filter-count="2"/);
    assert.match(html, /Type: Hermes/);
    assert.match(html, /Workspace: Pantry Pilot/);
    assert.match(html, /Clear all/);
    assert.match(html, /Remove Type: Hermes/);
  });

  it("opens a compact grouped popover, with search on long lists", () => {
    const workspaces = Array.from({ length: 12 }, (_, index) => ({
      value: `w-${index}`,
      label: `Workspace ${index}`,
    }));
    const html = render(
      [
        group(),
        group({
          id: "workspace",
          label: "Workspace",
          options: [{ value: "all", label: "All workspaces" }, ...workspaces],
        }),
      ],
      { open: true },
    );

    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-label="Filters"/);
    assert.match(html, />Type</);
    assert.match(html, />Workspace</);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /Search workspaces/i);
    assert.match(html, /Hermes/);
    assert.match(html, />4</);
  });

  it("keeps the Filter button labelled Filter even when a custom aria label is set", () => {
    const html = render([group()], { label: "Filter" });
    assert.match(html, />Filter</);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-expanded="false"/);
  });
});
