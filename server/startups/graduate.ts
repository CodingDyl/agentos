import { STARTUP_STAGES, stageProblems, type Venture } from "../../shared/startup-types";
import { createProject } from "../agentos/mutations/projects";
import { appendDecision, readLater, readScores, readStage, requireVenture, saveVenture, StartupError } from "./store";

/**
 * From venture to workspace, once the MVP contract is agreed.
 *
 * The workspace starts with only the MVP in it: the core workflow under Now,
 * everything out of scope and everything parked under Later. Tasks, roadmap,
 * repository, dev server and workers all come from the workspace from here on.
 */
export async function graduateVenture(slug: string): Promise<Venture> {
  const { venture, revision } = await requireVenture(slug);
  if (venture.workspace) throw new StartupError(`${venture.name} is already the ${venture.workspace} workspace.`, 409);
  if (venture.status === "stopped") throw new StartupError("This venture has stopped.", 409);

  const latest = (await readScores(slug)).at(-1);
  if (!latest?.passed) throw new StartupError("The idea has not passed its validity score.", 409);

  const mvp = (await readStage(slug, "mvp")).content;
  if (!mvp) throw new StartupError("Save the MVP contract first.", 409);
  const problems = stageProblems("mvp", mvp);
  if (problems.length > 0) throw new StartupError(`The MVP contract is missing: ${problems.join(", ")}.`, 409);

  const idea = (await readStage(slug, "idea")).content;
  const later = await readLater(slug);

  const goal = `${idea?.oneLiner || venture.pitch || venture.name} MVP: ${mvp.targetUser} · ${mvp.problem} · success when ${mvp.successMetric}.`;

  const contract = [
    `Target user: ${mvp.targetUser}`,
    `Problem: ${mvp.problem}`,
    "",
    "Core workflow:",
    ...mvp.coreWorkflow.map((step, index) => `${index + 1}. ${step}`),
    "",
    `Success metric: ${mvp.successMetric}`,
    "Kill criteria:",
    ...mvp.killCriteria.map((line) => `- ${line}`),
    "",
    `Timebox: ${mvp.timeboxWeeks} weeks. Validity score ${latest.total}/10.`,
    `Venture file: saas/${slug}/`,
  ].join("\n");

  const created = await createProject({
    name: venture.name,
    goal,
    type: "Product",
    state: "active",
    priority: "high",
    tasks: [
      ...mvp.coreWorkflow.map((title) => ({ title, section: "now" as const })),
      ...mvp.inScope.filter((item) => !mvp.coreWorkflow.includes(item)).map((title) => ({ title, section: "next" as const })),
      ...[...mvp.outOfScope, ...later.map((item) => item.title)].map((title) => ({ title: `(after MVP) ${title}`, section: "later" as const })),
    ],
    decisions: [{ title: "MVP contract", body: contract }],
  });

  const next = STARTUP_STAGES.find((stage) => stage.id === "design")!.id;
  const graduated: Venture = { ...venture, workspace: created.slug, stage: next, status: "building", outcome: "continued" };
  await saveVenture(graduated, revision);
  await appendDecision(slug, { title: "Graduated to a workspace", detail: `Workspace ${created.slug}. Next: ${next}.` });
  return graduated;
}
