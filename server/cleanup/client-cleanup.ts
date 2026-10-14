import path from "node:path";
import {
  CLEANUP_AFTER_DAYS,
  REMOTE_ITEMS,
  type CleanupCandidate,
  type CleanupItem,
  type CleanupItemId,
  type CleanupPreview,
  type CleanupRequest,
  type CleanupResult,
} from "../../shared/client-cleanup";
import type { Prospect, TractionEvent } from "../../shared/traction-types";
import { agentOSRoot } from "../agentos/filesystem";
import { decide } from "../connectors/policy";
import { computeFollowUps } from "../outreach/follow-ups";
import { latestReply } from "../outreach/replies";
import { readEvents, readState, TractionNotFoundError, updateProspect, type TractionState } from "../traction/store";
import { REPORT_DIR } from "../website-rebuild/reports";
import { clientSitesDir, git as runGit } from "../website-rebuild/client-repo";
import * as publishApi from "../website-rebuild/publish";
import { deleteRunRecords, runForProspect, runIsActive, runLogged } from "../website-rebuild/store";
import type { RebuildRun } from "../../shared/website-rebuild-types";
import { listFilesOutside, measureDirectory, removeInside, resolveInside, UnsafePathError } from "./safe-fs";

/**
 * Cleaning up what was built for a business that never showed interest: the
 * client site folder, the workspace, AgentOS's own rebuild history, and (only
 * if you tick them) the GitHub repository and Vercel project.
 *
 * Three rules, in order of importance:
 *
 * 1. Nothing is deleted that AgentOS cannot show it made for this rebuild. The
 *    rebuild REUSES a repo, project, folder or workspace of the same name when
 *    one exists, and that could be a real client's. Each item is checked
 *    against what the run logged and what the owner (GitHub, Vercel, git)
 *    says about when it was created, and refused when it does not hold up.
 * 2. Everything is previewed first, and the work is checked again at the
 *    moment of deleting, not trusted from the preview.
 * 3. The business's record and every email sent to them always stay.
 *
 * Remote deletions need the company's name typed, and the connector's
 * "Delete" capability switched on in Connectors.
 */

export class CleanupError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 | 503 = 409,
  ) {
    super(message);
  }
}

export interface CleanupDeps {
  now: () => Date;
  vaultRoot: () => string;
  clientSitesRoot: () => string;
  git: (repo: string, args: readonly string[]) => Promise<string>;
  publish: Pick<typeof publishApi, "inspectGithubRepo" | "deleteGithubRepo" | "inspectVercelProject" | "deleteVercelProject">;
  /** Whether the connector's own switch lets this capability run (it is off by default). */
  capabilityAllowed: (capability: string) => string | undefined;
}

export const defaultCleanupDeps: CleanupDeps = {
  now: () => new Date(),
  vaultRoot: () => agentOSRoot(),
  clientSitesRoot: () => clientSitesDir(),
  git: runGit,
  publish: publishApi,
  capabilityAllowed: (capability) => {
    const decision = decide(capability, "person");
    return decision.allowed ? undefined : decision.reason;
  },
};

const DAY = 86_400_000;
const lower = (value: string) => value.trim().toLowerCase();
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A tolerance for clocks: a thing "made for this run" can be stamped a moment before the run row. */
const SLACK_MS = 60_000;
const SHOWED_INTEREST = new Set(["conversation", "proposal", "won"]);

// ─── Who qualifies ──────────────────────────────────────────────────────────

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  /** One line on why it qualifies, when it does. */
  qualifiedBecause?: string;
}

/**
 * A business qualifies when it never showed interest: emailed all three times
 * with no answer for at least 14 days, or closed without ever answering. Any
 * reply, any move to conversation or beyond, a Virtec client link, or a rebuild
 * still running rules it out for good.
 */
