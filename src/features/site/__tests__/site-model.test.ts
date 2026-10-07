import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkedProjectSite, VercelDeployment } from "@shared/vercel-types";
import { deploymentHealth, displayHost, servingNote } from "../site-model";

const deploy = (id: string, state: string): VercelDeployment => ({ id, url: `${id}.vercel.app`, state, createdAt: "2026-10-01T10:00:00.000Z" });
const site = (production?: VercelDeployment, serving?: VercelDeployment): LinkedProjectSite => ({
  status: "linked",
  projectId: "prj_1",
  projectName: "Chef",
  domains: [],
  production,
  serving,
  checkedAt: "2026-10-07T10:00:00.000Z",
});

describe("the Site tab", () => {
  it("names Vercel's states in the operator's words", () => {
    assert.deepEqual(deploymentHealth("READY"), { label: "Ready", tone: "green", pending: false });
    assert.equal(deploymentHealth("ERROR").label, "Failed");
    assert.equal(deploymentHealth("BUILDING").pending, true);
    assert.equal(deploymentHealth(undefined).label, "Not deployed");
    assert.equal(deploymentHealth("SOMETHING_NEW").label, "Something_new");
  });

  it("shows a host, not a URL", () => {
    assert.equal(displayHost("https://chef.app/"), "chef.app");
  });

  it("says when the URL serves an older deploy than the newest one", () => {
    const ready = deploy("a", "READY");
    assert.equal(servingNote(site(ready, ready), () => "2 days ago"), undefined);
    assert.match(servingNote(site(deploy("b", "ERROR"), ready), () => "2 days ago") ?? "", /previous deploy from 2 days ago/);
    assert.match(servingNote(site(deploy("b", "BUILDING")), () => undefined) ?? "", /Nothing is serving/);
  });
});
