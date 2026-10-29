import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleChangeObjective, ShipDeployRequestSchema } from "@shared/ship-types";
import { confirmsProduction, filterChanges, productionConfirmationName, shipChangeStatusLabel, shipDevLabel } from "../ship-model";

describe("ship panel copy", () => {
  it("labels server and change states in words", () => {
    assert.equal(shipDevLabel("running"), "Running");
    assert.equal(shipDevLabel("installing"), "Installing");
    assert.equal(shipDevLabel("failed"), "Failed");
    assert.equal(shipChangeStatusLabel("in_progress"), "In progress");
  });

  it("reuses the shared change-objective helper", () => {
    assert.match(assembleChangeObjective([{ text: "Fix nav", priority: "high" }]), /Fix nav/);
  });

  it("filters the change list by status and priority, and shows everything with no filter", () => {
    const items = [
      { id: "a", status: "open" as const, priority: "high" as const },
      { id: "b", status: "done" as const, priority: "low" as const },
      { id: "c", status: "open" as const, priority: "low" as const },
    ];
    assert.deepEqual(filterChanges(items, [], []).map((item) => item.id), ["a", "b", "c"]);
    assert.deepEqual(filterChanges(items, ["open"], []).map((item) => item.id), ["a", "c"]);
    assert.deepEqual(filterChanges(items, ["open"], ["low"]).map((item) => item.id), ["c"]);
  });
});

describe("production confirmation", () => {
  it("asks for the linked Vercel project's name, falling back to its id", () => {
    assert.equal(productionConfirmationName({ vercelProjectName: "acme-site", vercelProjectId: "prj_1" }), "acme-site");
    assert.equal(productionConfirmationName({ vercelProjectId: "prj_1" }), "prj_1");
    assert.equal(productionConfirmationName({}), undefined);
  });

  it("enables the button only for an exact match", () => {
    assert.equal(confirmsProduction("acme-site", "acme-site"), true);
    assert.equal(confirmsProduction("  acme-site ", "acme-site"), true);
    assert.equal(confirmsProduction("Acme-site", "acme-site"), false);
    assert.equal(confirmsProduction("", "acme-site"), false);
    assert.equal(confirmsProduction("anything", undefined), false);
  });

  it("cannot build a production request without the confirmation", () => {
    assert.equal(ShipDeployRequestSchema.safeParse({ target: "production" }).success, false);
    assert.equal(ShipDeployRequestSchema.safeParse({ target: "production", confirm: " " }).success, false);
    assert.equal(ShipDeployRequestSchema.safeParse({ target: "production", confirm: "acme-site" }).success, true);
    assert.equal(ShipDeployRequestSchema.safeParse({ target: "preview" }).success, true);
  });
});