export function cleanupEligibility(input: { prospect: Prospect; state: TractionState; events: readonly TractionEvent[]; now: Date; rebuildActive: boolean }): Eligibility {
  const { prospect, state, events, now } = input;
  const reasons: string[] = [];

  if (prospect.stage !== "contacted" && prospect.stage !== "lost") {
    reasons.push(`They are in ${prospect.stage}. Clean-up is only for businesses that never showed interest.`);
  }
  if (events.some((event) => event.prospectId === prospect.id && event.kind === "stage_changed" && event.to && SHOWED_INTEREST.has(event.to))) {
    reasons.push("At some point they were in conversation, or further. That is interest, so their work is kept.");
  }
  // Any reply, in the outreach mailbox or your own Titan inbox, at any time.
  if (latestReply(state, prospect)) {
    reasons.push("They have written back. Their work is kept.");
  }
  if (prospect.crmId?.startsWith("virtec:client:")) reasons.push("They are a client in Virtec.");
  if (input.rebuildActive) reasons.push("A rebuild for them is still running. Let it finish or stop it first.");

  let qualifiedBecause: string | undefined;
  if (prospect.stage === "contacted") {
    const row = computeFollowUps(state, now).find((candidate) => candidate.prospectId === prospect.id);
    if (!row || row.state !== "quiet") {
      reasons.push(row?.state === "stopped" ? "They opted out or the address bounced; close them first." : "They are still in the follow-up sequence. Clean-up waits until all three emails have gone unanswered.");
    } else {
      const eligibleAt = Date.parse(row.lastAt) + CLEANUP_AFTER_DAYS * DAY;
      if (now.getTime() < eligibleAt) reasons.push(`Wait until ${new Date(eligibleAt).toISOString().slice(0, 10)}: ${CLEANUP_AFTER_DAYS} days after the last email.`);
      else qualifiedBecause = `All three emails went unanswered, the last one ${Math.floor((now.getTime() - Date.parse(row.lastAt)) / DAY)} days ago.`;
    }
  } else if (prospect.stage === "lost") {
    qualifiedBecause = "Closed, and they never showed interest.";
  }

  return { eligible: reasons.length === 0, reasons, qualifiedBecause };
}

/** Businesses whose work could be cleaned up. No sizes: cheap enough to list. */
export async function listCleanupCandidates(deps: CleanupDeps = defaultCleanupDeps): Promise<CleanupCandidate[]> {
  const [state, events] = await Promise.all([readState(), readEvents()]);
  const now = deps.now();
  const candidates: CleanupCandidate[] = [];

  for (const prospect of state.prospects) {
    const run = runForProspect(prospect.id);
    if (!run && !prospect.workspace) continue;
    const verdict = cleanupEligibility({ prospect, state, events, now, rebuildActive: run ? runIsActive(run.id) : false });
    if (!verdict.eligible) continue;
    candidates.push({ prospectId: prospect.id, company: prospect.company, stage: prospect.stage, reason: verdict.qualifiedBecause ?? "Never showed interest.", workspaceSlug: run?.workspaceSlug ?? prospect.workspace });
  }
  return candidates.sort((a, b) => a.company.localeCompare(b.company));
}

// ─── What exists, and whether AgentOS made it ───────────────────────────────

interface Target {
  root: string;
  path: string;
}

interface Inspection {
  items: CleanupItem[];
  targets: Partial<Record<"local_site" | "workspace", Target>>;
  /** The workspace folder itself was made for this rebuild, so the whole folder goes. */
  wholeWorkspace: boolean;
}

const item = (partial: Partial<CleanupItem> & Pick<CleanupItem, "id" | "label" | "location" | "state">): CleanupItem => ({
  warnings: [],
  remote: REMOTE_ITEMS.includes(partial.id),
  defaultChecked: !REMOTE_ITEMS.includes(partial.id) && partial.state === "ready",
  ...partial,
});

