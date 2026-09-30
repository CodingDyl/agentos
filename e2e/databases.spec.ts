import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_VAULT } from "../playwright.config";

/**
 * Supabase setups and the workspace Database tab, against a tiny fake of
 * PostgREST on loopback: one `recipes` table with an integer primary key.
 * Enough to prove add → link → browse → insert → edit, and that deletes are
 * refused until turned on.
 */

type Row = { id: number; title: string; servings: number | null };
let rows: Row[] = [];
let server: http.Server;
let base = "";
let seenKey = "";

const SPEC = {
  definitions: {
    recipes: {
      required: ["id", "title"],
      properties: {
        id: { type: "integer", format: "bigint", description: "<pk/>", default: "nextval" },
        title: { type: "string", format: "text" },
        servings: { type: "integer", format: "integer" },
      },
    },
  },
};

test.beforeAll(async () => {
  rows = [
    { id: 1, title: "Tomato soup", servings: 2 },
    { id: 2, title: "Lentil stew", servings: 4 },
  ];
  server = http.createServer((request, response) => {
    seenKey = String(request.headers.apikey ?? "");
    const url = new URL(request.url ?? "/", "http://x");
    const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
    const matched = idFilter ? rows.filter((row) => String(row.id) === idFilter) : rows;
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const send = (status: number, payload: unknown, total?: number) => {
        response.writeHead(status, { "content-type": "application/json", ...(total === undefined ? {} : { "content-range": `*/${total}` }) });
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(payload));
      };
      if (url.pathname === "/rest/v1/") return send(200, SPEC);
      if (url.pathname !== "/rest/v1/recipes") return send(404, { message: "no such table" });
      if (request.method === "HEAD") return send(200, null, matched.length);
      if (request.method === "GET") return send(200, matched, matched.length);
      if (request.method === "POST") {
        const row = { id: rows.length + 1, servings: null, ...(JSON.parse(body) as Partial<Row>) } as Row;
        rows.push(row);
        return send(201, [row]);
      }
      if (request.method === "PATCH") {
        for (const row of matched) Object.assign(row, JSON.parse(body));
        return send(200, matched);
      }
      return send(405, { message: "not in this fake" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

test("a Supabase setup is added, linked, browsed and edited from its workspace", async ({ page }) => {
  await page.goto("/connectors/supabase");
  await page.getByRole("button", { name: "Add database" }).click();

  const form = page.getByRole("form", { name: "Add database" });
  await form.locator('input[name="name"]').fill("Pantry Pilot");
  await form.locator('input[name="environment"]').fill("production");
  await form.locator('input[name="url"]').fill(base);
  await form.locator('input[name="key"]').fill("sb_secret_e2e");
  await form.getByText("Pantry Pilot", { exact: true }).click();
  await form.locator('input[name="key"]').press("Enter");

  const databases = page.getByRole("region", { name: "Databases" });
  await expect(databases.getByText("Connected. 1 table visible.", { exact: false })).toBeVisible();
  expect(seenKey).toBe("sb_secret_e2e");
  expect(fs.readFileSync(path.join(path.dirname(E2E_VAULT), ".env"), "utf8")).toContain("SUPABASE_KEY__PANTRY_PILOT_PRODUCTION=sb_secret_e2e");
  expect(await page.content()).not.toContain("sb_secret_e2e");

  // The link earns the workspace a Database tab.
  await databases.getByRole("link", { name: "Pantry Pilot" }).click();
  await expect(page).toHaveURL(/\/workspaces\/pantry-pilot\?tab=database/);
  await expect(page.getByRole("tab", { name: "Database" })).toBeVisible();

  const grid = page.getByRole("region", { name: "Rows in recipes" });
  await expect(grid.getByText("Lentil stew")).toBeVisible();

  // Insert.
  await grid.getByRole("button", { name: "Add row" }).click();
  const insert = page.getByRole("form", { name: "New row in recipes" });
  await insert.locator('input[name="title"]').fill("Pea risotto");
  await insert.locator('input[name="servings"]').fill("3");
  await insert.getByRole("button", { name: "Insert row" }).click();
  await expect(grid.getByText("Pea risotto")).toBeVisible();
  expect(rows.find((row) => row.title === "Pea risotto")?.servings).toBe(3);

  // Edit: only the changed field is sent.
  await grid.getByRole("button", { name: "Edit row" }).first().click();
  const edit = page.getByRole("form", { name: "Edit row in recipes" });
  await expect(edit.locator('input[name="id"]')).toBeDisabled();
  await edit.locator('input[name="title"]').fill("Roast tomato soup");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(grid.getByText("Roast tomato soup")).toBeVisible();

  // Delete is off by default, and says where to change that.
  await grid.getByRole("button", { name: "Delete row" }).first().click();
  await grid.getByRole("button", { name: "Delete?" }).click();
  await expect(page.getByText(/turned off for Supabase/)).toBeVisible();
  expect(rows).toHaveLength(3);
});
