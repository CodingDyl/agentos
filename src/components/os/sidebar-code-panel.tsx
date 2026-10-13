import { useEffect, useState } from "react";
import { CODE_SNIPPETS, frameAt, type SyntaxKind } from "./sidebar-code-panel-model";

const CHAR_MS = 42;
const PAUSE_MS = 1400;
const TICK_MS = 50;

const KIND_CLASS: Record<SyntaxKind, string> = {
  keyword: "os-code-kw",
  ident: "os-code-id",
  string: "os-code-str",
  comment: "os-code-cm",
  punct: "os-code-punct",
  plain: "os-code-plain",
  type: "os-code-type",
  fn: "os-code-fn",
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

/**
 * A tiny editor that types itself, in place of the old sidebar print.
 *
 * Decorative: it is hidden from assistive technology, uses theme tokens, and
 * freezes on a finished frame when the operator asked for less motion.
 */
export function SidebarCodePanel() {
  const reducedMotion = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => setElapsed((current) => current + TICK_MS), TICK_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const frame = frameAt(elapsed, { charMs: CHAR_MS, pauseMs: PAUSE_MS, reducedMotion });
  const filename = CODE_SNIPPETS[frame.snippetIndex]?.filename ?? "agentos.ts";

  return (
    <div className="os-code-panel" aria-hidden="true">
      <div className="os-code-panel-chrome">
        <span className="os-code-dot os-code-dot-close" />
        <span className="os-code-dot os-code-dot-min" />
        <span className="os-code-dot os-code-dot-max" />
        <span className="os-code-panel-title">{filename}</span>
      </div>
      <pre className="os-code-panel-body">
        {frame.lines.map((line, lineIndex) => (
          <div key={lineIndex} className="os-code-line">
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} className={KIND_CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
            {!reducedMotion && lineIndex === frame.cursor.line ? <span className="os-code-cursor" /> : null}
          </div>
        ))}
      </pre>
    </div>
  );
}
