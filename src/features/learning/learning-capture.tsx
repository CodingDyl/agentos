import { BookmarkPlus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { formatTimestamp, type LearningSourceType } from "@shared/learning-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useCreateLearningNote } from "@/lib/agentos/learning";
import { useEditableTasks, useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { parseTimestampInput, tagsFromText } from "./learning-model";

/**
 * Capturing a learning, in the moment.
 *
 * Opened from a playing video it is stamped with the time it was opened at
 * (editable), and the source and workspace come with it. Only a title is
 * required: the point is that capturing costs less than forgetting.
 */

export function WorkspaceTaskPicker({
  workspaceId,
  taskId,
  onChange,
}: {
  workspaceId?: string;
  taskId?: string;
  onChange: (next: { workspaceId?: string; taskId?: string }) => void;
}) {
  const projects = useProjects();
  const tasks = useEditableTasks(workspaceId ?? "");
  const open = (tasks.data?.tasks ?? []).filter((task) => task.id && (!task.completed || task.id === taskId));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <FieldLabel>Workspace</FieldLabel>
        <select
          value={workspaceId ?? ""}
          onChange={(event) => onChange({ workspaceId: event.target.value || undefined, taskId: undefined })}
          className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer")}
        >
          <option value="">None</option>
          {(projects.data?.projects ?? []).map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <FieldLabel>Task</FieldLabel>
        <select
          value={taskId ?? ""}
          disabled={!workspaceId}
          onChange={(event) => onChange({ workspaceId, taskId: event.target.value || undefined })}
          className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50")}
        >
          <option value="">{workspaceId ? "None" : "Choose a workspace first"}</option>
          {open.map((task) => (
            <option key={task.id} value={task.id}>
              {task.id} {task.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export interface CaptureContext {
  sourceType: LearningSourceType;
  sourceId?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  timestampSeconds?: number;
  workspaceId?: string;
}

export function LearningCapture({ context, onDone, className }: { context: CaptureContext; onDone: (noteId?: string) => void; className?: string }) {
  const id = useId();
  const create = useCreateLearningNote();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [stamp, setStamp] = useState(context.timestampSeconds !== undefined ? formatTimestamp(context.timestampSeconds) : "");
  const [link, setLink] = useState<{ workspaceId?: string; taskId?: string }>({ workspaceId: context.workspaceId });
  const [tags, setTags] = useState("");
  const [url, setUrl] = useState(context.sourceUrl ?? "");

  const timestamp = parseTimestampInput(stamp);
  const stampInvalid = stamp.trim() !== "" && timestamp === undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || stampInvalid || create.isPending) return;
    create.mutate(
      {
        title: title.trim(),
        content,
        sourceType: context.sourceType,
        sourceId: context.sourceId,
        sourceUrl: context.sourceId ? undefined : url.trim() || undefined,
        timestampSeconds: timestamp,
        workspaceId: link.workspaceId,
        taskId: link.taskId,
        tags: tagsFromText(tags),
      },
      { onSuccess: (note) => onDone(note.id) },
    );
  };

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`} className={cn("space-y-4 border border-paper-mist bg-paper-white p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="font-paper-display text-[19px] font-bold">
            Capture learning
          </h2>
          {context.sourceTitle ? (
            <p className="mt-0.5 text-[13px] text-paper-sage">
              From {context.sourceTitle}
              {timestamp !== undefined ? ` · ${formatTimestamp(timestamp)}` : ""}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => onDone()} aria-label="Close" className="inline-flex size-8 cursor-pointer items-center justify-center hover:bg-paper-linen">
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      <label className="block">
        <FieldLabel>What did you learn?</FieldLabel>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder="Memory compaction vs retrieval"
          className={cn(PAPER_INPUT, "min-h-11 w-full text-[16px] font-medium")}
        />
      </label>

      <label className="block">
        <FieldLabel>Notes</FieldLabel>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={5}
          maxLength={20_000}
          placeholder="In your own words — what to remember, and why it matters."
          className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        {context.sourceType === "youtube" || context.sourceType === "spotify" ? (
          <label className="block">
            <FieldLabel>Timestamp</FieldLabel>
            <input
              value={stamp}
              onChange={(event) => setStamp(event.target.value)}
              placeholder="32:18"
              aria-invalid={stampInvalid}
              className={cn(PAPER_INPUT, "min-h-10 w-full font-mono", stampInvalid && "border-paper-flame-deep")}
            />
          </label>
        ) : !context.sourceId ? (
          <label className="block">
            <FieldLabel>Source link (optional)</FieldLabel>
            <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" placeholder="https://" className={cn(PAPER_INPUT, "min-h-10 w-full")} />
          </label>
        ) : (
          <span />
        )}
        <label className="block">
          <FieldLabel>Tags</FieldLabel>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="memory, agents" className={cn(PAPER_INPUT, "min-h-10 w-full")} />
        </label>
      </div>

      <WorkspaceTaskPicker workspaceId={link.workspaceId} taskId={link.taskId} onChange={setLink} />

      {create.error ? (
        <p role="alert" className="text-[13.5px] text-paper-flame-deep">
          {create.error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <PaperButton type="submit" variant="amber" disabled={!title.trim() || stampInvalid || create.isPending}>
          <BookmarkPlus className="size-3.5" strokeWidth={2} aria-hidden="true" /> {create.isPending ? "Saving…" : "Save learning"}
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">Saved to Knowledge. It becomes memory only if you promote it.</span>
      </div>
    </form>
  );
}
