import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";
import { buildContextPacket, validateJobRequest } from "../context-builder";

/**
 * The context packet is the whole brief a worker receives. Scope is the safety
 * property: a worker that cannot see the rest of the system cannot wander into
 * it, so what this builder leaves out matters as much as what it puts in.
 */

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: "job_abc123",
    worker: "mock",
    status: "queued",
    project: "agentos",
    objective: "Implement the design library masonry grid",
    createdAt: "2026-09-08T10:00:00Z",
    ...overrides,
  };
}

describe("the handoff", () => {
  it("states the project and the objective", () => {
    const packet = buildContextPacket(job());

    assert.match(packet, /Project:\nagentos/);
    assert.match(packet, /Objective:\nImplement the design library masonry grid/);
  });

  it("names only the files it was given", () => {
    const packet = buildContextPacket(
      job({ contextFiles: ["DESIGN.md", "src/features/designs/*"] }),
    );

    assert.match(packet, /- DESIGN\.md/);
    assert.match(packet, /- src\/features\/designs\/\*/);
  });

  it("carries acceptance and validation through verbatim", () => {
    const packet = buildContextPacket(
      job({
        acceptanceCriteria: ["Masonry grid renders", "TypeScript passes"],
        validationCommands: ["npm run build", "npm run lint"],
      }),
    );

    assert.match(packet, /- Masonry grid renders/);
    assert.match(packet, /npm run build\nnpm run lint/);
  });

  it("always carries the standing constraints, even when none were given", () => {
    // A job that forgot to say "stay in the worktree" must still say it.
    const packet = buildContextPacket(job());

    assert.match(packet, /Work only inside the worktree you were given\./);
    assert.match(packet, /Do not modify AgentOS vault files\./);
    assert.match(packet, /Do not commit, push, or change git remotes\./);
  });

  it("keeps the job's own constraints alongside the standing ones", () => {
    const packet = buildContextPacket(
      job({ constraints: ["Follow the AgentOS design system"] }),
    );

    assert.match(packet, /- Follow the AgentOS design system/);
    assert.match(packet, /Do not modify AgentOS vault files\./);
  });

  it("leaves out sections it has nothing for", () => {
    const packet = buildContextPacket(job());

    assert.ok(!packet.includes("Relevant context:"), packet);
    assert.ok(!packet.includes("Acceptance:"), packet);
    assert.ok(!packet.includes("Validation:"), packet);
  });

  it("hands over nothing about the wider system", () => {
    // Everything in the packet came from the job. Nothing reaches into the
    // vault, the portfolio, or any other project.
    const packet = buildContextPacket(job({ contextFiles: ["DESIGN.md"] }));

    assert.ok(!packet.includes("PORTFOLIO"), packet);
    assert.ok(!packet.includes("STATUS.md"), packet);
  });
});

describe("refusing an incomplete job", () => {
  it("accepts a job that says what it is for", () => {
    assert.equal(
      validateJobRequest({ objective: "Do the thing", project: "agentos" }),
      undefined,
    );
  });

  it("refuses a job with no objective", () => {
    assert.match(
      validateJobRequest({ project: "agentos" }) ?? "",
      /needs an objective/,
    );
    assert.match(
      validateJobRequest({ objective: "   ", project: "agentos" }) ?? "",
      /needs an objective/,
    );
  });

  it("refuses a job that belongs to nothing", () => {
    assert.match(
      validateJobRequest({ objective: "Do the thing" }) ?? "",
      /needs a project/,
    );
  });

  it("refuses a repository path that is not a path", () => {
    assert.match(
      validateJobRequest({
        objective: "Do the thing",
        project: "agentos",
        repoPath: 42,
      }) ?? "",
      /must be a path/,
    );
  });
});

describe("a job's skill", () => {
  it("puts the copied instructions in the brief, after the constraints that still win", () => {
    const packet = buildContextPacket({
      ...job(),
      skill: { id: "seo-audit", name: "seo-audit", version: "1.0.1", instructions: "# SEO audit\nCheck titles." },
    });
    assert.match(packet, /\nSkill: seo-audit \(v1\.0\.1\)\n/);
    assert.match(packet, /the constraints win/);
    assert.match(packet, /# SEO audit\nCheck titles\./);
    assert.ok(packet.indexOf("Constraints:") < packet.indexOf("Skill: seo-audit"));
  });

  it("is absent when the job has no skill", () => {
    assert.doesNotMatch(buildContextPacket(job()), /Skill:/);
  });
});
