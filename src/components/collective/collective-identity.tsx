import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Irregular paper is decorative; heading semantics stay on the caller. */
export function PaperLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("collective-paper-label", className)}>{children}</span>;
}

export function DecorativeTape() {
  return <span className="collective-tape" aria-hidden="true" />;
}

/** Original circuit-mask print. SVG dots provide halftone without a raster download. */
export function CollectiveArtwork() {
  const id = useId();
  return (
    <svg className="collective-artwork" viewBox="0 0 280 200" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${id}-dots`} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="currentColor" /></pattern>
      </defs>
      <path d="M26 168 47 65 111 10 174 21 225 76 247 177 197 193 68 187Z" fill={`url(#${id}-dots)`} />
      <path d="m55 161 28-96 51-32 49 39 24 92-44 20-61-7Z" fill="var(--color-canvas)" stroke="currentColor" strokeWidth="3" />
      <path d="m84 83 40-16 47 4 22 27-15 56-31 19-40-19Z" fill="currentColor" />
      <path d="m84 84 45 14 56-10-8 35-30-9-44 8Z" fill="var(--color-canvas)" />
      <path d="m102 101 19 6m34-1 17-7" stroke="currentColor" strokeWidth="4" />
      <path d="m106 137 63-7-8 21-17 11-27-10Z" fill={`url(#${id}-dots)`} stroke="var(--color-canvas)" strokeWidth="2" />
      <path d="m41 93 23-6M20 119l42-13m155-22 36 9m-32 19 41 11M83 29l-13-9m121 13 20-15" stroke="currentColor" strokeWidth="3" />
      <path d="M6 154h36v24H18m226-22h27v-18M50 36h17V19" stroke="currentColor" strokeWidth="2" />
      <path d="m202 155 47-13-5 15-47 13Z" fill="var(--primary)" />
      <path d="m30 53 42-15 5 15-42 15Z" fill="var(--color-brand)" />
      <path d="M78 181h103M90 188h63" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
