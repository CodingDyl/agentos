import fs from "node:fs/promises";
import path from "node:path";
import { git, isRepository } from "../agentos/git";
import { assertClientDrivePresent, resolveClientRepoPath } from "../website-rebuild/client-repo";
import { motionSiteTemplate } from "./site-template";

const AUTHOR = ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost"];
const GITIGNORE = ["node_modules/", ".next/", "out/", ".vercel/", ".env", ".env.*", "!.env.example", "*.log", "._*", ".DS_Store", ""].join("\n");

/** Default location for a new motion site: the shared client-projects root. */
export function siteRepoPath(slug: string, recorded?: string): string {
  return resolveClientRepoPath(slug, recorded);
}

export async function ensureMotionSiteRepo(slug: string, name: string, recorded?: string): Promise<string> {
  const repo = siteRepoPath(slug, recorded);
  await assertClientDrivePresent(repo);
  await fs.mkdir(repo, { recursive: true });

  if (await isRepository(repo)) {
    const head = await git(repo, ["rev-parse", "--verify", "HEAD"]).catch(() => undefined);
    if (head) return repo;
  } else {
    try {
      await git(repo, ["init", "-b", "main"]);
    } catch {
      await git(repo, ["init"]);
    }
  }

  await fs.writeFile(path.join(repo, ".gitignore"), GITIGNORE, { flag: "wx" }).catch(() => undefined);
  const existingPackage = await fs.readFile(path.join(repo, "package.json"), "utf8").catch(() => undefined);
  if (!existingPackage) {
    const files = motionSiteTemplate(name);
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(repo, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, { flag: "wx" }).catch(() => undefined);
    }
  }
  await git(repo, ["add", "-A"]);
  await git(repo, [...AUTHOR, "commit", "--no-verify", "-m", "Start the motion site"]);
  return repo;
}

export async function commitSiteFiles(repo: string, files: Record<string, string | Buffer>, message: string): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.resolve(repo, relative);
    if (!target.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new Error(`Refusing to write outside the site: ${relative}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  await git(repo, ["add", "-A"]);
  const staged = await git(repo, ["diff", "--cached", "--name-only"]);
  if (!staged.stdout.trim()) return;
  await git(repo, [...AUTHOR, "commit", "--no-verify", "-m", message]);
}

export async function writeApprovalFile(repo: string, approval: { conceptId: string; ceiling: number; plannedCredits: number; approvedAt: string }): Promise<void> {
  await commitSiteFiles(
    repo,
    {
      "motion-studio/credits.approved.json": `${JSON.stringify({ ...approval, authorized: true }, null, 2)}\n`,
    },
    `Approve concept ${approval.conceptId} with a ${approval.ceiling} credit ceiling`,
  );
}
