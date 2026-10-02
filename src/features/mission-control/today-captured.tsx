import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CAPTURE_KIND_LABEL,
  type CaptureDestination,
  type CaptureEntry,
  type CaptureKind,
  type CaptureTriage,
} from "@shared/capture-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useAcceptCapture, useCaptureTriage, useDeleteCapture, useSuggestHomes } from "@/lib/agentos/capture-triage";
import { cn } from "@/lib/utils";

/**
 * What was captured and not yet sorted, with Hermes' suggested home for each.
 *
 * Accept files the note there and takes it out of the inbox; Change lets you
 * pick another kind or home first; Delete drops it. Hermes is asked once,
 * when notes without a suggestion are on screen, and its answers are kept.
 */
export function TodayCaptured({ className }: { className?: string }) {
  const triage = useCaptureTriage();
  const suggest = useSuggestHomes();
  const asked = useRef(false);
  const items = triage.data?.items ?? [];
  const unsorted = items.filter((item) => !item.suggestion).length;

  // Ask Hermes once per visit, and only when something has no suggestion yet.
  useEffect(() => {
    if (!asked.current && unsorted > 0 && !suggest.isPending) {
      asked.current = true;
      suggest.mutate();
    }
  }, [unsorted, suggest]);

  return (
    <PaperSection id="captured" label="Captured" count={items.length > 0 ? items.length : undefined} className={className}>
      {triage.error ? (
        <p role="alert" className="text-[13.5px] text-paper-flame-deep">
          {triage.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">Inbox empty. Capture from anywhere with the pen in the top bar, or ⌘⇧C.</p>
      ) : (
        <>
          <p className="mb-3 flex items-center gap-1.5 text-[12.5px] text-paper-sage" aria-live="polite">
            <Sparkles className="size-3.5 text-paper-blue" aria-hidden="true" />
            {suggest.isPending
              ? "Hermes is sorting your notes…"
              : suggest.error
                ? `Hermes could not sort them: ${suggest.error.message}`
                : "Hermes suggested where each note belongs. Accept, change or delete."}
            {suggest.error ? (
              <button type="button" onClick={() => suggest.mutate()} className={cn("ml-1 cursor-pointer text-paper-blue hover:underline", PAPER_FOCUS)}>
                Try again
              </button>
            ) : null}
          </p>
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {[...items].reverse().map((item) => (
              <CaptureRow key={item.id} item={item} triage={triage.data as CaptureTriage} />
            ))}
          </ul>
        </>
      )}
    </PaperSection>
  );
}

function homeName(destination: Pick<CaptureDestination, "workspace" | "area">, triage: CaptureTriage): string {
  if (destination.workspace) return triage.workspaces.find((entry) => entry.slug === destination.workspace)?.name ?? destination.workspace;
  const area = destination.area ?? "personal";
  return area.charAt(0).toUpperCase() + area.slice(1);
}

function CaptureRow({ item, triage }: { item: CaptureEntry; triage: CaptureTriage }) {
  const accept = useAcceptCapture();
  const remove = useDeleteCapture();
  const [changing, setChanging] = useState(false);
  const busy = accept.isPending || remove.isPending;
  const suggestion = item.suggestion;

  return (
    <li className="py-3">
      <p className="text-[14px] leading-6 text-paper-moss">{item.text}</p>
      {suggestion && !changing ? (
        <p className="mt-0.5 text-[12.5px] leading-5 text-paper-sage">
          <Tag tone="blue" className="mr-1.5">
            {CAPTURE_KIND_LABEL[suggestion.kind]}
          </Tag>
          → {homeName(suggestion, triage)}
          {suggestion.title !== item.text ? <span className="block text-paper-char">as “{suggestion.title}”</span> : null}
        </p>
      ) : null}

      {changing ? (
        <ChangeForm
          item={item}
          triage={triage}
          busy={busy}
          onCancel={() => setChanging(false)}
          onFile={(destination) => accept.mutate({ id: item.id, destination })}
        />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {suggestion ? (
            <PaperButton
              variant="amber"
              disabled={busy}
              onClick={() => accept.mutate({ id: item.id, destination: { kind: suggestion.kind, title: suggestion.title, workspace: suggestion.workspace, area: suggestion.area } })}
            >
              {accept.isPending ? "Filing…" : "Accept"}
            </PaperButton>
          ) : null}
          <PaperButton variant="ghost" disabled={busy} onClick={() => setChanging(true)}>
            {suggestion ? "Change" : "File it"}
          </PaperButton>
          <PaperButton disabled={busy} onClick={() => remove.mutate(item.id)}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </PaperButton>
        </div>
      )}
      {accept.error ?? remove.error ? (
        <p role="alert" className="mt-1 text-[13px] text-paper-flame-deep">
          {(accept.error ?? remove.error)?.message}
        </p>
      ) : null}
    </li>
  );
}

function ChangeForm({
  item,
  triage,
  busy,
  onCancel,
  onFile,
}: {
  item: CaptureEntry;
  triage: CaptureTriage;
  busy: boolean;
  onCancel: () => void;
  onFile: (destination: CaptureDestination) => void;
}) {
  const start = item.suggestion;
  const [kind, setKind] = useState<CaptureKind>(start?.kind ?? "task");
  const [home, setHome] = useState(start?.workspace ? `w:${start.workspace}` : `a:${start?.area ?? "personal"}`);
  const [title, setTitle] = useState(start?.title ?? item.text);

  return (
    <form
      className="mt-2 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        const [type, value] = [home.slice(0, 1), home.slice(2)];
        onFile({ kind, title: title.trim(), ...(type === "w" ? { workspace: value } : { area: value }) });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as CaptureKind)} className={cn(PAPER_INPUT, "w-full")}>
            {(Object.keys(CAPTURE_KIND_LABEL) as CaptureKind[]).map((value) => (
              <option key={value} value={value}>
                {CAPTURE_KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Where it goes</span>
          <select value={home} onChange={(event) => setHome(event.target.value)} className={cn(PAPER_INPUT, "w-full")}>
            <optgroup label="Life areas">
              {triage.areas.map((area) => (
                <option key={area} value={`a:${area}`}>
                  {area.charAt(0).toUpperCase() + area.slice(1)}
                </option>
              ))}
            </optgroup>
            <optgroup label="Workspaces">
              {triage.workspaces.map((workspace) => (
                <option key={workspace.slug} value={`w:${workspace.slug}`}>
                  {workspace.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="sr-only">As</span>
        <input value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} className={cn(PAPER_INPUT, "w-full")} />
      </label>
      <div className="flex flex-wrap gap-2">
        <PaperButton type="submit" variant="amber" disabled={busy || !title.trim()}>
          {busy ? "Filing…" : "File it"}
        </PaperButton>
        <PaperButton type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </PaperButton>
      </div>
    </form>
  );
}
