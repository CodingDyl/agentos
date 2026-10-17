import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleChangeObjective, detectPreviewPort } from "@shared/ship-types";
import { shipChangeStatusLabel, shipDevLabel } from "../ship-model";

describe("ship panel copy", () => {
  it("labels server and change states in words", () => {
    assert.equal(shipDevLabel("running"), "Running");
    assert.equal(shipDevLabel("installing"), "Installing");
    assert.equal(shipChangeStatusLabel("in_progress"), "In progress");
  });

  it("reuses the shared change-objective and port helpers", () => {
    assert.match(assembleChangeObjective([{ text: "Fix nav", priority: "high" }]), /Fix nav/);
    assert.equal(detectPreviewPort("- Local:        http://localhost:3001"), 3001);
  });
});
