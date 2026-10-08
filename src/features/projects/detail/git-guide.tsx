import { Copy } from "lucide-react";
import { useState } from "react";
import type { RepositoryStatus } from "@shared/repository-types";
import { SectionLabel } from "@/components/os";

/**
 * Git, taught from where the operator is standing.
 *
 * The first block reads the repository's own state and says what it means in
 * plain words. The rest is the short list of commands that cover almost every
 * day, with the why next to each, and the handful of recoveries worth knowing
 * before they are needed. AgentOS doesn't run most of these on purpose: the
 * point here is that the operator can.
 */

interface Entry {
  command: string;
  what: string;
  when?: string;
}

function Command({ entry }: { entry: Entry }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="border-b border-os-border py-3">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-sm bg-os-border/30 px-2 py-0.5 font-mono text-[12.5px] text-foreground">{entry.command}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(entry.command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1 rounded-sm normal-case text-os-subtle hover:text-foreground"
          aria-label={`Copy ${entry.command}`}
        >
          <Copy className="size-3" strokeWidth={1.5} aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1.5 max-w-[72ch] text-[13px] leading-6 text-os-muted">{entry.what}</p>
      {entry.when ? <p className="os-meta mt-0.5 max-w-[72ch] normal-case text-os-subtle">{entry.when}</p> : null}
    </li>
  );
}

const EVERYDAY: Entry[] = [
  { command: "git status", what: "What's changed, what's staged, what branch you're on. Run it before and after everything.", when: "When in doubt, this first." },
  { command: "git log --oneline --graph --all -20", what: "The same tree as the Tree tab, in the terminal.", when: "Add --decorate to see branch names." },
  { command: "git diff", what: "Line-by-line changes you haven't staged yet. `git diff --staged` shows what the next commit will contain." },
  { command: "git add -p", what: "Stage changes piece by piece, choosing hunks, so a commit holds one idea rather than the whole afternoon." },
  { command: 'git commit -m "Say what and why"', what: "Save a snapshot on this branch. A commit is a point you can always come back to." },
  { command: "git switch -c feature/name", what: "Make a new branch and move onto it. Branches are just names for a commit, so they're cheap: make them freely." },
  { command: "git switch main", what: "Move to another branch. Git refuses if your changes would be overwritten, which is the protection working.", when: "Blocked? Commit or `git stash -u` first." },
  { command: "git stash -u", what: "Put uncommitted work (including new files) on a shelf and get a clean tree. `git stash pop` brings it back.", when: "AgentOS's Stash button does exactly this." },
  { command: "git fetch", what: "Ask the remote what's new without changing anything of yours. Safe, always." },
  { command: "git pull --ff-only", what: "Bring your branch up to date only if that's a straight line. If it can't, it stops and tells you the branch has diverged.", when: "Prefer this to a bare `git pull`, which may create surprise merges." },
  { command: "git push", what: "Send your commits to the remote. The first time on a new branch: `git push -u origin feature/name`." },
];

const RECOVER: Entry[] = [
  { command: "git restore path/to/file", what: "Throw away your unstaged edits to one file and go back to the last commit.", when: "This one can't be undone: the edits were never saved anywhere." },
  { command: "git restore --staged path/to/file", what: "Unstage a file without losing its changes." },
  { command: "git commit --amend", what: "Fix the last commit's message or add a forgotten file.", when: "Only before you've pushed it." },
  { command: "git reset --soft HEAD~1", what: "Undo the last commit but keep all its changes staged. Nothing is lost.", when: "Only before you've pushed it." },
  { command: "git revert <hash>", what: "Undo an old commit by adding a new commit that reverses it. Safe on shared branches, because history is only added to." },
  { command: "git reflog", what: "Git's diary of everywhere HEAD has been, including commits no branch points to any more. After a mistake, find the hash here and `git switch -c rescue <hash>`.", when: "Almost nothing committed is ever truly gone." },
  { command: "git switch main", what: "Detached HEAD (it says so on the Status tab) means you're looking at a commit, not on a branch. Anything you commit there is easy to lose. Switch to a branch, or `git switch -c name` to keep it." },
];

