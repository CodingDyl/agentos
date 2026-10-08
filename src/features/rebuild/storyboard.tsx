import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin, Plus, Trash2, X } from "lucide-react";
import type { PageNote } from "@shared/website-rebuild-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, SegmentedControl, Tag } from "@/components/paper";
import { cn } from "@/lib/utils";

import type { NoteState } from "./concept-viewer";
import { newNoteId, pinFromPoint, routeLabel, type PageChange, type PageShots } from "./storyboard-model";

type Viewport = "desktop" | "mobile";
const VIEWPORTS: readonly { value: Viewport; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Phone" },
];

export interface StoryboardProps {
  pages: PageShots[];
  /** Notes written on this revision, by route. */
  notes: Record<string, PageNote[]>;
  noteState: Record<string, NoteState | undefined>;
  onNotesChange: (route: string, notes: PageNote[]) => void;
  /** The page-by-page comparison with the revision before; empty on the first revision. */
  changes: PageChange[];
  /** Pages that had notes last round, so a page that was asked to change but did not can be called out. */
  previouslyNoted: readonly string[];
  /** The revision on screen and the one before it. */
  revision: number;
}

/**
 * The baseline as a storyboard: a strip of pages, each opening full screen at
 * its true length, with notes that belong to that page and can be pinned to a
 * spot on it. After a revision, a second tab lays the old and new page side by side.
 */
export function Storyboard({ pages, notes, noteState, onNotesChange, changes, previouslyNoted, revision }: StoryboardProps) {
  const [tab, setTab] = useState<"pages" | "changes">(changes.length > 0 ? "changes" : "pages");
  const [open, setOpen] = useState<string | null>(null);
  const changed = changes.filter((change) => change.changed);

  return (
    <div className="mt-3">
      {changes.length > 0 ? (
        <SegmentedControl
          label="Baseline view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "changes", label: `Changes (${changed.length})` },
            { value: "pages", label: `All pages (${pages.length})` },
          ]}
        />
      ) : null}

      {tab === "changes" && changes.length > 0 ? (
        <Changes changes={changed} unchangedNoted={previouslyNoted.filter((route) => changes.some((change) => change.route === route && !change.changed))} revision={revision} />
      ) : (
        <ul aria-label="Pages of the baseline" className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {pages.map((page) => {
            const count = notes[page.route]?.length ?? 0;
            const stale = changes.find((change) => change.route === page.route);
            return (
              <li key={page.route} className="w-[200px] shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(page.route)}
                  aria-label={`Open ${routeLabel(page.route)}${count > 0 ? `, ${count} note${count === 1 ? "" : "s"}` : ""}`}
                  className={cn("block w-full cursor-pointer border border-paper-mist bg-paper-white text-left transition-colors hover:bg-paper-linen", PAPER_FOCUS)}
                >
                  <span className="block h-[150px] overflow-hidden border-b border-paper-mist bg-paper-linen">
                    {page.desktop ? <img src={page.desktop.href} alt="" loading="lazy" className="w-full object-cover object-top" /> : <span className="block p-3 text-[12px] text-paper-sage">No desktop snapshot</span>}
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-2">
                    <span className="truncate text-[13px] font-semibold text-paper-moss">{routeLabel(page.route)}</span>
                    <span className="flex gap-1">
                      {stale?.changed ? <Tag tone="green">Changed</Tag> : null}
                      {count > 0 ? <Tag tone="blue">{count} note{count === 1 ? "" : "s"}</Tag> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <PageViewer
          pages={pages}
          route={open}
          onRouteChange={setOpen}
          onClose={() => setOpen(null)}
          notes={notes}
          noteState={noteState}
          onNotesChange={onNotesChange}
        />
      ) : null}
    </div>
  );
}

/** Old and new page beside each other, scrolling together, for the pages a revision changed. */
function Changes({ changes, unchangedNoted, revision }: { changes: PageChange[]; unchangedNoted: string[]; revision: number }) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  return (
    <div className="mt-3 grid gap-4">
      <SegmentedControl label="Width" value={viewport} onChange={setViewport} options={VIEWPORTS} />
      {unchangedNoted.length > 0 ? (
        <p role="status" className="max-w-[75ch] text-[13px] text-paper-flame-deep">
          No visible change on {unchangedNoted.map(routeLabel).join(", ")}, although you left notes there. Check the notes, or send them again.
        </p>
      ) : null}
      {changes.length === 0 ? <p className="text-[13px] text-paper-sage">Nothing on the site looks different from revision {revision - 1}.</p> : null}
      {changes.map((change) => (
        <BeforeAfter key={change.route} change={change} viewport={viewport} revision={revision} />
      ))}
    </div>
  );
}

function BeforeAfter({ change, viewport, revision }: { change: PageChange; viewport: Viewport; revision: number }) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  // Scrolling one side scrolls the other, so the same part of the page is compared.
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };
  const before = change.before?.[viewport];
  const after = change.after[viewport];
  const frame = cn("max-h-[70dvh] overflow-y-auto border border-paper-mist bg-paper-linen", viewport === "mobile" && "mx-auto w-[min(100%,390px)]");
  return (
    <section aria-label={`${routeLabel(change.route)}, before and after`}>
      <h4 className="mb-1.5 text-[13px] font-semibold text-paper-moss">
        {routeLabel(change.route)} {change.before ? null : <Tag tone="green">New page</Tag>}
      </h4>
      <div className="grid gap-3 md:grid-cols-2">
        <figure className="min-w-0">
          <figcaption className="mb-1 text-[12px] text-paper-sage">Before, revision {revision - 1}</figcaption>
          <div ref={left} onScroll={() => follow(left.current, right.current)} tabIndex={0} aria-label={`${routeLabel(change.route)} before`} className={cn(frame, PAPER_FOCUS)}>
            {before ? <img src={before.href} alt={`${routeLabel(change.route)} before, ${viewport} width`} className="w-full" loading="lazy" /> : <p className="p-3 text-[12px] text-paper-sage">This page did not exist.</p>}
          </div>
        </figure>
        <figure className="min-w-0">
          <figcaption className="mb-1 text-[12px] text-paper-sage">After, revision {revision}</figcaption>
          <div ref={right} onScroll={() => follow(right.current, left.current)} tabIndex={0} aria-label={`${routeLabel(change.route)} after`} className={cn(frame, PAPER_FOCUS)}>
            {after ? <img src={after.href} alt={`${routeLabel(change.route)} after, ${viewport} width`} className="w-full" loading="lazy" /> : <p className="p-3 text-[12px] text-paper-sage">No snapshot.</p>}
          </div>
        </figure>
      </div>
    </section>
  );
}

