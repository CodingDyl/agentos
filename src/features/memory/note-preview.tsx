import { Marked, type Token } from "marked";
import { CircleAlert, CircleDashed, Paperclip, Split, X } from "lucide-react";
import type { ReactNode } from "react";
import { memoryMarkdownExtensions, type WikiLinkToken } from "@shared/memory-markdown";
import type { MemoryLink, MemoryNoteDetail } from "@shared/memory-types";
import { Markdown, type InlineOverride } from "@/components/os/markdown";
import { PAPER_FOCUS, PaperButton, PaperError, Tag } from "@/components/paper";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One note, as it reads — and everything it touches.
 *
 * The body is rendered by the shared token renderer (React elements, never
 * HTML), with the same Obsidian lexer the index uses: a link in the preview is
 * exactly a link in the graph. Resolved links navigate inside Memory;
 * unresolved and ambiguous ones say so instead of guessing, and never create
 * anything.
 */

const lexer = new Marked({ extensions: memoryMarkdownExtensions, gfm: true });

const LINK_BUTTON = cn(
  "cursor-pointer text-paper-blue underline decoration-paper-blue/40 underline-offset-[0.2em] hover:decoration-paper-blue",
  PAPER_FOCUS,
);

function titleFor(id: string): string {
  return (id.split("/").pop() ?? id).replace(/\.md$/i, "");
}

function renderLink(link: MemoryLink | undefined, label: ReactNode, onOpen: (id: string) => void): ReactNode {
  if (!link) return label;

  switch (link.resolution) {
    case "resolved":
    case "self":
      return link.targetId && link.resolution === "resolved" ? (
        <button type="button" className={LINK_BUTTON} onClick={() => onOpen(link.targetId!)} title={link.targetId}>
          {label}
        </button>
      ) : (
        <span className="text-paper-blue" title={link.heading ? `This note § ${link.heading}` : "This note"}>
          {label}
        </span>
      );
    case "ambiguous":
      return (
        <span className="border-b border-dotted border-paper-flame-deep text-paper-moss" title={`Ambiguous — matches ${link.candidates?.join(", ")}`}>
          {label}
        </span>
      );
    case "attachment":
      return (
        <span className="inline-flex items-baseline gap-1 text-paper-sage" title={link.attachment ?? `Attachment not found: ${link.target}`}>
          <Paperclip className="size-3.5 self-center" strokeWidth={1.75} aria-hidden="true" />
          {label}
        </span>
      );
    default:
      return (
        <span className="border-b border-dashed border-paper-sage text-paper-sage" title={`No note called “${link.target}” — nothing is created`}>
          {label}
        </span>
      );
  }
}

