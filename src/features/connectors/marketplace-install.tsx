import { useState, type FormEvent } from "react";
import { AlertTriangle, ExternalLink, Lock, ShieldAlert } from "lucide-react";
import type { MarketplacePreview } from "@shared/skill-types";
import { FieldLabel, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import { useInstallMarketplaceSkills, usePreviewMarketplaceRepo } from "@/lib/agentos/skills";
import { cn } from "@/lib/utils";
import { filterSkills, initialPicks, installable, isLargeRepo, MAX_SKILLS_PER_INSTALL } from "./marketplace-picks";

/**
 * Installing skills from a GitHub repo, in two steps: paste `owner/repo` and
 * read it, then review what it holds and install. Nothing is copied until
 * Install, and Install uses exactly the commit shown in the review.
 */
export function MarketplaceInstall({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const [repo, setRepo] = useState("");
  const preview = usePreviewMarketplaceRepo();
  const install = useInstallMarketplaceSkills();
  const [picked, setPicked] = useState<string[]>([]);

  const read = (event: FormEvent) => {
    event.preventDefault();
    install.reset();
    preview.mutate(repo, {
      onSuccess: (result) => setPicked(initialPicks(result.skills)),
    });
  };

  const result = preview.data;

  return (
    <div className="grid gap-4 border border-paper-mist bg-paper-cream p-4">
      <form onSubmit={read} className="grid gap-3" aria-label="Install a skill from GitHub">
        <h3 className="font-semibold text-paper-moss">Install from GitHub</h3>
        <div className="max-w-[44rem]">
          <label htmlFor="marketplace-repo">
            <FieldLabel>Repository</FieldLabel>
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="marketplace-repo"
              aria-describedby="marketplace-repo-hint"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="cth9191/animate or https://github.com/cth9191/animate"
              autoComplete="off"
              spellCheck={false}
              className={cn(PAPER_INPUT, "min-w-0 flex-1 font-mono text-[12px]")}
            />
            <PaperButton type="submit" variant="amber" disabled={!repo.trim() || preview.isPending}>
              {preview.isPending ? "Reading repo…" : "Read repo"}
            </PaperButton>
            <PaperButton type="button" variant="quiet" onClick={onCancel}>
              Cancel
            </PaperButton>
          </div>
          <p id="marketplace-repo-hint" className="mt-1 text-[13px] text-paper-sage">
            Works with Claude plugin marketplaces and any repo with a SKILL.md. Private repos use GITHUB_TOKEN from Connectors → GitHub.
          </p>
        </div>
      </form>

      {preview.error ? (
        <p role="alert" className="flex max-w-[80ch] items-start gap-2 text-[13px] leading-5 text-paper-flame-deep">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {preview.error.message}
        </p>
      ) : null}

      {result ? (
        <Review
          key={`${result.repo}@${result.commit}`}
          preview={result}
          picked={picked}
          onToggle={(id) => setPicked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))}
          onClear={() => setPicked([])}
          installing={install.isPending}
          error={install.error?.message}
          onInstall={() =>
            install.mutate(
              { repo: result.repo, commit: result.commit, skills: picked },
              {
                onSuccess: ({ installed }) =>
                  onDone(
                    `Installed ${installed.map((skill) => `${skill.name} v${skill.version}`).join(", ")} from ${result.repo}. ${installed.length === 1 ? "It's" : "They're"} on, and offered when you delegate a job.`,
                  ),
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function Review({
  preview,
  picked,
  onToggle,
  onClear,
  installing,
  error,
  onInstall,
}: {
  preview: MarketplacePreview;
  picked: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  installing: boolean;
  error?: string;
  onInstall: () => void;
}) {
  const updating = preview.skills.filter((skill) => skill.installed && picked.includes(skill.id)).length;
  const count = picked.length;
  const large = isLargeRepo(preview.skills);
  const overLimit = count > MAX_SKILLS_PER_INSTALL;
  const [filter, setFilter] = useState("");
  const shown = filterSkills(preview.skills, filter);

  return (
    <section aria-label={`Review ${preview.repo}`} className="grid gap-4 border-t border-paper-mist pt-4">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-paper-char">
        <a
          href={`${preview.url}/tree/${preview.commit}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-paper-moss underline decoration-paper-ash underline-offset-4 hover:text-paper-blue"
        >
          {preview.repo}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
        <span className="font-mono text-[12px] text-paper-sage">
          {preview.branch} @ {preview.commit.slice(0, 7)}
        </span>
        {preview.private ? (
          <Tag tone="muted">
            <Lock className="mr-1 size-3" aria-hidden="true" />
            Private
          </Tag>
        ) : null}
        {preview.marketplace ? <span className="text-paper-sage">Marketplace: {preview.marketplace}</span> : null}
      </p>

      {large ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="min-w-[16rem] max-w-[28rem] flex-1">
              <label htmlFor="marketplace-filter">
                <FieldLabel>Filter {preview.skills.length} skills</FieldLabel>
              </label>
              <input
                id="marketplace-filter"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Name or description"
                autoComplete="off"
                spellCheck={false}
                className={cn(PAPER_INPUT, "w-full")}
              />
            </div>
            <PaperButton type="button" variant="quiet" disabled={count === 0} onClick={onClear}>
              Select none
            </PaperButton>
          </div>
          <p aria-live="polite" className="max-w-[80ch] text-[13px] leading-5 text-paper-char">
            {count === 0 ? (
              `Nothing ticked. Up to ${MAX_SKILLS_PER_INSTALL} skills can install at once.`
            ) : (
              <>
                <span className="font-medium">{count} ticked:</span> {picked.join(" · ")}
              </>
            )}
          </p>
        </div>
      ) : null}

      {shown.length === 0 ? <p className="text-[13px] text-paper-sage">No skills match that filter.</p> : null}

      <ul
        tabIndex={large ? 0 : undefined}
        aria-label={large ? `Skills in ${preview.repo}` : undefined}
        className={cn("grid gap-2", large && "max-h-[32rem] overflow-y-auto border border-paper-mist p-2")}
      >
        {shown.map((skill) => {
          const ok = installable(skill);
          const checked = picked.includes(skill.id);
          return (
            <li key={skill.id} className={cn("border bg-paper-white p-3", ok ? "border-paper-mist" : "border-paper-flame/40")}>
              <label className={cn("flex items-start gap-3", ok ? "cursor-pointer" : "cursor-not-allowed")}>
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-[var(--paper-blue)]"
                  checked={checked}
                  disabled={!ok}
                  onChange={() => onToggle(skill.id)}
                  aria-describedby={`skill-${skill.id}-detail`}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-paper-moss">
                    {skill.name}
                    <span className="text-[13px] font-normal text-paper-sage">v{skill.version}</span>
                    {skill.installed ? <Tag tone="blue">Installed · update</Tag> : null}
                  </span>
                  <span className="mt-1 block max-w-[80ch] text-[13px] leading-5 text-paper-char">{skill.description || "No description."}</span>
                  <span id={`skill-${skill.id}-detail`} className="mt-1.5 block font-mono text-[12px] text-paper-sage">
                    {skill.plugin ? `${skill.plugin} plugin · ` : ""}
                    {skill.path} · {skill.files} file{skill.files === 1 ? "" : "s"} · {formatBytes(skill.bytes)}
                  </span>
                </span>
              </label>
              {skill.conflict || skill.errors.length > 0 ? (
                <ul role="alert" className="mt-2 grid gap-1 pl-7 text-[13px] text-paper-flame-deep">
                  {[...new Set([...(skill.conflict ? [skill.conflict] : []), ...skill.errors])].map((problem) => (
                    <li key={problem} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {problem}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {preview.notInstalled.length > 0 ? (
        <p className="max-w-[80ch] text-[13px] leading-5 text-paper-sage">
          <span className="font-medium text-paper-char">Left out:</span> {preview.notInstalled.join(" · ")}. AgentOS installs skill folders only.
        </p>
      ) : null}

      <div className="flex max-w-[80ch] items-start gap-3 border border-paper-marigold bg-paper-white px-4 py-3 text-[13px] leading-5 text-paper-char">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-paper-moss" aria-hidden="true" />
        <p>
          <span className="font-semibold text-paper-moss">Third-party instructions.</span> A skill tells agents what to do, and its folder can include
          scripts agents may run while following it. Install only from repos you trust. AgentOS runs nothing at install time, and it copies this exact
          commit; later changes arrive only when you press Update.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {error}
        </p>
      ) : null}

      {overLimit ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {count} skills are ticked. Untick {count - MAX_SKILLS_PER_INSTALL} to install, because one install takes up to {MAX_SKILLS_PER_INSTALL}.
        </p>
      ) : null}

      <div>
        <PaperButton type="button" variant="amber" disabled={count === 0 || overLimit || installing} onClick={onInstall}>
          {installing
            ? "Installing…"
            : count === 0
              ? "Nothing to install"
              : updating === count
                ? `Update ${count === 1 ? "skill" : `${count} skills`}`
                : `Install ${count === 1 ? "skill" : `${count} skills`}`}
        </PaperButton>
      </div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
