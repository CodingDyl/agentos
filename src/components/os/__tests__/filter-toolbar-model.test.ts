import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEARCHABLE_OPTION_THRESHOLD,
  activeChips,
  activeFilterCount,
  groupIsSearchable,
  optionsMatching,
  toggleMultiple,
  toggleSingle,
  type FilterGroupState,
} from "../filter-toolbar-model";

const typeGroup: FilterGroupState = {
  id: "type",
  label: "Type",
  mode: "single",
  value: "all",
  emptyValue: "all",
  options: [
    { value: "all", label: "All" },
    { value: "hermes", label: "Hermes" },
    { value: "user", label: "User" },
  ],
};

const workspaceGroup: FilterGroupState = {
  id: "workspace",
  label: "Workspace",
  mode: "single",
  value: "all",
  emptyValue: "all",
  options: [
    { value: "all", label: "All workspaces" },
    { value: "pantry-pilot", label: "Pantry Pilot" },
    { value: "virtara", label: "Virtara" },
  ],
};

describe("active filter chips", () => {
  it("emits no chips while every group is on its empty value", () => {
    assert.deepEqual(activeChips([typeGroup, workspaceGroup]), []);
    assert.equal(activeFilterCount([typeGroup, workspaceGroup]), 0);
  });

  it("emits one chip per active group, labelled with the group and option", () => {
    const chips = activeChips([
      { ...typeGroup, value: "hermes" },
      { ...workspaceGroup, value: "pantry-pilot" },
    ]);

    assert.deepEqual(chips, [
      {
        groupId: "type",
        groupLabel: "Type",
        value: "hermes",
        label: "Hermes",
        text: "Type: Hermes",
      },
      {
        groupId: "workspace",
        groupLabel: "Workspace",
        value: "pantry-pilot",
        label: "Pantry Pilot",
        text: "Workspace: Pantry Pilot",
      },
    ]);
    assert.equal(activeFilterCount([{ ...typeGroup, value: "hermes" }, workspaceGroup]), 1);
  });

  it("emits one chip per selected value in a multi-select group", () => {
    const chips = activeChips([
      {
        id: "workspace",
        label: "Workspace",
        mode: "multiple",
        values: ["pantry-pilot", "virtara"],
        options: workspaceGroup.options,
      },
    ]);

    assert.equal(chips.length, 2);
    assert.deepEqual(
      chips.map((chip) => chip.text),
      ["Workspace: Pantry Pilot", "Workspace: Virtara"],
    );
  });
});

describe("toggling a value", () => {
  it("selects a different option, and returns to empty when the active option is clicked again", () => {
    assert.equal(toggleSingle("all", "hermes", "all"), "hermes");
    assert.equal(toggleSingle("hermes", "user", "all"), "user");
    assert.equal(toggleSingle("hermes", "hermes", "all"), "all");
    assert.equal(toggleSingle("hermes", "all", "all"), "all");
  });

  it("adds and removes values independently in a multi-select group", () => {
    assert.deepEqual(toggleMultiple([], "pantry-pilot"), ["pantry-pilot"]);
    assert.deepEqual(toggleMultiple(["pantry-pilot"], "virtara"), ["pantry-pilot", "virtara"]);
    assert.deepEqual(toggleMultiple(["pantry-pilot", "virtara"], "pantry-pilot"), ["virtara"]);
  });
});

describe("searching a long option list", () => {
  it("matches option labels case-insensitively and keeps the list intact when the query is empty", () => {
    const options = workspaceGroup.options;
    assert.equal(optionsMatching(options, "").length, 3);
    assert.deepEqual(
      optionsMatching(options, "pan").map((option) => option.value),
      ["pantry-pilot"],
    );
    assert.deepEqual(
      optionsMatching(options, "VIRT").map((option) => option.value),
      ["virtara"],
    );
  });

  it("treats lists at the threshold as searchable, unless the group opts out", () => {
    const options = Array.from({ length: SEARCHABLE_OPTION_THRESHOLD }, (_, index) => ({
      value: `w-${index}`,
      label: `Workspace ${index}`,
    }));
    assert.equal(groupIsSearchable({ options }), true);
    assert.equal(groupIsSearchable({ options: options.slice(0, SEARCHABLE_OPTION_THRESHOLD - 1) }), false);
    assert.equal(groupIsSearchable({ options, searchable: false }), false);
    assert.equal(groupIsSearchable({ options: options.slice(0, 2), searchable: true }), true);
  });
});
