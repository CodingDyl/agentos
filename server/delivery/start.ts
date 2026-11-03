import { DeliveryStartSchema, workspaceProspectId, type DeliveryStartInput } from "../../shared/delivery-types";
import { REBUILD_SKILL_ID, type RebuildRun } from "../../shared/website-rebuild-types";
import type { ProjectSummary } from "../../shared/agentos-types";
import { createOrReuseRun, readRun, RebuildError, runForWorkspace, setRunField } from "../website-rebuild/store";

export interface StartDeps {
  projects: () => Promise<ProjectSummary[]>;
  skillEnabled: (skillId: string) => Promise<boolean>;
  skillVersion: () => Promise<string>;
  advance: (runId: string) => void;
}

/**
 * Starts a workspace's delivery, or resumes the rebuild it already has: a
 * workspace never gets a second run, whichever way the first was started.
 */
export async function startDelivery(raw: DeliveryStartInput, deps: StartDeps): Promise<{ run: RebuildRun; created: boolean }> {
  const { workspaceSlug, ...brief } = DeliveryStartSchema.parse(raw);
  const existing = runForWorkspace(workspaceSlug);
  if (existing) {
    deps.advance(existing.id);
    return { run: existing, created: false };
  }
  const project = (await deps.projects()).find((entry) => entry.slug === workspaceSlug);
  if (!project) throw new RebuildError("That workspace does not exist.", 404);
  if (!(await deps.skillEnabled(REBUILD_SKILL_ID))) throw new RebuildError(`The ${REBUILD_SKILL_ID} skill is disabled in Connectors → Skills. Enable it to start a delivery.`);
  const { run, created } = createOrReuseRun({
    ...brief,
    prospectId: workspaceProspectId(workspaceSlug),
    company: project.name,
    skillVersion: await deps.skillVersion(),
  });
  // Linked before the first stage runs, so it reuses this workspace instead of making one from the company name.
  if (created) setRunField(run.id, "workspace_slug", workspaceSlug);
  deps.advance(run.id);
  return { run: readRun(run.id), created };
}
