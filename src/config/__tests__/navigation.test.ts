import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { navigationItems } from "../navigation";

function itemsIn(section: string) {
  return navigationItems.filter((item) => (item.section ?? "primary") === section);
}

function labelsIn(section: string) {
  return itemsIn(section).map((item) => item.label);
}

describe("sidebar navigation", () => {
  it("labels the home item Dashboard and keeps it on /", () => {
    const home = navigationItems.find((item) => item.href === "/");
    assert.equal(home?.label, "Dashboard");
    assert.equal(home?.section ?? "primary", "primary");
  });

  it("does not keep a Today nav label", () => {
    assert.equal(
      navigationItems.some((item) => item.label === "Today"),
      false,
    );
  });

  it("groups Business, Traction and Finance under Business, in that order", () => {
    assert.deepEqual(labelsIn("business"), ["Business", "Traction", "Finance"]);
    assert.deepEqual(
      itemsIn("business").map((item) => item.href),
      ["/business", "/traction", "/finance"],
    );
  });

  it("groups Workspaces, Coder and Creative under Work, in that order", () => {
    const work = itemsIn("work");
    const labels = work.map((item) => item.label);
    assert.ok(labels.includes("Workspaces"));
    assert.ok(labels.includes("Coder"));
    assert.ok(labels.includes("Creative"));
    assert.equal(labels.indexOf("Workspaces") < labels.indexOf("Coder"), true);
    assert.equal(labels.indexOf("Coder") < labels.indexOf("Creative"), true);
    assert.equal(work.find((item) => item.label === "Creative")?.href, "/designs");
    assert.equal(work.find((item) => item.label === "Workspaces")?.href, "/workspaces");
    assert.equal(work.find((item) => item.label === "Coder")?.href, "/coder");
  });

  it("renames Learning to HUB and groups it with Memory and Knowledge", () => {
    assert.deepEqual(labelsIn("memory"), ["HUB", "Memory", "Knowledge"]);
    assert.deepEqual(
      itemsIn("memory").map((item) => item.href),
      ["/learning", "/memory", "/knowledge"],
    );
    assert.equal(
      navigationItems.some((item) => item.label === "Learning"),
      false,
    );
  });

  it("puts Career with the operations destinations, including Agents", () => {
    const operations = itemsIn("operations");
    const labels = operations.map((item) => item.label);
    assert.ok(labels.includes("Career"));
    assert.ok(labels.includes("Agents"));
    assert.ok(labels.includes("Operations"));
    assert.equal(operations.find((item) => item.label === "Career")?.href, "/career");
    assert.equal(operations.find((item) => item.label === "Agents")?.href, "/workers");
    assert.equal(operations.find((item) => item.label === "Operations")?.href, "/operations");
  });

  it("keeps every previous destination so nothing is dropped", () => {
    const hrefs = new Set(navigationItems.map((item) => item.href));
    for (const href of [
      "/",
      "/inbox",
      "/traction",
      "/business",
      "/finance",
      "/operator",
      "/workspaces",
      "/coder",
      "/career",
      "/knowledge",
      "/memory",
      "/learning",
      "/designs",
      "/automations",
      "/connectors",
      "/operations",
      "/activity",
      "/workers",
      "/compass",
    ]) {
      assert.ok(hrefs.has(href), `missing ${href}`);
    }
  });

  it("keeps leftover items in named sections rather than dropping them", () => {
    const byHref = new Map(navigationItems.map((item) => [item.href, item]));
    assert.equal(byHref.get("/inbox")?.section ?? "primary", "primary");
    assert.equal(byHref.get("/operator")?.section, "work");
    assert.equal(byHref.get("/automations")?.section, "operations");
    assert.equal(byHref.get("/connectors")?.section, "operations");
    assert.equal(byHref.get("/activity")?.section, "operations");
    assert.equal(byHref.get("/compass")?.section, "footer");
  });
});
