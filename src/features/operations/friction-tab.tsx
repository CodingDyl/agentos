import type { ReactNode } from "react";
import { Check, EyeOff, RotateCcw } from "lucide-react";
import { pageNameForRoute, type FrictionTier, type RankedFrictionItem } from "@shared/friction-types";
import { PaperButton, Tag } from "@/components/paper";
import { useFriction, useUpdateFriction } from "@/lib/agentos/friction";
import { formatRelativeTime } from "@/lib/format";

/**
 * Friction, ranked.
 *
 * Every annoyance reported through ⌘K, sorted by frequency × severity — no
 * model, the same list always in the same order — so the next thing to fix is
 * the one at the top. Fixing or ignoring an item moves it out of the way
 * without deleting it.
 */

const TIERS: ReadonlyArray<{ tier: FrictionTier; label: string }> = [
  { tier: "high", label: "High value" },
  { tier: "medium", label: "Worth fixing" },
  { tier: "low", label: "Low" },
];

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function FrictionTab() {
  const friction = useFriction();
  const update = useUpdateFriction();

  if (friction.isPending) return <p className="text-[14px] text-paper-sage">Reading the friction inbox…</p>;
  if (friction.error || !friction.data) {
    return <p className="text-[14px] text-paper-flame-deep">{friction.error?.message ?? "Friction could not be read."}</p>;
  }

  const { open, closed } = friction.data;

  return (
    <div className="max-w-[880px]">
      <p className="max-w-[64ch] text-[14px] leading-6 text-paper-char">
        What has got in the way, worst first. Ranked by how often it happens × how much it hurts. Report more from anywhere with{" "}
        <kbd className="border border-paper-mist px-1 font-mono text-[12px]">⌘K</kbd> → Report friction.
      </p>

      {open.length === 0 ? (
        <p className="mt-6 text-[14px] text-paper-sage">Nothing open. Either AgentOS is behaving, or nobody has said otherwise yet.</p>
      ) : (
        TIERS.map(({ tier, label }) => {
          const items = open.filter((item) => item.tier === tier);
          if (items.length === 0) return null;
          return (
            <section key={tier} aria-label={label} className="mt-8">
              <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">{label}</h2>
              <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
                {items.map((item) => (
                  <FrictionRow key={item.id} item={item}>
                    <PaperButton variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "fixed" })}>
                      <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> Fixed
                    </PaperButton>
                    <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "ignored" })}>
                      <EyeOff className="size-3.5" strokeWidth={2} aria-hidden="true" /> Ignore
                    </PaperButton>
                  </FrictionRow>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {update.error ? (
        <p role="alert" className="mt-4 text-[13.5px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}

      {closed.length > 0 ? (
        <details className="mt-10">
          <summary className="cursor-pointer font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-sage uppercase">
            Fixed and ignored ({closed.length})
          </summary>
          <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
            {closed.map((item) => (
              <FrictionRow key={item.id} item={item}>
                <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "open" })}>
                  <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden="true" /> Reopen
                </PaperButton>
              </FrictionRow>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function FrictionRow({ item, children }: { item: RankedFrictionItem; children: ReactNode }) {
  const page = pageNameForRoute(item.route);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className={item.status === "open" ? "text-[15px] font-medium text-paper-moss" : "text-[15px] text-paper-sage line-through"}>{item.description}</p>
        <p className="mt-0.5 text-[12.5px] text-paper-sage">
          {capitalise(item.frequency)} · {capitalise(item.severity)}
          {page ? ` · ${page}` : ""} · {formatRelativeTime(item.createdAt)}
        </p>
      </div>
      <Tag tone={item.tier === "high" ? "flame" : item.tier === "medium" ? "marigold" : "muted"}>Priority {item.priority}</Tag>
      <div className="flex gap-1.5">{children}</div>
    </li>
  );
}