/** A refusal from `resolveInside`, as the state it means. */
function pathProblem(error: unknown): { state: "unavailable" | "not_found" | "blocked"; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UnsafePathError) {
    if (/is not there/.test(message)) return { state: "unavailable", reason: message };
    if (/does not exist/.test(message)) return { state: "not_found", reason: "Already gone." };
  }
  return { state: "blocked", reason: message };
}

async function inspectLocalSite(run: RebuildRun | undefined, deps: CleanupDeps): Promise<{ item: CleanupItem; target?: Target }> {
  const label = "Site folder on your drive";
  if (!run?.repoPath) return { item: item({ id: "local_site", label, location: "none recorded", state: "not_found", reason: "No site folder was made for them." }) };

  const root = deps.clientSitesRoot();
  let proven: string;
  try {
    proven = await resolveInside(root, run.repoPath);
  } catch (error) {
    return { item: item({ id: "local_site", label, location: run.repoPath, ...pathProblem(error) }) };
  }

  // The rebuild reuses a folder that is already there. Only one AgentOS began (its own first commit, after this run started) is its to delete.
  let roots: string[];
  try {
    roots = (await deps.git(proven, ["log", "--max-parents=0", "--format=%an|%aI"])).split("\n").filter(Boolean);
  } catch {
    return { item: item({ id: "local_site", label, location: proven, state: "blocked", reason: "It is not a git repository AgentOS made, so it will not be deleted." }) };
  }
  const madeByThisRun = roots.some((line) => {
    const [author, date] = line.split("|");
    return author === "AgentOS" && Date.parse(date) >= Date.parse(run.createdAt) - SLACK_MS;
  });
  if (!madeByThisRun) {
    return { item: item({ id: "local_site", label, location: proven, state: "blocked", reason: "Its first commit is not one AgentOS made for this rebuild, so this folder existed before it. It will not be deleted." }) };
  }

  const warnings: string[] = [];
  try {
    const changed = (await deps.git(proven, ["status", "--porcelain"])).split("\n").filter(Boolean).length;
    if (changed > 0) warnings.push(`${changed} file${changed === 1 ? " has" : "s have"} changes that are not saved in git.`);
  } catch {
    // Not knowing is not a reason to refuse: the folder is proven to be AgentOS's.
  }
  const size = await measureDirectory(proven);
  return { item: item({ id: "local_site", label, location: proven, state: "ready", bytes: size.bytes, files: size.files, approximate: size.approximate, warnings }), target: { root, path: proven } };
}

async function inspectWorkspace(run: RebuildRun | undefined, prospect: Prospect, deps: CleanupDeps): Promise<{ item: CleanupItem; target?: Target; whole: boolean }> {
  const slug = run?.workspaceSlug ?? prospect.workspace;
  const label = "Workspace";
  if (!slug) return { item: item({ id: "workspace", label, location: "none recorded", state: "not_found", reason: "No workspace was made for them." }), whole: false };
  if (!SLUG.test(slug)) return { item: item({ id: "workspace", label, location: slug, state: "blocked", reason: "The workspace name is not one AgentOS makes, so it will not be deleted." }), whole: false };

  const projects = path.join(deps.vaultRoot(), "projects");
  const workspaceDir = path.join(projects, slug);
  let provenWorkspace: string;
  try {
    provenWorkspace = await resolveInside(projects, workspaceDir);
  } catch (error) {
    return { item: item({ id: "workspace", label: `${label} “${slug}”`, location: workspaceDir, ...pathProblem(error) }), whole: false };
  }

  // The rebuild reuses a workspace that is already there. A real engagement's workspace is never this clean-up's to delete.
  const created = run ? runLogged(run.id, "Created the workspace %") : false;
  if (created) {
    const outside = await listFilesOutside(provenWorkspace, [REPORT_DIR, "PROJECT.md"]);
    const warnings = outside.total > 0 ? [`It also holds ${outside.total} file${outside.total === 1 ? "" : "s"} that are not rebuild reports${outside.examples.length > 0 ? ` (for example ${outside.examples.join(", ")})` : ""}. They go too.`] : [];
    const size = await measureDirectory(provenWorkspace);
    return { item: item({ id: "workspace", label: `Workspace “${slug}” (made for this rebuild)`, location: provenWorkspace, state: "ready", bytes: size.bytes, files: size.files, approximate: size.approximate, warnings }), target: { root: projects, path: provenWorkspace }, whole: true };
  }

  const reports = path.join(provenWorkspace, REPORT_DIR);
  let provenReports: string;
  try {
    provenReports = await resolveInside(provenWorkspace, reports);
  } catch (error) {
    const problem = pathProblem(error);
    return { item: item({ id: "workspace", label: `Rebuild reports in “${slug}”`, location: reports, ...problem, reason: problem.state === "not_found" ? "The workspace was already there and has no rebuild reports to clean up." : problem.reason }), whole: false };
  }
  const size = await measureDirectory(provenReports);
  return {
    item: item({
      id: "workspace",
      label: `Rebuild reports and screenshots in “${slug}”`,
      location: provenReports,
      state: "ready",
      bytes: size.bytes,
      files: size.files,
      approximate: size.approximate,
      warnings: [`The workspace “${slug}” existed before the rebuild, so it is kept. Only the rebuild's own reports go.`],
    }),
    target: { root: provenWorkspace, path: provenReports },
    whole: false,
  };
}

