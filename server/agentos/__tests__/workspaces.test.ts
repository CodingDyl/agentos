import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

/**
 * Step 59: workspaces as a presentation layer over projects — the type and
 * module model, the two new configuration lines, capture, and Knowledge.
 * Same throwaway-vault approach as the mutation tests: these are claims about
 * what ends up in files.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));

process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const {
  deriveWorkspaceType,
  moduleLabel,
  parseModuleList,
  resolveWorkspaceTabs,
  resolveWorkspaceType,
  WORKSPACE_MODULES,
} = await import("../../../shared/workspace");
const { applyConfiguration, mergeConfiguration, parseConfiguration } = await import("../mutations/configuration");
const { appendCapture, captureLine, captureNote, parseCaptures } = await import("../capture");
const { getKnowledge } = await import("../knowledge");
const { getProjects } = await import("../projects");

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

function write(relative: string, contents: string) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

describe("workspace types", () => {
  it("derives a type only from an exact portfolio label", () => {
    assert.equal(deriveWorkspaceType("Product"), "product");
    assert.equal(deriveWorkspaceType("  software "), "software");
    assert.equal(deriveWorkspaceType("Client Work"), "client");
    // Ambiguous labels are never guessed at.
    assert.equal(deriveWorkspaceType("Agency / Client Work"), "general");
    assert.equal(deriveWorkspaceType("AI SaaS"), "general");
    assert.equal(deriveWorkspaceType(undefined), "general");
  });

  it("lets a configured type win over the portfolio label", () => {
    assert.equal(resolveWorkspaceType("business", "Agency / Client Work"), "business");
    assert.equal(resolveWorkspaceType(undefined, "Product"), "product");
  });
});

describe("workspace tabs", () => {
  it("keeps Repository and Agents out of a business workspace's tabs, but under More", () => {
    const tabs = resolveWorkspaceTabs({ type: "business" });

    assert.ok(tabs.primary.includes("clients"));
    assert.ok(!tabs.primary.includes("repository"));
    assert.ok(!tabs.primary.includes("agents"));
    assert.ok(tabs.more.includes("repository"));
    assert.ok(tabs.more.includes("agents"));
  });

  it("puts Repository and Agents up front for software", () => {
    const tabs = resolveWorkspaceTabs({ type: "software" });

    assert.ok(tabs.primary.includes("repository"));
    assert.ok(tabs.primary.includes("agents"));
  });

  it("gives a linked repository a tab without configuration", () => {
    const tabs = resolveWorkspaceTabs({ type: "client", hasRepository: true });
    assert.ok(tabs.primary.includes("repository"));
    assert.ok(!tabs.more.includes("repository"));
  });

  it("uses configured modules wholesale, in order, and never loses a module", () => {
    const tabs = resolveWorkspaceTabs({ type: "software", configured: ["documents", "tasks"], hasRepository: true });

    assert.deepEqual(tabs.primary, ["documents", "tasks"]);
    // Every module but Website rebuild, which only a workspace with a rebuild ever shows.
    assert.equal(tabs.primary.length + tabs.more.length, WORKSPACE_MODULES.length - 1);
    assert.ok(![...tabs.primary, ...tabs.more].includes("rebuild"));
  });

  it("puts a client rebuild first, and only when the workspace has one", () => {
    const tabs = resolveWorkspaceTabs({ type: "client", hasRebuild: true });
    assert.equal(tabs.primary[0], "rebuild");
    assert.equal(tabs.primary.length + tabs.more.length, WORKSPACE_MODULES.length);
    // Configured modules still get it: the tab follows the rebuild, not the settings.
    assert.equal(resolveWorkspaceTabs({ type: "client", configured: ["tasks"], hasRebuild: true }).primary[0], "rebuild");
  });

  it("gives a linked Vercel project the Site tab, before Decisions", () => {
    const tabs = resolveWorkspaceTabs({ type: "client", hasSite: true });
    assert.equal(tabs.primary[tabs.primary.indexOf("decisions") - 1], "site");
    assert.ok(resolveWorkspaceTabs({ type: "client" }).more.includes("site"));
  });

  it("calls a client's roadmap Milestones", () => {
    assert.equal(moduleLabel("roadmap", "client"), "Milestones");
    assert.equal(moduleLabel("roadmap", "product"), "Roadmap");
  });

  it("parses a hand-written module list tolerantly", () => {
    assert.deepEqual(parseModuleList("Tasks, designs; repo, nonsense, tasks"), ["tasks", "creative", "repository"]);
  });
});

describe("workspace configuration lines", () => {
  const project = `# Virtara

## Purpose

An agency.

## Configuration

Workspace type: Business
Modules: tasks, clients, documents
Worker preference: auto
`;

  it("reads the type and modules from Configuration", () => {
    const config = parseConfiguration(project);

    assert.equal(config.workspaceType, "business");
    assert.deepEqual(config.modules, ["tasks", "clients", "documents"]);
  });

  it("ignores an unknown type rather than guessing", () => {
    assert.equal(parseConfiguration(project.replace("Business", "Conglomerate")).workspaceType, undefined);
  });

  it("writes them back and clears them with an empty patch", () => {
    const merged = mergeConfiguration(parseConfiguration(project), { workspaceType: "client", modules: ["tasks"] });
    const written = applyConfiguration(project, merged);

    assert.match(written, /^Workspace type: client$/m);
    assert.match(written, /^Modules: tasks$/m);
    assert.match(written, /^## Purpose\n\nAn agency\.$/m);

    const cleared = mergeConfiguration(merged, { workspaceType: "", modules: [] });
    assert.equal(cleared.workspaceType, undefined);
    assert.equal(cleared.modules, undefined);
    assert.doesNotMatch(applyConfiguration(written, cleared), /Workspace type|Modules/);
  });

  it("does not grow a Configuration section on a project that never had one", () => {
    const plain = "# Thing\n\n## Purpose\n\nStuff.\n";
    assert.equal(applyConfiguration(plain, parseConfiguration(plain)), plain);
  });
});

describe("capture", () => {
  it("tags a workspace at the end, leaving brackets to Hermes' kinds", () => {
    assert.equal(captureLine("  Update   checkout copy ", "Story Keeper"), "- Update checkout copy (for Story Keeper)");
    assert.equal(captureLine("Book the car service"), "- Book the car service");
  });

  it("appends to the end of the Inbox section without touching what follows", () => {
    const before = "# Capture Inbox\n\n## Inbox\n\n- [Decision] Keep Hermes central\n\n## Processed\n\n- old\n";
    const after = appendCapture(before, "- New thing");

    assert.equal(after, "# Capture Inbox\n\n## Inbox\n\n- [Decision] Keep Hermes central\n- New thing\n\n## Processed\n\n- old\n");
  });

  it("creates the section, or the file, when it is missing", () => {
    assert.match(appendCapture("# Capture\n\nNotes.\n", "- A"), /## Inbox\n\n- A\n$/);
    assert.match(appendCapture(undefined, "- A"), /^# Capture Inbox[\s\S]*## Inbox\n\n- A\n$/);
  });

  it("reads kinds and workspaces back out", () => {
    const items = parseCaptures("# C\n\n## Inbox\n\n- [Decision] Keep Hermes central\n- Fix copy (for Story Keeper)\n- Plain\n");

    assert.deepEqual(items, [
      { text: "Keep Hermes central", kind: "Decision" },
      { text: "Fix copy", workspace: "Story Keeper" },
      { text: "Plain" },
    ]);
  });

  it("writes through the vault writer with an undo", async () => {
    write("inbox/CAPTURE.md", "# Capture Inbox\n\n## Inbox\n\n- First\n");
    const result = await captureNote("Second", "Pantry Pilot");

    assert.equal(result.line, "- Second (for Pantry Pilot)");
    assert.ok(result.undoId);
    assert.match(fs.readFileSync(path.join(root, "inbox/CAPTURE.md"), "utf8"), /- First\n- Second \(for Pantry Pilot\)\n$/);
  });
});

describe("knowledge", () => {
  it("lists documents and decisions across workspaces, pointing at the workspace viewer", async () => {
    write(
      "projects/PORTFOLIO.md",
      "# Portfolio\n\n## Projects\n\n### Pantry Pilot\nType: Product\nState: Active\nPriority: High\n\n### Virtara\nType: Agency / Client Work\nState: Active\nPriority: Medium\n",
    );
    write("projects/pantry-pilot/PROJECT.md", "# Pantry Pilot\n\n## Purpose\n\nFood.\n");
    write(
      "projects/pantry-pilot/artifacts/PP-002/report.md",
      "---\ntitle: Tech debt report\ntype: report\nsource: claude\ntask: PP-002\n---\n\n# Tech debt\n",
    );
    write("projects/virtara/PROJECT.md", "# Virtara\n\n## Configuration\n\nWorkspace type: business\n");
    write("projects/virtara/DECISIONS.md", "# Decisions\n\n## Pricing\n\nFixed-price quotes only.\n");

    const projects = await getProjects("all");
    assert.equal(projects.find((project) => project.slug === "virtara")?.workspaceType, "business");
    assert.equal(projects.find((project) => project.slug === "pantry-pilot")?.workspaceType, "product");

    const knowledge = await getKnowledge(projects);
    const report = knowledge.items.find((item) => item.title === "Tech debt report");
    const decision = knowledge.items.find((item) => item.kind === "decision");

    assert.equal(report?.projectName, "Pantry Pilot");
    assert.equal(report?.source, "claude");
    assert.equal(report?.taskId, "PP-002");
    assert.equal(report?.href, "/workspaces/pantry-pilot?tab=documents&doc=projects%2Fpantry-pilot%2Fartifacts%2FPP-002%2Freport.md");
    assert.equal(decision?.title, "Pricing");
    assert.equal(decision?.href, "/workspaces/virtara?tab=decisions");
    // "No repository linked" is not a failure worth reporting.
    assert.deepEqual(knowledge.unavailable, []);
  });
});
