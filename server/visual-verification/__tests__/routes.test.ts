import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VisualAcceptanceContextSchema,
  VisualRouteSchema,
} from "../../../shared/visual-verification-types";

/**
 * A route is where to go *and* which screen must come back.
 *
 * The second half is the whole reason capture is deterministic. This app
 * redirects an unknown path to the dashboard rather than 404ing, so a mistyped
 * route answers 200 and photographs the wrong screen. The schema refuses a
 * route that cannot be checked, and the adapter refuses a context it cannot
 * parse — which is why the console has to refuse to send an incomplete one
 * rather than letting it be dropped in transit.
 */

const viewports = [{ name: "desktop", width: 1440, height: 1000 }];

describe("what a route has to say for itself", () => {
  it("accepts a route that names the page it must render", () => {
    const parsed = VisualRouteSchema.safeParse({
      path: "/designs",
      expectedPageId: "designs",
      viewports,
    });

    assert.equal(parsed.success, true);
  });

  it("refuses a route with no expected page", () => {
    assert.equal(
      VisualRouteSchema.safeParse({ path: "/designs", viewports }).success,
      false,
    );
  });

  it("refuses an expected page that is empty", () => {
    assert.equal(
      VisualRouteSchema.safeParse({
        path: "/designs",
        expectedPageId: "",
        viewports,
      }).success,
      false,
    );
  });

  it("refuses a route with no viewport, which could not be captured", () => {
    assert.equal(
      VisualRouteSchema.safeParse({
        path: "/designs",
        expectedPageId: "designs",
        viewports: [],
      }).success,
      false,
    );
  });

  it("drops a whole context rather than half-reading it", () => {
    // The adapter takes this or nothing. A context parsed leniently would run
    // a browser against routes nobody could check.
    const parsed = VisualAcceptanceContextSchema.safeParse({
      enabled: true,
      routes: [
        { path: "/designs", expectedPageId: "designs", viewports },
        { path: "/workers", viewports },
      ],
    });

    assert.equal(parsed.success, false);
  });

  it("lets a job opt out entirely, with no routes at all", () => {
    const parsed = VisualAcceptanceContextSchema.safeParse({ enabled: false });

    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.success && parsed.data.routes, []);
  });
});
