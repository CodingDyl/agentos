import { ExternalLink, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DesignAsset } from "@shared/agentos-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSwitch } from "@/components/paper";
import { formatAdded } from "@/features/designs";
import type { TastePatch } from "@/lib/agentos/taste";
import { cn } from "@/lib/utils";
import { isWebUrl, parseTags, shortUrl, toggleAttachment } from "./taste-model";

export interface TasteDetailProps {
  asset: DesignAsset;
  workspaces: readonly { slug: string; name: string }[];
  /** Why the last change was refused, when it was. */
  error?: string;
  onClose: () => void;
  onPatch: (patch: TastePatch) => void;
  onDelete: () => void;
}

/**
 * One reference, at full size, with why it was kept and where it is used.
 *
 * Built like Creative's asset view (the image has the room, each change is
 * saved as it is made), but with a reference's own fields: the why-note, a
 * snippet, and the workspaces whose agents are shown it.
 */
export function TasteDetail({ asset, workspaces, error, onClose, onPatch, onDelete }: TasteDetailProps) {
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [snippet, setSnippet] = useState(asset.snippet ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [shownId, setShownId] = useState(asset.id);
  const closeButton = useRef<HTMLButtonElement>(null);

  // A different reference is a different set of drafts; adjusted during render
  // so the fields never paint once with the previous reference's text.
  if (shownId !== asset.id) {
    setShownId(asset.id);
    setNotes(asset.notes ?? "");
    setTags(asset.tags.join(", "));
    setSnippet(asset.snippet ?? "");
    setConfirmingDelete(false);
  }

  useEffect(() => {
    const opener = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Leaving a field saves it, so Escape never throws a draft away.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const commitNotes = () => {
    const next = notes.trim();
    if (next !== (asset.notes ?? "")) onPatch({ notes: next || null });
  };

  const commitTags = () => {
    const next = parseTags(tags);
    if (next.join(",") !== asset.tags.join(",")) onPatch({ tags: next });
  };

  const commitSnippet = () => {
    // Code keeps its indentation: only an all-blank snippet is cleared.
    const next = snippet.trim() ? snippet : "";
    if (next !== (asset.snippet ?? "")) onPatch({ snippet: next || null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[var(--scrim)]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={asset.filename}
        className="relative flex max-h-full w-[min(96vw,80rem)] flex-col overflow-y-auto rounded-md border border-paper-ash bg-paper-white text-paper-moss lg:flex-row lg:overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-center bg-paper-linen p-4 md:p-8 lg:min-h-0 lg:flex-1 lg:shrink">
          <img src={asset.url} alt={asset.filename} className="max-h-[40vh] max-w-full object-contain lg:max-h-[80vh]" />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-6 border-t border-paper-mist p-5 md:p-6 lg:w-96 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-[16px] leading-6 font-semibold tracking-[-0.01em] text-paper-moss">{asset.filename}</h2>
              <p className="mt-1 text-[13px] leading-5 text-paper-sage">
                Added {formatAdded(asset.createdAt)}
                {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
              </p>
            </div>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close"
              title="Close"
              onClick={onClose}
              className={cn("inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </header>

          {asset.sourceUrl ? (
            <div className="min-w-0">
              <FieldLabel>Source</FieldLabel>
              {isWebUrl(asset.sourceUrl) ? (
                <a
                  href={asset.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn("inline-flex max-w-full items-center gap-1.5 rounded-sm text-[14px] leading-5 text-paper-moss underline decoration-paper-ash underline-offset-4 hover:decoration-paper-moss", PAPER_FOCUS)}
                >
                  <span className="truncate">{shortUrl(asset.sourceUrl)}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
                </a>
              ) : (
                <p className="text-[14px] leading-5 break-all text-paper-char">{asset.sourceUrl}</p>
              )}
            </div>
          ) : null}

          <label className="block min-w-0">
            <FieldLabel>Why I like it</FieldLabel>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={commitNotes}
              rows={3}
              placeholder="The spacing, the type, how the pricing table reads…"
              className={cn(PAPER_INPUT, "w-full resize-y py-2")}
            />
          </label>

          <label className="block min-w-0">
            <FieldLabel>Tags</FieldLabel>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="dark, pricing, hero"
              className={cn(PAPER_INPUT, "w-full")}
            />
          </label>

          <label className="block min-w-0">
            <FieldLabel>Snippet</FieldLabel>
            <textarea
              value={snippet}
              onChange={(event) => setSnippet(event.target.value)}
              onBlur={commitSnippet}
              rows={5}
              spellCheck={false}
              placeholder="Code for the component, if there is any."
              className={cn(PAPER_INPUT, "w-full resize-y py-2 font-mono text-[12px] leading-[18px] whitespace-pre")}
            />
          </label>

          <div className="min-w-0">
            <FieldLabel>Attach to workspace</FieldLabel>
            <p className="text-[13px] leading-5 text-paper-sage">Claude is shown this before design work in each workspace switched on.</p>
            {workspaces.length === 0 ? (
              <p className="mt-2 text-[14px] leading-5 text-paper-char">There are no workspaces yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
                {workspaces.map((workspace) => (
                  <li key={workspace.slug} className="flex min-h-11 items-center justify-between gap-4 py-2">
                    <span className="min-w-0 truncate text-[14px] leading-5 text-paper-moss">{workspace.name}</span>
                    <PaperSwitch
                      checked={asset.attachedTo.includes(workspace.slug)}
                      label={`Attach to ${workspace.name}`}
                      onChange={() => onPatch({ attachedTo: toggleAttachment(asset.attachedTo, workspace.slug) })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error ? (
            <p role="alert" className="text-[14px] leading-5 text-paper-flame-deep">
              {error}
            </p>
          ) : null}

          <div className="mt-auto border-t border-paper-mist pt-5">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <PaperButton variant="danger" onClick={onDelete}>
                  Delete for good
                </PaperButton>
                <PaperButton variant="quiet" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </PaperButton>
              </div>
            ) : (
              <PaperButton variant="quiet" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </PaperButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