async function inspectGithub(run: RebuildRun | undefined, deps: CleanupDeps): Promise<CleanupItem> {
  const label = "GitHub repository";
  if (!run?.githubRepo) return item({ id: "github_repo", label, location: "none recorded", state: "not_found", reason: "Nothing was published to GitHub for them." });
  const location = run.githubRepo;

  if (!runLogged(run.id, `Created the private repo ${location}%`)) {
    return item({ id: "github_repo", label, location, state: "blocked", reason: "AgentOS cannot show it created this repository for the rebuild; it may have existed before. It is never deleted by clean-up. Delete it on GitHub yourself if you are sure." });
  }
  const off = deps.capabilityAllowed("github.delete_repository");
  if (off) return item({ id: "github_repo", label, location, state: "unavailable", reason: off });

  let facts;
  try {
    facts = await deps.publish.inspectGithubRepo(location);
  } catch (error) {
    return item({ id: "github_repo", label, location, state: "unavailable", reason: error instanceof Error ? error.message : "GitHub could not be reached." });
  }
  if (!facts) return item({ id: "github_repo", label, location, state: "not_found", reason: "Already deleted." });
  if (!facts.private) return item({ id: "github_repo", label, location, state: "blocked", reason: "It is public, which a client preview repo never is. It will not be deleted from here." });
  if (!facts.createdAt || Date.parse(facts.createdAt) < Date.parse(run.createdAt) - SLACK_MS) {
    return item({ id: "github_repo", label, location, state: "blocked", reason: "GitHub says it was created before this rebuild started (or did not say when), so it will not be deleted." });
  }
  return item({
    id: "github_repo",
    label,
    location,
    state: "ready",
    warnings: ["Deleting it cannot be undone, and it ends the preview link if the Vercel project is kept. Needs a token with the delete_repo permission."],
  });
}

