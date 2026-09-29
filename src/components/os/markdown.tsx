import { marked, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Two skins for the same renderer. `os` is the Editorial Terminal default;
 * `paper` is for screens that have moved to the paper world, where the dark
 * tokens would print cream on white.
 */
export type MarkdownTone = "os" | "paper";

interface Skin {
  root: string;
  strong: string;
  code: string;
  link: string;
  image: string;
  heading: string;
  marker: string;
  taskBox: string;
  taskBoxDone: string;
  taskDone: string;
  tableWrap: string;
  thead: string;
  th: string;
  tbody: string;
  td: string;
  pre: string;
  preText: string;
  lang: string;
  codeText: string;
  quote: string;
  rule: string;
}

const SKINS: Record<MarkdownTone, Skin> = {
  os: {
    root: "text-[15px] text-os-muted",
    strong: "font-medium text-foreground",
    code: "rounded-sm bg-os-surface-raised px-1.5 py-0.5 font-mono text-[0.9em] text-foreground",
    link: "os-focus-ring rounded-sm underline decoration-os-border-strong underline-offset-[0.25em] hover:decoration-os-amber",
    image: "border-os-border",
    heading: "font-normal tracking-[-0.01em] text-foreground",
    marker: "marker:text-os-subtle",
    taskBox: "border-os-border-strong",
    taskBoxDone: "border-os-success bg-os-success/20",
    taskDone: "text-os-subtle line-through decoration-os-border",
    tableWrap: "rounded-md border-os-border",
    thead: "border-b border-os-border bg-os-surface-raised/60",
    th: "os-meta font-normal text-os-subtle",
    tbody: "divide-os-border",
    td: "text-foreground",
    pre: "rounded-md border-os-border bg-os-surface-raised",
    preText: "text-os-subtle",
    lang: "os-meta text-os-subtle",
    codeText: "text-foreground",
    quote: "border-os-border text-os-subtle",
    rule: "border-os-border",
  },
  paper: {
    root: "font-paper-ui text-[15px] text-paper-char",
    strong: "font-semibold text-paper-moss",
    code: "rounded-none bg-paper-linen px-1.5 py-0.5 font-mono text-[0.9em] text-paper-moss",
    link: "rounded-[2px] text-paper-blue underline underline-offset-[0.2em] hover:text-paper-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue",
    image: "border-paper-mist",
    heading: "font-paper-display font-bold tracking-[-0.01em] text-paper-moss",
    marker: "marker:text-paper-sage",
    taskBox: "border-paper-sage",
    taskBoxDone: "border-paper-green bg-paper-green",
    taskDone: "text-paper-sage line-through",
    tableWrap: "rounded-none border-paper-mist",
    thead: "border-b border-paper-mist bg-paper-linen",
    th: "text-[12.5px] font-semibold text-paper-char",
    tbody: "divide-paper-mist",
    td: "text-paper-moss",
    pre: "rounded-none border-paper-mist bg-paper-linen",
    preText: "text-paper-sage",
    lang: "text-[11.5px] text-paper-sage",
    codeText: "text-paper-moss",
    quote: "border-paper-mist text-paper-sage",
    rule: "border-paper-mist",
  },
};

/**
 * Renders markdown as React elements.
 *
 * Agent output is never injected as HTML. Tokens are walked and turned into
 * elements, so a reply containing markup or a `javascript:` URL cannot execute
 * anything — the worst case is that it renders as text.
 *
 * Covers what agent-written documents actually use: headings, lists and task
 * lists, tables, fenced code, quotes, links and remote images. Raw HTML — the
 * one thing a Markdown file could smuggle in — is rendered as text.
 */

const SAFE_LINK = /^(https?:|mailto:)/i;

function safeHref(href: string): string | undefined {
  return SAFE_LINK.test(href.trim()) ? href : undefined;
}

/** Inline tokens: emphasis, code spans, links, line breaks. */
function renderInline(tokens: Token[] | undefined, keyPrefix: string, t: Skin): ReactNode {
  if (!tokens) return null;

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (token.type) {
      case "strong":
        return (
          <strong key={key} className={t.strong}>
            {renderInline((token as Tokens.Strong).tokens, key, t)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic">
            {renderInline((token as Tokens.Em).tokens, key, t)}
          </em>
        );
      case "codespan":
        return (
          <code
            key={key}
            className={t.code}
          >
            {(token as Tokens.Codespan).text}
          </code>
        );
      case "link": {
        const link = token as Tokens.Link;
        const href = safeHref(link.href);
        const content = renderInline(link.tokens, key, t);

        return href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={t.link}
          >
            {content}
          </a>
        ) : (
          <Fragment key={key}>{content}</Fragment>
        );
      }
      case "del":
        return (
          <del key={key} className="line-through">
            {renderInline((token as Tokens.Del).tokens, key, t)}
          </del>
        );
      case "br":
        return <br key={key} />;
      case "escape":
        return <Fragment key={key}>{(token as Tokens.Escape).text}</Fragment>;
      case "image": {
        // Only remote http(s) images render; anything else is shown as its
        // alt text. A `data:` or file URL from an agent-written document is
        // not something the console should fetch on its behalf.
        const image = token as Tokens.Image;
        const src = safeHref(image.href);

        return src ? (
          <img
            key={key}
            src={src}
            alt={image.text}
            title={image.title ?? undefined}
            loading="lazy"
            className={cn("my-2 max-h-[32rem] max-w-full rounded-md border", t.image)}
          />
        ) : (
          <Fragment key={key}>{image.text}</Fragment>
        );
      }
      case "html":
        // Raw HTML is rendered as text, never as markup.
        return <Fragment key={key}>{(token as Tokens.HTML).text}</Fragment>;
      default:
        return (
          <Fragment key={key}>{(token as { raw: string }).raw}</Fragment>
        );
    }
  });
}

