import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTree, flatten } from "../file-tree-model";

const notes = [
  { id: "projects/b/PROJECT.md", title: "B" },
  { id: "projects/a/TASKS.md", title: "A tasks" },
  { id: "projects/a/PROJECT.md", title: "A" },
  { id: "README.md", title: "Readme" },
];

describe("file tree", () => {
  it("nests folders, sorts them, and counts every note beneath", () => {
    const tree = buildTree(notes);
    assert.equal(tree.count, 4);
    assert.deepEqual(tree.folders.map((folder) => folder.name), ["projects"]);
    assert.deepEqual(tree.folders[0].folders.map((folder) => [folder.name, folder.count]), [["a", 2], ["b", 1]]);
    assert.deepEqual(tree.notes.map((note) => note.name), ["README"]);
  });

  it("shows only open folders, unless everything is shown for a search", () => {
    const tree = buildTree(notes);
    assert.deepEqual(flatten(tree, new Set(), false).map((row) => row.key), ["folder:projects", "note:README.md"]);
    assert.deepEqual(
      flatten(tree, new Set(["projects", "projects/a"]), false).map((row) => row.key),
      ["folder:projects", "folder:projects/a", "note:projects/a/PROJECT.md", "note:projects/a/TASKS.md", "folder:projects/b", "note:README.md"],
    );
    assert.equal(flatten(tree, new Set(), true).length, 7, "3 folders and 4 notes");
  });
});
