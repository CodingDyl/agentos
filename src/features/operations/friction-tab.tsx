import { useState, type ReactNode } from "react";
import { Check, EyeOff, FlaskConical, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { pageNameForRoute, type FrictionTier, type RankedFrictionItem } from "@shared/friction-types";
import { PageLoader } from "@/components/os";
import { FieldLabel, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import { useFriction, useSetRegression, useStartRegressionJob, useUpdateFriction } from "@/lib/agentos/friction";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

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

/** Corrections still owed a test come first, in their own group; then the usual tiers. */
function GROUPS(open: RankedFrictionItem[]): Array<{ key: string; label: string; items: RankedFrictionItem[] }> {
  const owed = (item: RankedFrictionItem) => item.kind === "correction" && (item.regression?.status === "needed" || item.regression?.status === "in-progress");
  return [
    { key: "owed", label: "Corrections that need a test", items: open.filter(owed) },
    ...TIERS.map(({ tier, label }) => ({ key: tier, label, items: open.filter((item) => !owed(item) && item.tier === tier) })),
  ];
}

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function FrictionTab() {
  const friction = useFriction();
  const update = useUpdateFriction();

  if (friction.isPending) return <PageLoader variant="compact" />;
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
        GROUPS(open).map(({ key, label, items }) => {
          if (items.length === 0) return null;
          return (
            <section key={key} aria-label={label} className="mt-8">
              <h2 className="text-[13px] font-semibold text-paper-char">{label}</h2>
              <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
                {items.map((item) => (
                  <FrictionRow key={item.id} item={item} below={item.kind === "correction" ? <RegressionPanel item={item} /> : undefined}>
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
        <p role="alert" className="mt-4 text-[14px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}

      {closed.length > 0 ? (
        <details className="mt-10">
          <summary className="cursor-pointer text-[13px] font-semibold text-paper-sage">
            Fixed and ignored ({closed.length})
          </summary>
          <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
            {closed.map((item) => (
              <FrictionRow key={item.id} item={item} below={item.kind === "correction" ? <RegressionPanel item={item} readOnly /> : undefined}>
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

function FrictionRow({ item, children, below }: { item: RankedFrictionItem; children: ReactNode; below?: ReactNode }) {
  const page = pageNameForRoute(item.route);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className={item.status === "open" ? "text-[14px] font-medium text-paper-moss" : "text-[14px] text-paper-sage line-through"}>{item.description}</p>
          {item.expected ? <p className="mt-0.5 text-[13px] text-paper-char">Should have: {item.expected}</p> : null}
          <p className="mt-0.5 text-[13px] text-paper-sage">
            {item.kind === "correction" ? "Correction · " : ""}
            {capitalise(item.frequency)} · {capitalise(item.severity)}
            {page ? ` · ${page}` : ""} · {formatRelativeTime(item.createdAt)}
          </p>
        </div>
        <Tag tone={item.tier === "high" ? "flame" : item.tier === "medium" ? "marigold" : "muted"}>Priority {item.priority}</Tag>
        <div className="flex gap-1.5">{children}</div>
      </div>
      {below}
    </li>
  );
}

const REGRESSION_LABEL = {
  needed: "Needs a test",
  "in-progress": "A job is writing the test",
  covered: "Covered by a test",
  "not-testable": "Can't be tested",
} as const;

/**
 * Where a correction's regression test stands, and the three ways to move it:
 * ask a worker to write the test, say a test covers it, or say it can't be
 * tested and why. None of them runs on its own.
 */
function RegressionPanel({ item, readOnly = false }: { item: RankedFrictionItem; readOnly?: boolean }) {
  const regression = item.regression ?? { status: "needed" as const };
  const setRegression = useSetRegression();
  const startJob = useStartRegressionJob();
  const [mode, setMode] = useState<"covered" | "not-testable" | null>(null);
  const [text, setText] = useState("");
  const busy = setRegression.isPending || startJob.isPending;
  const error = setRegression.error ?? startJob.error;

  const save = () => {
    if (mode === null || !text.trim()) return;
    setRegression.mutate(
      mode === "covered" ? { id: item.id, status: "covered", testPath: text.trim() } : { id: item.id, status: "not-testable", reason: text.trim() },
      { onSuccess: () => { setMode(null); setText(""); } },
    );
  };

  return (
    <div className="mt-2 border-l-2 border-paper-mist pl-3" role="group" aria-label="Regression test">
      <p className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-paper-char">
        <FlaskConical className="size-3.5 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
        <span className="font-medium text-paper-moss">{REGRESSION_LABEL[regression.status]}</span>
        {regression.testPath ? <code className="font-mono text-[12px] text-paper-sage">{regression.testPath}</code> : null}
        {regression.reason ? <span className="text-paper-sage">{regression.reason}</span> : null}
        {regression.status === "in-progress" && regression.jobId ? (
          <Link to={`/workers/jobs/${regression.jobId}`} className="underline decoration-paper-gold underline-offset-4">
            See the job
          </Link>
        ) : null}
      </p>

      {!readOnly && regression.status === "needed" && mode === null ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <PaperButton variant="ghost" disabled={busy} onClick={() => startJob.mutate(item.id)}>
            {startJob.isPending ? "Starting…" : "Write the test"}
          </PaperButton>
          <PaperButton variant="quiet" disabled={busy} onClick={() => setMode("covered")}>
            Mark covered
          </PaperButton>
          <PaperButton variant="quiet" disabled={busy} onClick={() => setMode("not-testable")}>
            Can't be tested
          </PaperButton>
        </div>
      ) : null}

      {!readOnly && mode !== null ? (
        <form
          className="mt-2 flex max-w-[560px] flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="min-w-0 flex-1">
            <FieldLabel>{mode === "covered" ? "Path of the test, inside the repository" : "Why it can't be tested"}</FieldLabel>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={mode === "covered" ? 300 : 500}
              placeholder={mode === "covered" ? "server/friction/__tests__/corrections.test.ts" : "A wording change with nothing to assert"}
              className={cn(PAPER_INPUT, "w-full")}
            />
          </label>
          <PaperButton type="submit" variant="ghost" disabled={busy || !text.trim()}>
            {setRegression.isPending ? "Saving…" : "Save"}
          </PaperButton>
          <PaperButton variant="quiet" disabled={busy} onClick={() => { setMode(null); setText(""); }}>
            Cancel
          </PaperButton>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
