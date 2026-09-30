import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseColumn, DatabaseTable } from "@shared/database-types";
import { buildChanges, coerce, formatCell, pageLabel, rowKey, setupIdFrom } from "../database-model";

const column = (overrides: Partial<DatabaseColumn>): DatabaseColumn => ({
  name: "c",
  type: "string",
  primaryKey: false,
  required: false,
  hasDefault: false,
  ...overrides,
});

const recipes: DatabaseTable = {
  name: "recipes",
  primaryKey: ["id"],
  columns: [
    column({ name: "id", type: "integer", primaryKey: true, required: true, hasDefault: true }),
    column({ name: "title", required: true }),
    column({ name: "servings", type: "integer" }),
    column({ name: "tags", type: "array", format: "jsonb" }),
    column({ name: "vegan", type: "boolean" }),
  ],
};

describe("the Database tab", () => {
  it("makes a setup id that is also a valid variable suffix", () => {
    assert.equal(setupIdFrom("Pantry Pilot production"), "pantry-pilot-production");
    assert.equal(setupIdFrom("2024 archive"), "db-2024-archive");
  });

  it("says NULL rather than showing a blank, and trims long values", () => {
    assert.deepEqual(formatCell(null), { text: "NULL", isNull: true });
    assert.equal(formatCell({ a: 1 }).text, '{"a":1}');
    assert.equal(formatCell("x".repeat(200)).text.length, 80);
  });

  it("types what was typed, and refuses what isn't", () => {
    assert.deepEqual(coerce(column({ type: "integer" }), "12", "insert"), { kind: "value", value: 12 });
    assert.equal(coerce(column({ type: "integer" }), "1.5", "insert").kind, "error");
    assert.deepEqual(coerce(column({ type: "boolean" }), "false", "insert"), { kind: "value", value: false });
    assert.deepEqual(coerce(column({ type: "array", format: "jsonb" }), '["a"]', "insert"), { kind: "value", value: ["a"] });
    assert.equal(coerce(column({ format: "jsonb", type: "object" }), "{nope", "insert").kind, "error");
  });

  it("leaves an empty field out of an insert, and sets NULL on an update only where allowed", () => {
    assert.deepEqual(coerce(column({}), "", "insert"), { kind: "omit" });
    assert.equal(coerce(column({ required: true }), "", "insert").kind, "error");
    assert.deepEqual(coerce(column({ required: true, hasDefault: true }), "", "insert"), { kind: "omit" });
    assert.deepEqual(coerce(column({}), "", "update"), { kind: "value", value: null });
    assert.equal(coerce(column({ required: true }), "", "update").kind, "error");
  });

  it("sends only what changed on an update, never the key", () => {
    const original = { id: 7, title: "Soup", servings: 2, tags: ["a"], vegan: true };
    const draft = { id: "999", title: "Soup", servings: "4", tags: '[\n  "a"\n]', vegan: "true" };
    assert.deepEqual(buildChanges(recipes, draft, "update", original), { values: { servings: 4 }, errors: [] });
  });

  it("collects every problem on an insert rather than sending half a row", () => {
    const { errors } = buildChanges(recipes, { title: "", servings: "two" }, "insert");
    assert.deepEqual(errors, ["title is required.", "servings must be a whole number."]);
  });

  it("names a row by its primary key", () => {
    assert.deepEqual(rowKey(recipes, { id: 7, title: "Soup" }), { id: 7 });
    assert.equal(rowKey({ ...recipes, primaryKey: [] }, { id: 7 }), undefined);
  });

  it("labels the page", () => {
    assert.equal(pageLabel(0, 50, 1204), "1–50 of 1,204");
    assert.equal(pageLabel(50, 13, undefined), "51–63");
    assert.equal(pageLabel(0, 0, 0), "No rows");
  });
});
