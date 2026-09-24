import { CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { SeoFinding } from "@shared/seo-types";
import { CommandButton, EmptyState, Section, SectionLabel } from "@/components/os";
import { useFileSeoFindingTask, useProjectSeo, useProjectVercelInfo, useRunSeoAudit } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, groupBySeverity, SEVERITY_DOT, SEVERITY_LABELS, SEVERITY_TEXT } from "../seo-model";

/**
 * The project's SEO audits: a mechanical check of the live site — titles,
 * meta tags, headings, alt text, structured data, well-known files, and
 * broken links — against whatever domain the project resolves to.
 *
 * Nothing here calls Jev or Hermes: every finding comes from a deterministic
 * rule in `server/seo/checks.ts`. Judgement calls like content strategy or
 * keyword targeting are a conversation with an agent, not a crawler's job.
 */
export function ProjectSeo({
  slug,
  vercelProjectId,
  onOpenSettings,
}: {
  slug: string;
  vercelProjectId?: string;
  onOpenSettings: () => void;
}) {
  const [manualUrl, setManualUrl] = useState("");

  const vercel = useProjectVercelInfo(slug, Boolean(vercelProjectId));
  const seo = useProjectSeo(slug);
  const runAudit = useRunSeoAudit(slug);
  const fileTask = useFileSeoFindingTask(slug);

  const liveUrl = vercel.data?.liveUrl;
  const manualTarget = manualUrl.trim() || undefined;
  const targetUrl = liveUrl ?? manualTarget;

  const latest = seo.data?.latest;
  const groups = latest ? groupBySeverity(latest.findings) : [];

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-5 rounded-lg border border-os-border bg-os-surface-raised p-5">
        <div className="min-w-0">
          <SectionLabel>Target</SectionLabel>

          {vercelProjectId ? (
            vercel.isPending ? (
              <p className="mt-2 text-[14px] leading-5 text-os-muted">Reading Vercel…</p>
            ) : liveUrl ? (
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                className="os-focus-ring mt-2 inline-flex items-center gap-1.5 text-[15px] leading-6 text-foreground hover:text-os-amber"
              >
                {liveUrl.replace(/^https?:\/\//, "")}
                <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              </a>
            ) : (
              <p className="mt-2 max-w-[40ch] text-[14px] leading-5 text-os-warning">
                Linked to {vercel.data?.projectName ?? "Vercel"}, but it has no verified domain yet.
              </p>
            )
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                placeholder="https://your-site.com"
                className="os-focus-ring w-64 rounded-md border border-os-border bg-transparent px-3 py-2 text-[14px] leading-5 text-foreground placeholder:text-os-subtle"
              />
              <button
                type="button"
                onClick={onOpenSettings}
                className="os-focus-ring os-meta text-os-muted underline decoration-os-border underline-offset-4 hover:text-foreground"
              >
                or connect a Vercel project
              </button>
            </div>
          )}
        </div>

        <CommandButton
          variant="primary"
          icon={RefreshCw}
          iconPosition="start"
          disabled={!targetUrl}
          loading={runAudit.isPending}
          loadingLabel="Auditing"
          onClick={() => targetUrl && runAudit.mutate(liveUrl ? undefined : targetUrl)}
        >
          Run audit
        </CommandButton>
      </div>

      {runAudit.error ? <p className="text-[13px] leading-5 text-os-danger">{runAudit.error.message}</p> : null}

      {seo.isPending ? (
        <p className="text-[15px] leading-6 text-os-muted">Reading SEO history…</p>
      ) : !latest ? (
        <EmptyState
          label="No audits yet"
          description="Run an audit to check titles, meta tags, headings, alt text, structured data, well-known files, and broken links against the live site."
        />
      ) : latest.status === "failed" ? (
        <EmptyState label="Last audit failed" description={latest.error ?? "The audit could not be completed."} />
      ) : groups.length === 0 ? (
        <EmptyState
          label="Nothing found"
          description={`The last audit of ${latest.targetUrl} found no issues in any of the checks it runs.`}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <Section
              key={group.severity}
              label={SEVERITY_LABELS[group.severity]}
              action={
                <span className={cn("os-meta tabular-nums", SEVERITY_TEXT[group.severity])}>
                  {group.findings.length}
                </span>
              }
            >
              <div className="space-y-3">
                {group.findings.map((finding) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    onFileTask={() => fileTask.mutate(finding.id)}
                    filing={fileTask.isPending && fileTask.variables === finding.id}
                  />
                ))}
              </div>
            </Section>
          ))}
        </div>
      )}

      {seo.data && seo.data.history.length > 0 ? (
        <Section label="History">
          <div className="space-y-2">
            {seo.data.history.map((run) => (
              <div key={run.id} className="flex items-center justify-between text-[13px] leading-5 text-os-subtle">
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span>{run.status === "failed" ? "Failed" : `${run.findingCount} finding${run.findingCount === 1 ? "" : "s"}`}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function FindingRow({
  finding,
  onFileTask,
  filing,
}: {
  finding: SeoFinding;
  onFileTask: () => void;
  filing: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-os-border bg-os-surface p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[finding.severity])} aria-hidden="true" />
          <span className="os-meta text-os-subtle">{CATEGORY_LABELS[finding.category]}</span>
        </div>
        <p className="mt-1.5 text-[14.5px] leading-6 font-medium text-foreground">{finding.title}</p>
        <p className="mt-1 text-[13px] leading-5 text-os-muted">{finding.description}</p>
      </div>

      {finding.taskId ? (
        <span className="os-meta flex shrink-0 items-center gap-1.5 text-os-success">
          <CheckCircle2 className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          {finding.taskId}
        </span>
      ) : (
        <CommandButton variant="quiet" loading={filing} loadingLabel="Filing" onClick={onFileTask} className="shrink-0">
          Create task
        </CommandButton>
      )}
    </div>
  );
}
