import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectSummary } from "../../../shared/agentos-types";
import type { CaseStudy } from "../../../shared/traction-types";
import type { VirtecSnapshot } from "../../../shared/virtec-types";
import { buildDraftPacket, buildOpportunities, caseStudyQueueItems, readDraft } from "../case-studies";
import { buildQueue } from "../engine";

function snapshot(overrides: Partial<VirtecSnapshot> = {}): VirtecSnapshot {
  return { configured: true, leads: [], clients: [], quotes: [], projects: [], followUps: [], ...overrides };
}

const study: CaseStudy = {
  id: "cs_1",
  title: "Vaja — 3D Configurator",
  client: "Vaja",
  status: "draft",
  missing: [],
  createdAt: "",
  updatedAt: "",
};

describe("buildOpportunities", () => {
  it("raises finished Virtec projects and completed workspaces, once", () => {
    const opportunities = buildOpportunities(
      snapshot({
        projects: [
          { id: "p2", clientName: "Story Keeper", completion: 100 },
          { id: "p1", clientName: "Vaja", projectType: "3D Configurator", status: "completed", amount: 120000 },
          { id: "p6", clientName: "PL Steel", projectType: "Maintenance", status: "completed", amount: 0 },
          { id: "p3", clientName: "Still going", completion: 60, status: "active" },
          { id: "p4", clientName: "Written up", status: "completed" },
          { id: "p5", clientName: "Waved away", status: "completed" },
        ],
      }),
      [
        { slug: "pantry-pilot", name: "Pantry Pilot", state: "completed" } as ProjectSummary,
        { slug: "live-one", name: "Live", state: "active" } as ProjectSummary,
      ],
      [{ ...study, source: "virtec:project:p4" }],
      ["virtec:project:p5"],
    );

    assert.deepEqual(
      opportunities.map((opportunity) => opportunity.source),
      ["virtec:project:p1", "virtec:project:p2", "workspace:pantry-pilot"],
    );
    assert.equal(opportunities[2].workspace, "pantry-pilot");
  });

  it("leaves out maintenance retainers and never shows R 0", () => {
    const [only] = buildOpportunities(
      snapshot({ projects: [{ id: "m", clientName: "PL Steel", projectType: "Maintenance", status: "completed" }, { id: "w", clientName: "Aureya", projectType: "Full Website Build", status: "completed", amount: 0 }] }),
      [],
      [],
      [],
    );
    assert.equal(only.source, "virtec:project:w");
    assert.equal(only.detail.includes("R 0"), false);
  });

  it("queues one case study a day, and the next one once today's is snoozed", () => {
    const opportunities = buildOpportunities(
      snapshot({ projects: [{ id: "a", clientName: "A", status: "completed", amount: 100 }, { id: "b", clientName: "B", status: "completed", amount: 50 }] }),
      [],
      [],
      [],
    );
    const items = caseStudyQueueItems(opportunities);
    assert.deepEqual(buildQueue([], [], "2026-09-28", [], [], items).map((item) => item.id), ["case_study:virtec:project:a"]);
    assert.deepEqual(
      buildQueue([], [{ itemId: "case_study:virtec:project:a", until: "2026-09-29" }], "2026-09-28", [], [], items).map((item) => item.id),
      ["case_study:virtec:project:b"],
    );
  });

  it("puts opportunities in the queue after the money work", () => {
    const [opportunity] = buildOpportunities(snapshot({ projects: [{ id: "p1", clientName: "Vaja", status: "completed" }] }), [], [], []);
    const queue = buildQueue([], [], "2026-09-28", [], [], caseStudyQueueItems([opportunity]));

    assert.equal(queue[0].id, "case_study:virtec:project:p1");
    assert.equal(queue[0].title, "Start a case study — Vaja");
    assert.deepEqual(buildQueue([], [{ itemId: "case_study:virtec:project:p1", until: "2026-09-29" }], "2026-09-28", [], [], caseStudyQueueItems([opportunity])), []);
  });
});

describe("the Hermes packet", () => {
  it("carries what was delivered but never what the client paid", () => {
    const packet = buildDraftPacket({
      study,
      offers: [],
      virtecProject: { id: "p1", projectType: "3D Configurator", amount: 120000, serviceSku: "care" },
      virtecQuote: { id: "q1", features: ["Real-time 3D preview", "Colour options"], totalAmount: 120000 },
    });

    assert.match(packet, /Real-time 3D preview/);
    assert.match(packet, /\[NEEDS DATA/);
    assert.match(packet, /Never write the testimonial/);
    assert.equal(packet.includes("120000") || packet.includes("120 000"), false);
  });
});

describe("readDraft", () => {
  it("keeps the sections and the missing list, and drops what is not text", () => {
    const draft = readDraft({ title: "Configurator doubled enquiries", problem: "p", result: 42, missing: ["Enquiry numbers", 7] });
    assert.equal(draft?.problem, "p");
    assert.equal(draft?.result, undefined);
    assert.deepEqual(draft?.missing, ["Enquiry numbers"]);
  });

  it("is no draft at all without a section", () => {
    assert.equal(readDraft({ title: "only a title", missing: [] }), undefined);
    assert.equal(readDraft("nope"), undefined);
  });
});