export function NotePreview({
  note,
  isLoading,
  error,
  onOpen,
  onClose,
  closeLabel = "Close",
  className,
}: {
  note?: MemoryNoteDetail;
  isLoading: boolean;
  error?: Error | null;
  onOpen: (id: string) => void;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}) {
  if (error && !note) {
    return (
      <aside className={cn("p-5", className)} aria-label="Note">
        <PaperError headingLevel="h2" title="This note could not be opened." detail={error.message} />
      </aside>
    );
  }

  if (!note) {
    return (
      <aside className={cn("flex flex-col justify-center p-8", className)} aria-label="Note">
        {isLoading ? (
          <p role="status" className="text-[14px] text-paper-sage">Opening the note…</p>
        ) : (
          <div className="max-w-[34ch]">
            <p className="font-paper-display text-[19px] leading-6 font-bold text-paper-moss">No note open</p>
            <p className="mt-2 text-[14px] leading-6 text-paper-char">
              Pick a node in the graph or a note from the list. Links inside a note open the note they point to.
            </p>
          </div>
        )}
      </aside>
    );
  }

  const byRaw = new Map(note.links.map((link) => [link.raw, link]));
  const inline: InlineOverride = (token: Token, _key, children) => {
    if (token.type === "wikilink") {
      const wiki = token as WikiLinkToken;
      const link = byRaw.get(wiki.raw);
      const label = wiki.parts.label ?? (wiki.parts.target ? `${wiki.parts.target}${wiki.parts.heading ? ` › ${wiki.parts.heading}` : ""}` : wiki.parts.heading ?? wiki.inner);
      return wiki.embed && link?.resolution === "resolved" ? (
        <span className="inline-flex items-baseline gap-1">
          <span className="font-paper-utility text-[11px] tracking-[0.08em] text-paper-sage uppercase">Embeds</span>
          {renderLink(link, label, onOpen)}
        </span>
      ) : (
        renderLink(link, label, onOpen)
      );
    }
    if (token.type === "obsidianComment") return null;
    if (token.type === "link" || token.type === "image") {
      const link = byRaw.get((token as { raw: string }).raw);
      if (link) {
        const text = token.type === "image" ? (token as { text: string }).text || link.target : children((token as { tokens?: Token[] }).tokens);
        return renderLink(link, text, onOpen);
      }
    }
    return undefined;
  };

  const outgoing = note.links.filter((link) => link.resolution !== "self");
  const resolved = [...new Map(outgoing.filter((link) => link.resolution === "resolved").map((link) => [link.targetId!, link])).values()];
  const unresolved = outgoing.filter((link) => link.resolution === "unresolved");
  const ambiguous = outgoing.filter((link) => link.resolution === "ambiguous");
  const attachments = outgoing.filter((link) => link.resolution === "attachment");

  return (
    <aside className={cn("flex min-h-0 flex-col", className)} aria-label={`Note: ${note.title}`}>
      <div className="flex items-start gap-3 border-b border-paper-mist px-5 pt-4 pb-3.5">
        <div className="min-w-0 flex-1">
          <h2 data-heading="compact" className="font-paper-display text-[22px] leading-[1.15] font-bold tracking-[-0.015em] text-paper-moss text-balance">
            {note.title}
          </h2>
          <p className="mt-1 truncate font-mono text-[12px] text-paper-sage" title={note.id}>{note.id}</p>
        </div>
        {onClose ? (
          <PaperButton variant="quiet" className="-mr-2 px-2" onClick={onClose} aria-label={closeLabel}>
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </PaperButton>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 border-b border-paper-mist px-5 py-3 text-[12.5px] text-paper-sage">
          <p className="tabular-nums">
            Edited {formatRelativeTime(note.modifiedAt)} · {note.backlinkCount} backlink{note.backlinkCount === 1 ? "" : "s"} · {note.outgoingCount} outgoing ·{" "}
            <span className="font-mono" title={note.hash}>#{note.hash.slice(0, 8)}</span>
          </p>
          {note.tags.length > 0 || note.aliases.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {note.tags.map((tag) => (
                <Tag key={tag} tone="muted" className="normal-case tracking-normal">#{tag}</Tag>
              ))}
              {note.aliases.map((alias) => (
                <span key={alias} className="text-[12.5px] text-paper-char">aka “{alias}”</span>
              ))}
            </div>
          ) : null}
          {note.stale ? (
            <p className="flex items-center gap-1.5 font-medium text-paper-flame-deep">
              <CircleAlert className="size-3.5" strokeWidth={2} aria-hidden="true" /> Stale — the vault is disconnected; this is the last indexed copy.
            </p>
          ) : null}
          {note.errors.map((problem) => (
            <p key={problem} className="flex items-center gap-1.5 text-paper-flame-deep">
              <CircleAlert className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> {problem}
            </p>
          ))}
        </div>

        <div className="px-5 py-5">
          {note.content.trim() ? (
            <Markdown content={note.content} tone="paper" lexer={lexer} inline={inline} className="max-w-[68ch] break-words" />
          ) : (
            <p className="text-[14px] text-paper-sage">This note is empty.</p>
          )}
          {note.truncated ? <p className="mt-4 text-[13px] text-paper-sage">The note is long; only the first 256 KB is shown.</p> : null}
        </div>

        <LinkSection title="Backlinks" count={note.backlinks.length} empty="Nothing links here yet.">
          {note.backlinks.map((backlink) => (
            <li key={backlink.sourceId}>
              <button type="button" className={cn("group flex w-full items-baseline gap-2 px-5 py-2 text-left hover:bg-paper-linen", PAPER_FOCUS)} onClick={() => onOpen(backlink.sourceId)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-paper-moss group-hover:text-paper-blue">{backlink.sourceTitle}</span>
                  <span className="block truncate font-mono text-[11.5px] text-paper-sage">{backlink.sourceId}</span>
                </span>
                {backlink.count > 1 ? <span className="text-[12px] text-paper-sage tabular-nums">×{backlink.count}</span> : null}
              </button>
            </li>
          ))}
        </LinkSection>

        <LinkSection title="Outgoing" count={resolved.length + unresolved.length + ambiguous.length} empty="This note links nowhere.">
          {resolved.map((link) => (
            <li key={link.targetId}>
              <button type="button" className={cn("group flex w-full items-baseline gap-2 px-5 py-2 text-left hover:bg-paper-linen", PAPER_FOCUS)} onClick={() => onOpen(link.targetId!)}>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-paper-moss group-hover:text-paper-blue">{titleFor(link.targetId!)}</span>
                <span className="truncate font-mono text-[11.5px] text-paper-sage">{link.targetId}</span>
              </button>
            </li>
          ))}
          {ambiguous.map((link) => (
            <li key={`a-${link.raw}-${link.line}`} className="flex items-start gap-2 px-5 py-2 text-[13.5px]">
              <Split className="mt-0.5 size-3.5 shrink-0 text-paper-flame-deep" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-mono text-[12.5px] text-paper-moss">{link.raw}</span>
                <span className="text-paper-char"> is ambiguous (line {link.line}) — matches </span>
                {link.candidates?.map((candidate, index) => (
                  <span key={candidate}>
                    {index > 0 ? ", " : ""}
                    <button type="button" className={LINK_BUTTON} onClick={() => onOpen(candidate)}>{candidate}</button>
                  </span>
                ))}
              </span>
            </li>
          ))}
          {unresolved.map((link) => (
            <li key={`u-${link.raw}-${link.line}`} className="flex items-start gap-2 px-5 py-2 text-[13.5px]">
              <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-paper-sage" strokeWidth={2} aria-hidden="true" />
              <span>
                <span className="font-mono text-[12.5px] text-paper-moss">{link.raw}</span>
                <span className="text-paper-sage"> — no such note (line {link.line})</span>
              </span>
            </li>
          ))}
        </LinkSection>

        {attachments.length > 0 ? (
          <LinkSection title="Attachments" count={attachments.length} empty="">
            {attachments.map((link) => (
              <li key={`f-${link.raw}-${link.line}`} className="flex items-center gap-2 px-5 py-2 text-[13.5px] text-paper-char">
                <Paperclip className="size-3.5 shrink-0 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate font-mono text-[12.5px]">{link.attachment ?? link.target}</span>
                {!link.attachment ? <span className="text-paper-sage">(missing)</span> : null}
              </li>
            ))}
          </LinkSection>
        ) : null}
      </div>
    </aside>
  );
}

function LinkSection({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-paper-mist py-3">
      <h3 className="flex items-center gap-2 px-5 pb-1.5 font-paper-utility text-[12px] font-semibold tracking-[0.1em] text-paper-char uppercase">
        {title}
        <span className="bg-paper-stone px-1.5 font-paper-ui text-[11.5px] font-medium tracking-normal tabular-nums">{count}</span>
      </h3>
      {count === 0 ? <p className="px-5 py-1 text-[13.5px] text-paper-sage">{empty}</p> : <ul>{children}</ul>}
    </section>
  );
}