function Block({ title, intro, entries }: { title: string; intro?: string; entries: Entry[] }) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      {intro ? <p className="mt-2 max-w-[72ch] text-[13px] leading-6 text-os-muted">{intro}</p> : null}
      <ul className="mt-2 border-t border-os-border">
        {entries.map((entry) => (
          <Command key={entry.command} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

/** What the repository's own state means, in words. */
function Here({ status }: { status: RepositoryStatus }) {
  const current = status.branches.find((branch) => branch.current);
  const notes: { title: string; body: string; command?: string }[] = [];

  if (!status.branch) {
    notes.push({ title: "You're on a detached HEAD", body: "You're looking at a single commit rather than a branch. Commits made here belong to no branch and are easy to lose.", command: "git switch main" });
  }
  if (status.metadataFiles) {
    notes.push({
      title: `${status.metadataFiles} macOS ._ files are in this repository`,
      body: "This project lives on an exFAT or network drive. macOS can't store file metadata there, so it writes a ._name copy beside every file. Git lists them as new files and linters and test runners read them as broken source. That is what failed the Watergate job's lint and tests: the work itself was fine. The Tree and Status tabs have a button that removes them and tells git to ignore them. To stop them being made, keep the working copy on the Mac's own disk.",
      command: "find . -name '._*' -not -path './node_modules/*' -not -path './.git/*' -delete",
    });
  }
  if (status.workingTree === "modified" && !status.metadataFiles) {
    notes.push({ title: `${status.uncommitted.length} uncommitted ${status.uncommitted.length === 1 ? "change" : "changes"}`, body: "These exist only in your working folder. Commit them to keep them as a snapshot, or stash them to set them aside. AgentOS won't switch branches or start a job's integration over them.", command: "git add -p && git commit" });
  }
  if (current && current.behind > 0 && current.ahead > 0) {
    notes.push({ title: `${current.name} has diverged from ${current.upstream}`, body: `You have ${current.ahead} commit${current.ahead === 1 ? "" : "s"} the remote doesn't, and it has ${current.behind} you don't. Neither side can fast-forward. Fetch, look at both sides in the Tree tab, then either merge or rebase yours on top.`, command: "git fetch && git log --oneline --graph --all -15" });
  } else if (current && current.behind > 0) {
    notes.push({ title: `${current.name} is ${current.behind} behind ${current.upstream}`, body: "The remote has commits you don't. Nothing of yours is at risk: this is a straight line.", command: "git pull --ff-only" });
  } else if (current && current.ahead > 0) {
    notes.push({ title: `${current.name} is ${current.ahead} ahead of ${current.upstream}`, body: "You have commits that haven't been pushed.", command: "git push" });
  }
  for (const pin of status.pins.filter((entry) => entry.baseMoved)) {
    notes.push({ title: `A job was reviewed on an older ${pin.branch}`, body: "A worker's branch is made from the commit main was on when the job started. Main has moved since, so what was reviewed is no longer exactly what would land. AgentOS refuses to rebase it for you, because that would merge code nobody reviewed. Re-run the job on the new base.", command: "git log --oneline --graph --all -15" });
  }

  return (
    <section>
      <SectionLabel>Where you are right now</SectionLabel>
      {notes.length === 0 ? (
        <p className="mt-2 max-w-[72ch] text-[13px] leading-6 text-os-muted">
          Nothing needs attention: you're on <span className="font-mono">{status.branch}</span>, the working folder is clean and nothing has diverged.
        </p>
      ) : (
        <ul className="mt-2 border-t border-os-border">
          {notes.map((note) => (
            <li key={note.title} className="border-b border-os-border py-3">
              <p className="text-[13.5px] font-medium text-foreground">{note.title}</p>
              <p className="mt-1 max-w-[72ch] text-[13px] leading-6 text-os-muted">{note.body}</p>
              {note.command ? <code className="mt-2 inline-block rounded-sm bg-os-border/30 px-2 py-0.5 font-mono text-[12px] text-os-muted">{note.command}</code> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GitGuide({ status }: { status: RepositoryStatus }) {
  return (
    <div className="mt-6 space-y-10">
      <Here status={status} />

      <section>
        <SectionLabel>The model in four lines</SectionLabel>
        <ol className="mt-2 max-w-[72ch] list-decimal space-y-1.5 border-t border-os-border pt-3 pl-5 text-[13px] leading-6 text-os-muted">
          <li>A <b className="font-medium text-foreground">commit</b> is a snapshot that points back to the one before it. That's the dots and lines in the Tree.</li>
          <li>A <b className="font-medium text-foreground">branch</b> is only a name stuck on one commit. Making one copies nothing; committing moves the name forward.</li>
          <li><b className="font-medium text-foreground">HEAD</b> is "where you are": usually a branch name, which is the one with the highlighted chip.</li>
          <li><b className="font-medium text-foreground">Diverged</b> means two lines grew from the same commit and neither contains the other. Joining them is a merge (or a rebase).</li>
        </ol>
      </section>

      <Block title="Everyday commands" entries={EVERYDAY} />
      <Block title="When something goes wrong" intro="Mistakes are cheap while the work is committed. Most of these are safe; the ones that aren't say so." entries={RECOVER} />

      <section>
        <SectionLabel>How AgentOS workers use git</SectionLabel>
        <ul className="mt-2 max-w-[72ch] list-disc space-y-1.5 border-t border-os-border pt-3 pl-5 text-[13px] leading-6 text-os-muted">
          <li>Each job runs in its own copy of the repository on a branch called <span className="font-mono">agentos-worker/job_…</span>, so it can't touch your working folder. Tick "Show worker branches" in the Tree to see them.</li>
          <li>Approving a job lands its commit on your branch only as a fast-forward: if the branch moved while the job ran, AgentOS stops rather than merge unreviewed code.</li>
          <li>After landing, the job's checks run again in your real folder. A failure there that wasn't in the worker's copy usually means something about <i>your folder</i> differs (like ._ files), not that the work is wrong.</li>
        </ul>
      </section>
    </div>
  );
}
