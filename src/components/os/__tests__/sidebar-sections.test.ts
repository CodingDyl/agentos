import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  breadcrumbForPath,
  COLLAPSIBLE_SECTIONS,
  expandActiveSection,
  parseCollapsedSections,
  sectionForPath,
  serializeCollapsedSections,
  toggleCollapsedSection,
  type CollapsibleSection,
} from "../sidebar-sections";

const items = [
  { href: "/", section: "primary" as const },
  { href: "/inbox", section: "primary" as const },
  { href: "/business", section: "business" as const },
  { href: "/traction", section: "business" as const },
  { href: "/workspaces", section: "work" as const },
  { href: "/learning", section: "memory" as const },
  { href: "/operations", section: "operations" as const },
  { href: "/agents", section: "operations" as const },
  { href: "/workers", section: "operations" as const },
  { href: "/compass", section: "footer" as const },
];

describe("collapsible sidebar sections", () => {
  it("treats Business, Work, Memory and Operations as collapsible", () => {
    assert.deepEqual([...COLLAPSIBLE_SECTIONS], ["business", "work", "memory", "operations"]);
  });

  it("starts with every section expanded when storage is empty", () => {
    assert.deepEqual([...parseCollapsedSections(null)], []);
    assert.deepEqual([...parseCollapsedSections("")], []);
    assert.deepEqual([...parseCollapsedSections("not-json")], []);
  });

  it("round-trips collapsed section ids from localStorage", () => {
    const collapsed = new Set<CollapsibleSection>(["work", "memory"]);
    const raw = serializeCollapsedSections(collapsed);
    assert.deepEqual([...parseCollapsedSections(raw)].sort(), ["memory", "work"]);
  });

  it("ignores unknown ids so a future rename cannot poison storage", () => {
    assert.deepEqual([...parseCollapsedSections(JSON.stringify(["work", "legacy", 3]))], ["work"]);
  });

  it("toggles a section without affecting the others", () => {
    const collapsed = new Set<CollapsibleSection>(["business"]);
    const afterWork = toggleCollapsedSection(collapsed, "work");
    assert.deepEqual([...afterWork].sort(), ["business", "work"]);
    const afterBusiness = toggleCollapsedSection(afterWork, "business");
    assert.deepEqual([...afterBusiness], ["work"]);
  });

  it("maps the active path to its section, including nested workspace routes", () => {
    assert.equal(sectionForPath("/", items), undefined);
    assert.equal(sectionForPath("/inbox", items), undefined);
    assert.equal(sectionForPath("/business", items), "business");
    assert.equal(sectionForPath("/workspaces/pantry-pilot", items), "work");
    assert.equal(sectionForPath("/learning?tab=saved", items), "memory");
    assert.equal(sectionForPath("/operations?tab=agents", items), "operations");
    assert.equal(sectionForPath("/compass", items), undefined);
  });

  it("auto-expands the section that holds the active route", () => {
    const collapsed = new Set<CollapsibleSection>(["work", "memory"]);
    const next = expandActiveSection(collapsed, "/workspaces/pantry-pilot", items);
    assert.deepEqual([...next], ["memory"]);
    assert.notEqual(next, collapsed);
  });

  it("leaves collapsed state alone when the active route is not in a collapsible section", () => {
    const collapsed = new Set<CollapsibleSection>(["business"]);
    assert.equal(expandActiveSection(collapsed, "/", items), collapsed);
  });
});

describe("breadcrumbForPath", () => {
  const items = [
    { label: "Dashboard", href: "/", section: "primary" },
    { label: "Inbox", href: "/inbox", section: "primary" },
    { label: "Business", href: "/business", section: "business" },
    { label: "Workspaces", href: "/workspaces", section: "work" },
    { label: "Creative", href: "/designs", section: "work" },
    { label: "Compass", href: "/compass", section: "footer" },
  ];

  it("names the page alone when it has no group", () => {
    assert.deepEqual(breadcrumbForPath("/", items), [{ label: "Dashboard", href: "/" }]);
    assert.deepEqual(breadcrumbForPath("/compass", items), [{ label: "Compass", href: "/compass" }]);
  });

  it("leads with the group, without repeating a page named after it", () => {
    assert.deepEqual(breadcrumbForPath("/workspaces", items), [{ label: "Work" }, { label: "Workspaces", href: "/workspaces" }]);
    assert.deepEqual(breadcrumbForPath("/business", items), [{ label: "Business", href: "/business" }]);
  });

  it("carries what is open inside a destination, and ignores the query", () => {
    assert.deepEqual(breadcrumbForPath("/workspaces/pantry-pilot?tab=tasks", items), [
      { label: "Work" },
      { label: "Workspaces", href: "/workspaces" },
      { label: "pantry-pilot" },
    ]);
  });

  it("is never blank on a screen no navigation item claims", () => {
    assert.deepEqual(breadcrumbForPath("/design-system", items), [{ label: "Design system", href: "/design-system" }]);
  });
});