const HEADING_CLASSES: Record<number, string> = {
  1: "text-[1.375rem] leading-[1.15]",
  2: "text-[1.25rem] leading-[1.2]",
  3: "text-[1.0625rem] leading-[1.3]",
};

function renderBlock(token: Token, key: string, t: Skin): ReactNode {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      const level = Math.min(Math.max(heading.depth, 1), 6);
      const Tag = `h${level}` as "h1";

      return (
        <Tag
          key={key}
          className={cn(
            "mt-6 first:mt-0",
            t.heading,
            HEADING_CLASSES[level] ?? "text-[15px] leading-6",
          )}
        >
          {renderInline(heading.tokens, key, t)}
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p key={key} className="mt-4 leading-6 first:mt-0">
          {renderInline((token as Tokens.Paragraph).tokens, key, t)}
        </p>
      );

    case "list": {
      const list = token as Tokens.List;
      const Tag = list.ordered ? "ol" : "ul";

      return (
        <Tag
          key={key}
          start={list.ordered && list.start ? Number(list.start) : undefined}
          className={cn(
            "mt-4 space-y-2 first:mt-0",
            list.ordered ? "list-decimal" : "list-disc",
            t.marker,
            "ps-5",
          )}
        >
          {list.items.map((item, index) => {
            const itemKey = `${key}-${index}`;
            // A list item holds blocks (a paragraph, maybe a nested list); the
            // paragraph is unwrapped so the bullet and the text share a line.
            const body = item.tokens.map((child, childIndex) =>
              child.type === "paragraph" || child.type === "text"
                ? renderInline((child as Tokens.Paragraph).tokens ?? [], `${itemKey}-${childIndex}`, t)
                : renderBlock(child, `${itemKey}-${childIndex}`, t),
            );

            return (
              <li key={itemKey} className={cn("leading-6", item.task && "list-none -ms-5")}>
                {item.task ? (
                  <span className="inline-flex items-start gap-2.5">
                    <span
                      role="checkbox"
                      aria-checked={item.checked ?? false}
                      aria-disabled="true"
                      className={cn(
                        "mt-1.5 inline-block size-3.5 shrink-0 rounded-sm border",
                        item.checked ? t.taskBoxDone : t.taskBox,
                      )}
                    />
                    <span className={item.checked ? t.taskDone : undefined}>
                      {body}
                    </span>
                  </span>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </Tag>
      );
    }

    case "table": {
      const table = token as Tokens.Table;

      return (
        <div key={key} className={cn("mt-4 overflow-x-auto border first:mt-0", t.tableWrap)}>
          <table className="w-full border-collapse text-[14px] leading-5">
            <thead>
              <tr className={t.thead}>
                {table.header.map((cell, index) => (
                  <th
                    key={`${key}-h-${index}`}
                    className={cn("px-3 py-2 text-left", t.th)}
                    style={{ textAlign: table.align[index] ?? undefined }}
                  >
                    {renderInline(cell.tokens, `${key}-h-${index}`, t)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn("divide-y", t.tbody)}>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${key}-r-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${key}-r-${rowIndex}-${cellIndex}`}
                      className={cn("px-3 py-2 align-top", t.td)}
                      style={{ textAlign: table.align[cellIndex] ?? undefined }}
                    >
                      {renderInline(cell.tokens, `${key}-r-${rowIndex}-${cellIndex}`, t)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "html":
      // A block of raw HTML is shown as what it is — text — in a code-like
      // block, so an agent-written document can never inject markup here.
      return (
        <pre
          key={key}
          className={cn("mt-4 overflow-x-auto border p-4 first:mt-0", t.pre)}
        >
          <code className={cn("font-mono text-[13px] leading-5", t.preText)}>{(token as Tokens.HTML).text}</code>
        </pre>
      );

    case "code": {
      const code = token as Tokens.Code;

      return (
        <pre
          key={key}
          className={cn("relative mt-4 overflow-x-auto border p-4 first:mt-0", t.pre)}
        >
          {code.lang ? (
            <span className={cn("absolute top-2 right-3", t.lang)}>{code.lang}</span>
          ) : null}
          <code className={cn("font-mono text-[13px] leading-5", t.codeText)}>{code.text}</code>
        </pre>
      );
    }

    case "blockquote":
      return (
        <blockquote
          key={key}
          className={cn("mt-4 border-s ps-4 first:mt-0", t.quote)}
        >
          {(token as Tokens.Blockquote).tokens.map((child, index) =>
            renderBlock(child, `${key}-${index}`, t),
          )}
        </blockquote>
      );

    case "hr":
      return <hr key={key} className={cn("mt-6", t.rule)} />;

    case "space":
      return null;

    default: {
      const raw = (token as { raw?: string }).raw?.trim();
      return raw ? (
        <p key={key} className="mt-4 leading-6 first:mt-0">
          {raw}
        </p>
      ) : null;
    }
  }
}

export interface MarkdownProps {
  content: string;
  className?: string;
  /** Which world's colours to draw in. Defaults to the Editorial Terminal. */
  tone?: MarkdownTone;
}

export function Markdown({ content, className, tone = "os" }: MarkdownProps) {
  const skin = SKINS[tone];
  // GFM: tables and task lists are part of what agents write.
  const tokens = marked.lexer(content, { gfm: true });

  return (
    <div className={cn(skin.root, className)}>
      {tokens.map((token, index) => renderBlock(token, `block-${index}`, skin))}
    </div>
  );
}