async function inspectVercel(run: RebuildRun | undefined, deps: CleanupDeps): Promise<CleanupItem> {
  const label = "Vercel project";
  if (!run?.vercelProject) return item({ id: "vercel_project", label, location: "none recorded", state: "not_found", reason: "Nothing was deployed to Vercel for them." });
  const location = run.vercelProject;

  const off = deps.capabilityAllowed("vercel.delete_project");
  if (off) return item({ id: "vercel_project", label, location, state: "unavailable", reason: off });

  let facts;
  try {
    facts = await deps.publish.inspectVercelProject(location);
  } catch (error) {
    return item({ id: "vercel_project", label, location, state: "unavailable", reason: error instanceof Error ? error.message : "Vercel could not be reached." });
  }
  if (!facts) return item({ id: "vercel_project", label, location, state: "not_found", reason: "Already deleted." });

  const named = `${facts.name} (${location})`;
  if (facts.createdAt === undefined || facts.createdAt < Date.parse(run.createdAt) - SLACK_MS) {
    return item({ id: "vercel_project", label, location: named, state: "blocked", reason: "Vercel says it was created before this rebuild started (or did not say when), so it may be a real client's. It will not be deleted." });
  }
  if (run.githubRepo && facts.linkedRepo && lower(facts.linkedRepo) !== lower(run.githubRepo)) {
    return item({ id: "vercel_project", label, location: named, state: "blocked", reason: `It is linked to ${facts.linkedRepo}, not the rebuild's repository. It will not be deleted.` });
  }
  return item({ id: "vercel_project", label, location: named, state: "ready", warnings: ["Deleting it removes the preview link and every deployment. It cannot be undone."] });
}

async function inspect(prospect: Prospect, run: RebuildRun | undefined, deps: CleanupDeps): Promise<Inspection> {
  const [local, workspace, github, vercel] = await Promise.all([inspectLocalSite(run, deps), inspectWorkspace(run, prospect, deps), inspectGithub(run, deps), inspectVercel(run, deps)]);
  const records = item({
    id: "records",
    label: "Rebuild history in AgentOS",
    location: "AgentOS's rebuild database",
    state: run ? "ready" : "not_found",
    reason: run ? undefined : "No rebuild was started for them.",
    warnings: run ? ["Stages, approvals and notes. The reports themselves are in the workspace."] : [],
  });
  return {
    items: [github, vercel, local.item, workspace.item, records],
    targets: { local_site: local.target, workspace: workspace.target },
    wholeWorkspace: workspace.whole,
  };
}

const KEEPS = ["Their record: name, contact, website and notes", "Every email you sent them and the follow-up history", "Your saved library emails (they have no business details in them)"];

async function load(prospectId: string, deps: CleanupDeps) {
  const [state, events] = await Promise.all([readState(), readEvents()]);
  const prospect = state.prospects.find((entry) => entry.id === prospectId);
  if (!prospect) throw new TractionNotFoundError(`No prospect ${prospectId}`);
  const run = runForProspect(prospect.id);
  const verdict = cleanupEligibility({ prospect, state, events, now: deps.now(), rebuildActive: run ? runIsActive(run.id) : false });
  return { prospect, run, verdict };
}

/** What would be cleaned up, with sizes and whether each item may be deleted. Deletes nothing. */
export async function previewCleanup(prospectId: string, deps: CleanupDeps = defaultCleanupDeps): Promise<CleanupPreview> {
  const { prospect, run, verdict } = await load(prospectId, deps);
  if (!verdict.eligible) return { prospectId, company: prospect.company, eligible: false, ineligibleReasons: verdict.reasons, items: [], keeps: KEEPS };
  const inspection = await inspect(prospect, run, deps);
  return { prospectId, company: prospect.company, eligible: true, ineligibleReasons: [], items: inspection.items, keeps: KEEPS };
}

// ─── Doing it ───────────────────────────────────────────────────────────────

/**
 * Deletes what you chose, after checking everything again. Remote items need
 * the company's name typed. Each item succeeds or fails on its own; the rebuild
 * history goes last, and only if nothing else failed, so a failure can be
 * retried with the information still there.
 */