interface PageViewerProps {
  pages: PageShots[];
  route: string;
  onRouteChange: (route: string) => void;
  onClose: () => void;
  notes: Record<string, PageNote[]>;
  noteState: Record<string, NoteState | undefined>;
  onNotesChange: (route: string, notes: PageNote[]) => void;
}

/** One page up close: scrolls at its true length; click to pin a note to a spot. A native modal dialog, so focus is trapped and Escape closes it. */
function PageViewer({ pages, route, onRouteChange, onClose, notes, noteState, onNotesChange }: PageViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [pinning, setPinning] = useState(false);
  const index = pages.findIndex((page) => page.route === route);
  const page = pages[index];
  const list = notes[route] ?? [];
  const shot = page?.[viewport];
  const state = noteState[route] ?? "idle";

  useEffect(() => {
    const element = dialog.current;
    // No close on cleanup: removing the dialog releases it, and a close here would fire onClose straight away under StrictMode.
    if (element && !element.open) element.showModal();
  }, []);

  const go = (step: number) => {
    const next = pages[index + step];
    if (next) {
      setPinning(false);
      onRouteChange(next.route);
    }
  };
  const update = (id: string, patch: Partial<PageNote>) => onNotesChange(route, list.map((note) => (note.id === id ? { ...note, ...patch } : note)));
  const remove = (id: string) => onNotesChange(route, list.filter((note) => note.id !== id));
  const add = (pin?: { x: number; y: number }) => {
    const id = newNoteId();
    // The empty note is the field being written in; it is only kept once it has words.
    onNotesChange(route, [...list, { id, text: "", viewport, ...pin }]);
    // A new note gets the keyboard once it is on screen, so writing it needs no extra click.
    setTimeout(() => document.getElementById(`note-${id}`)?.focus(), 0);
  };

  return (
    <dialog
      ref={dialog}
      aria-label={`${routeLabel(route)} snapshot`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
        if (event.key === "ArrowLeft") go(-1);
        if (event.key === "ArrowRight") go(1);
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(1240px,calc(100vw-32px))] overflow-hidden border border-paper-mist bg-paper-white p-0 text-paper-char backdrop:bg-black/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-mist px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-paper-display text-[18px] font-bold text-paper-moss">{routeLabel(route)}</h3>
          <span className="text-[12px] text-paper-sage">
            Page {index + 1} of {pages.length}
          </span>
          <SegmentedControl label="Width" value={viewport} onChange={(next) => { setViewport(next); setPinning(false); }} options={VIEWPORTS} />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous page" className={cn("inline-flex size-9 cursor-pointer items-center justify-center hover:bg-paper-linen disabled:cursor-not-allowed disabled:opacity-40", PAPER_FOCUS)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(1)} disabled={index >= pages.length - 1} aria-label="Next page" className={cn("inline-flex size-9 cursor-pointer items-center justify-center hover:bg-paper-linen disabled:cursor-not-allowed disabled:opacity-40", PAPER_FOCUS)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close viewer" className={cn("inline-flex size-9 cursor-pointer items-center justify-center hover:bg-paper-linen", PAPER_FOCUS)}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid max-h-[calc(100dvh-32px-61px)] gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="max-h-[60dvh] min-w-0 overflow-auto bg-paper-linen p-3 lg:max-h-[calc(100dvh-32px-61px)]" tabIndex={0} aria-label={`${routeLabel(route)} ${viewport} snapshot, scrollable`}>
          {shot ? (
            <div className={cn("relative mx-auto", viewport === "mobile" ? "w-[390px] max-w-full" : "w-full")}>
              <img
                ref={image}
                src={shot.href}
                alt={`${routeLabel(route)} at ${viewport === "mobile" ? "phone" : "desktop"} width, full page`}
                className={cn("block w-full border border-paper-mist bg-paper-white", pinning && "cursor-crosshair")}
                onClick={(event) => {
                  if (!pinning || !image.current) return;
                  add(pinFromPoint(image.current.getBoundingClientRect(), event.clientX, event.clientY));
                  setPinning(false);
                }}
              />
              {list.map((note, position) =>
                note.viewport === viewport && note.x !== undefined && note.y !== undefined ? (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => document.getElementById(`note-${note.id}`)?.focus()}
                    aria-label={`Note ${position + 1}`}
                    style={{ left: `${note.x}%`, top: `${note.y}%` }}
                    className={cn("absolute inline-flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-paper-white bg-paper-blue text-[12px] font-bold text-paper-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]", PAPER_FOCUS)}
                  >
                    {position + 1}
                  </button>
                ) : null,
              )}
            </div>
          ) : (
            <p className="p-4 text-[13px] text-paper-sage">There is no {viewport === "mobile" ? "phone" : "desktop"} snapshot of this page.</p>
          )}
        </div>

        <div className="grid max-h-[calc(100dvh-32px-61px)] content-start gap-3 overflow-y-auto border-t border-paper-mist p-4 lg:border-l lg:border-t-0">
          <div className="flex flex-wrap gap-2">
            <PaperButton variant={pinning ? "amber" : "quiet"} aria-pressed={pinning} disabled={!shot} onClick={() => setPinning((current) => !current)}>
              <MapPin className="size-3.5" aria-hidden="true" /> {pinning ? "Click the page" : "Pin a note"}
            </PaperButton>
            <PaperButton onClick={() => add()}>
              <Plus className="size-3.5" aria-hidden="true" /> Note on the whole page
            </PaperButton>
          </div>
          {pinning ? (
            <p role="status" className="text-[12.5px] text-paper-sage">
              Click the spot on the {viewport === "mobile" ? "phone" : "desktop"} snapshot this note is about.
            </p>
          ) : null}

          {list.length === 0 ? <p className="text-[13px] text-paper-sage">No notes on this page.</p> : null}
          <ol className="grid gap-3">
            {list.map((note, position) => (
              <li key={note.id} className="grid gap-1.5 border border-paper-mist p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`note-${note.id}`}>
                    <FieldLabel>
                      Note {position + 1}
                      <span className="font-normal text-paper-sage"> · {note.x !== undefined ? `pinned on ${note.viewport === "mobile" ? "phone" : "desktop"}` : "whole page"}</span>
                    </FieldLabel>
                  </label>
                  <button type="button" onClick={() => remove(note.id)} aria-label={`Delete note ${position + 1}`} className={cn("inline-flex size-8 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-linen hover:text-paper-flame-deep", PAPER_FOCUS)}>
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                <textarea
                  id={`note-${note.id}`}
                  className={cn(PAPER_INPUT, "min-h-24 w-full py-2")}
                  value={note.text}
                  maxLength={2000}
                  placeholder="What should change here?"
                  onChange={(event) => update(note.id, { text: event.target.value })}
                />
                <input
                  className={cn(PAPER_INPUT, "w-full")}
                  aria-label={`Section for note ${position + 1}`}
                  value={note.section ?? ""}
                  maxLength={120}
                  placeholder="Section it is about (optional)"
                  onChange={(event) => update(note.id, { section: event.target.value || undefined })}
                />
              </li>
            ))}
          </ol>
          <span role="status" className={cn("block min-h-4 text-[12px]", state === "error" ? "text-paper-flame-deep" : "text-paper-sage")}>
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved with this revision" : state === "error" ? "Could not save. Edit again to retry." : ""}
          </span>
        </div>
      </div>
    </dialog>
  );
}
