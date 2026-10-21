import { FileText, Link2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { SectionLabel } from "@/components/os";
import { taskReferenceUrl } from "@/lib/agentos/client";
import type { TaskBrief, TaskReference } from "@shared/agentos-types";
import { cn } from "@/lib/utils";
import type { TaskBriefDraft } from "./task-brief-model";

/**
 * Extra fields on a task, beyond the TASKS.md title line.
 *
 * Kept beside the quick-create title so a one-line add still exists, and
 * expanded when the operator has an outcome, steps, or references to attach.
 */

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown,.md,.txt,.doc,.docx";

const FIELD =
  "os-focus-ring mt-2 w-full rounded-md border border-os-border bg-transparent px-3 py-2 text-[13px] leading-5 text-foreground placeholder:text-os-subtle";

export function TaskBriefFields({
  draft,
  onChange,
  disabled,
}: {
  draft: TaskBriefDraft;
  onChange: (next: TaskBriefDraft) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<TaskBriefDraft>) => onChange({ ...draft, ...patch });

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const names = new Set(draft.files.map((file) => file.name));
    set({ files: [...draft.files, ...incoming.filter((file) => !names.has(file.name))].slice(0, 12) });
  };

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="block md:col-span-1">
        <SectionLabel>Desired outcome</SectionLabel>
        <textarea
          rows={3}
          disabled={disabled}
          value={draft.desiredOutcome}
          onChange={(event) => set({ desiredOutcome: event.target.value })}
          placeholder="What done looks like"
          className={`${FIELD} resize-y`}
        />
      </label>

      <label className="block md:col-span-1">
        <SectionLabel>What this entails</SectionLabel>
        <textarea
          rows={3}
          disabled={disabled}
          value={draft.scope}
          onChange={(event) => set({ scope: event.target.value })}
          placeholder="Scope and steps"
          className={`${FIELD} resize-y`}
        />
      </label>

      <label className="block">
        <SectionLabel>Acceptance criteria</SectionLabel>
        <textarea
          rows={3}
          disabled={disabled}
          value={draft.acceptance}
          onChange={(event) => set({ acceptance: event.target.value })}
          placeholder="One criterion per line"
          className={`${FIELD} resize-y`}
        />
      </label>

      <label className="block">
        <SectionLabel>Constraints</SectionLabel>
        <textarea
          rows={3}
          disabled={disabled}
          value={draft.constraints}
          onChange={(event) => set({ constraints: event.target.value })}
          placeholder="One constraint per line"
          className={`${FIELD} resize-y`}
        />
      </label>

      <label className="block md:col-span-2">
        <SectionLabel>Links</SectionLabel>
        <textarea
          rows={2}
          disabled={disabled}
          value={draft.links}
          onChange={(event) => set({ links: event.target.value })}
          placeholder="One URL per line"
          className={`${FIELD} resize-y`}
        />
      </label>

      <div className="md:col-span-2">
        <SectionLabel>References</SectionLabel>
        <label className="mt-2 flex cursor-pointer flex-col items-start gap-1 rounded-md border border-dashed border-os-border px-3 py-3 text-[13px] leading-5 text-os-muted hover:border-os-border-strong hover:text-foreground">
          <input
            type="file"
            multiple
            accept={ACCEPT}
            disabled={disabled}
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span>Screenshots, PDFs, docs — attached to the task, handed to the worker</span>
          <span className="os-meta text-os-subtle">Images, PDF, Markdown, up to 12 files</span>
        </label>

        {draft.files.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {draft.files.map((file) => (
              <PendingRef
                key={file.name}
                file={file}
                onRemove={() => set({ files: draft.files.filter((entry) => entry !== file) })}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PendingRef({ file, onRemove }: { file: File; onRemove: () => void }) {
  const preview = useObjectUrl(file);

  return (
    <li className="flex items-center gap-2 rounded-md border border-os-border bg-os-surface-raised px-2 py-1.5">
      {preview && file.type.startsWith("image/") ? (
        <img src={preview} alt="" className="size-8 rounded object-cover" />
      ) : (
        <FileText className="size-4 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
      )}
      <span className="max-w-[12rem] truncate text-[12px] leading-4 text-os-muted">{file.name}</span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="os-focus-ring cursor-pointer rounded p-1 text-os-subtle hover:text-foreground"
      >
        <X className="size-3.5" strokeWidth={1.5} />
      </button>
    </li>
  );
}

function useObjectUrl(file: File): string | undefined {
  const url = useMemo(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

export function TaskBriefReadout({
  brief,
  slug,
  compact,
}: {
  brief: TaskBrief;
  slug: string;
  compact?: boolean;
}) {
  const empty =
    !brief.desiredOutcome &&
    !brief.scope &&
    !brief.acceptanceCriteria?.length &&
    !brief.constraints?.length &&
    !brief.links?.length &&
    !brief.references?.length;
  if (empty) return null;

  return (
    <div className={cn("space-y-3", compact ? "mt-4" : "mt-5")}>
      <Block label="Desired outcome" body={brief.desiredOutcome} />
      <Block label="What this entails" body={brief.scope} />
      <List label="Acceptance" items={brief.acceptanceCriteria} />
      <List label="Constraints" items={brief.constraints} />
      <List
        label="Links"
        items={brief.links}
        icon={<Link2 className="mt-0.5 size-3.5 shrink-0 text-os-subtle" strokeWidth={1.5} />}
      />
      {brief.references?.length ? (
        <div>
          <SectionLabel>References</SectionLabel>
          <ul className="mt-2 flex flex-wrap gap-2">
            {brief.references.map((ref) => (
              <StoredRef key={ref.name} slug={slug} taskId={brief.taskId} reference={ref} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Block({ label, body }: { label: string; body?: string }) {
  if (!body?.trim()) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-1.5 max-w-[62ch] whitespace-pre-wrap text-[13px] leading-5 text-os-muted">{body}</p>
    </div>
  );
}

function List({
  label,
  items,
  icon,
}: {
  label: string;
  items?: string[];
  icon?: ReactNode;
}) {
  if (!items?.length) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex max-w-[62ch] gap-2 text-[13px] leading-5 text-os-muted">
            {icon ?? <span className="mt-2 size-1 shrink-0 rounded-full bg-os-subtle" />}
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StoredRef({
  slug,
  taskId,
  reference,
}: {
  slug: string;
  taskId: string;
  reference: TaskReference;
}) {
  const href = taskReferenceUrl(slug, taskId, reference.name);
  const [failed, setFailed] = useState(false);
  const image = reference.image && !failed;

  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="os-focus-ring flex items-center gap-2 rounded-md border border-os-border px-2 py-1.5 hover:border-os-border-strong"
      >
        {image ? (
          <img
            src={href}
            alt=""
            className="size-8 rounded object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <FileText className="size-4 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
        )}
        <span className="max-w-[12rem] truncate text-[12px] leading-4 text-os-muted">{reference.name}</span>
      </a>
    </li>
  );
}