export async function runCleanup(prospectId: string, request: CleanupRequest, deps: CleanupDeps = defaultCleanupDeps): Promise<CleanupResult> {
  const { prospect, run, verdict } = await load(prospectId, deps);
  if (!verdict.eligible) throw new CleanupError(`Not eligible: ${verdict.reasons.join(" ")}`, 422);

  const chosen = new Set(request.items);
  if ([...chosen].some((id) => REMOTE_ITEMS.includes(id)) && lower(request.confirmCompany ?? "") !== lower(prospect.company)) {
    throw new CleanupError(`To delete from GitHub or Vercel, type the company's name exactly: ${prospect.company}.`, 422);
  }

  const inspection = await inspect(prospect, run, deps);
  for (const entry of inspection.items) {
    if (chosen.has(entry.id) && entry.state !== "ready") {
      throw new CleanupError(`${entry.label} cannot be deleted: ${entry.reason ?? entry.state}`, 409);
    }
  }

  const results: CleanupResult["results"] = [];
  let bytesFreed = 0;
  let anyFailed = false;
  const byId = new Map(inspection.items.map((entry) => [entry.id, entry]));
  const record = (id: CleanupItemId, status: "deleted" | "failed" | "skipped", detail: string) => {
    results.push({ id, status, detail });
    if (status === "failed") anyFailed = true;
  };

  const attempt = async (id: CleanupItemId, action: () => Promise<string>) => {
    try {
      record(id, "deleted", await action());
    } catch (error) {
      record(id, "failed", error instanceof Error ? error.message : "It could not be deleted.");
    }
  };

  // Remote first: they need the recorded names, and a failure there should not leave you half done locally.
  if (chosen.has("github_repo") && run?.githubRepo) {
    const repo = run.githubRepo;
    await attempt("github_repo", async () => {
      await deps.publish.deleteGithubRepo(repo);
      return `Deleted ${repo} from GitHub.`;
    });
  }
  if (chosen.has("vercel_project") && run?.vercelProject) {
    const project = run.vercelProject;
    await attempt("vercel_project", async () => {
      await deps.publish.deleteVercelProject(project);
      return "Deleted the Vercel project.";
    });
  }
  for (const id of ["local_site", "workspace"] as const) {
    if (!chosen.has(id)) continue;
    const target = inspection.targets[id];
    if (!target) {
      record(id, "skipped", "There was nothing to delete.");
      continue;
    }
    await attempt(id, async () => {
      await removeInside(target.root, target.path);
      bytesFreed += byId.get(id)?.bytes ?? 0;
      return `Deleted ${target.path}.`;
    });
  }
  if (chosen.has("records") && run) {
    if (anyFailed) {
      record("records", "skipped", "Kept, because something above failed: the history is what lets you retry.");
    } else {
      await attempt("records", async () => {
        deleteRunRecords(run.id);
        return "Deleted the rebuild history.";
      });
    }
  }

  await noteCleanup(prospect, results, bytesFreed, inspection.wholeWorkspace, deps.now());
  return { results, bytesFreed };
}

/** Leaves a line on the business saying what was cleaned up, and drops the link to a workspace that is gone. */
async function noteCleanup(prospect: Prospect, results: CleanupResult["results"], bytesFreed: number, wholeWorkspace: boolean, now: Date): Promise<void> {
  const done = results.filter((result) => result.status === "deleted").map((result) => result.id);
  if (done.length === 0) return;

  const names: Record<CleanupItemId, string> = { github_repo: "GitHub repo", vercel_project: "Vercel project", local_site: "site folder", workspace: "workspace", records: "rebuild history" };
  const line = `Cleaned up ${now.toISOString().slice(0, 10)}: ${done.map((id) => names[id]).join(", ")}${bytesFreed > 0 ? ` (${Math.round(bytesFreed / 1024 / 1024)} MB freed)` : ""}.`;
  const joined = prospect.notes ? `${prospect.notes}\n${line}` : line;
  // The notes have a size limit; the newest line matters most.
  const notes = joined.length > 4000 ? joined.slice(joined.length - 4000) : joined;
  await updateProspect(prospect.id, { notes, ...(done.includes("workspace") && wholeWorkspace && prospect.workspace ? { workspace: null } : {}) });
}
