import { Plus, Sparkles, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ConversationSchema,
  MAX_PIVOTS,
  ValidationSchema,
  VALIDITY_THRESHOLD,
  type Persona,
  type PersonaReview,
  type ScoreAttempt,
  type Validation,
  type VentureDetail,
} from "@shared/startup-types";
import { FieldLabel, Meter, PAPER_INPUT, PaperButton, PaperCard, PaperNotice, Tag } from "@/components/paper";
import {
  useDraftPersona,
  usePersonas,
  usePivotVenture,
  useRunReview,
  useSavePersona,
  useSaveStage,
  useScoreVenture,
  useStopVenture,
  useSuggestPersonas,
} from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";
import { PersonaEditor } from "./persona-editor";
import { StageInterview } from "./stage-form";

const WAIT = "(usually under a minute, sometimes a few)";

/**
 * Validate: the competitor scan, persona reviews, optional real
 * conversations, and the validity score that decides whether this goes on.
 */
export function ValidatePanel({ detail }: { detail: VentureDetail }) {
  if (detail.locks.validate) return <PaperNotice>{detail.locks.validate}</PaperNotice>;

  const validation = ValidationSchema.parse(detail.stages.validate ?? {});

  return (
    <div className="space-y-6">
      <Competitors detail={detail} validation={validation} />
      <Personas detail={detail} validation={validation} />
      <Conversations detail={detail} validation={validation} />
      <Score detail={detail} />
    </div>
  );
}

function Heading({ step, title, children }: { step: number; title: string; children?: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[12.5px] font-semibold tracking-[0.06em] text-paper-sage uppercase tabular-nums">Step {step}</p>
      <h3 className="font-paper-display text-[18px] font-bold text-paper-moss">{title}</h3>
      {children ? <p className="mt-1 max-w-[66ch] text-[13.5px] leading-6 text-paper-char">{children}</p> : null}
    </div>
  );
}

function useSaveValidation(detail: VentureDetail) {
  const save = useSaveStage(detail.venture.slug, "validate");
  return {
    ...save,
    put: (next: Validation, onSuccess?: () => void) => save.mutate({ content: next, expectedRevision: detail.revisions.validate }, { onSuccess }),
  };
}

function Competitors({ detail, validation }: { detail: VentureDetail; validation: Validation }) {
  const save = useSaveValidation(detail);
  const [asking, setAsking] = useState(false);
  const has = validation.competitors.length > 0 || validation.competitorSummary;

  return (
    <section aria-label="Competitor scan">
      <Heading step={1} title="Competitor scan">
        Who already solves this, what they charge, and where the gap is.
      </Heading>
      {!has || asking ? (
        <StageInterview
          slug={detail.venture.slug}
          stage="validate"
          intro="Hermes scans for alternatives, South Africa first, and says where this idea could fit. Check anything it names before you rely on it."
          onDraft={(draft) => save.put({ ...validation, competitors: draft.competitors, competitorSummary: draft.competitorSummary }, () => setAsking(false))}
          onCancel={has ? () => setAsking(false) : undefined}
        />
      ) : (
        <PaperCard className="p-6">
          {validation.competitorSummary ? <p className="max-w-[70ch] text-[14px] leading-6 text-paper-char">{validation.competitorSummary}</p> : null}
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {validation.competitors.map((competitor) => (
              <li key={competitor.name} className="border border-paper-mist bg-paper-linen p-3">
                <p className="font-medium text-paper-moss">{competitor.name}</p>
                {competitor.notes ? <p className="mt-1 text-[13px] leading-5 text-paper-char">{competitor.notes}</p> : null}
                {competitor.gap ? <p className="mt-1 text-[13px] leading-5 text-paper-sage">Gap: {competitor.gap}</p> : null}
              </li>
            ))}
          </ul>
          <PaperButton className="mt-4" onClick={() => setAsking(true)}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            Scan again
          </PaperButton>
        </PaperCard>
      )}
      {save.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{save.error.message}</p> : null}
    </section>
  );
}

function Personas({ detail, validation }: { detail: VentureDetail; validation: Validation }) {
  const library = usePersonas();
  const suggest = useSuggestPersonas(detail.venture.slug);
  const draft = useDraftPersona();
  const savePersona = useSavePersona();
  const save = useSaveValidation(detail);
  const review = useRunReview(detail.venture.slug);
  const [editing, setEditing] = useState<Persona>();
  const [role, setRole] = useState("");

  const personas = library.data ?? [];
  const chosen = validation.personas.map((slug) => personas.find((persona) => persona.slug === slug)).filter((persona): persona is Persona => Boolean(persona));
  const reviews = new Map(detail.reviews.map((entry) => [entry.persona, entry]));
  const add = (slug: string) => {
    if (!validation.personas.includes(slug)) save.put({ ...validation, personas: [...validation.personas, slug] });
  };
  const unused = personas.filter((persona) => !validation.personas.includes(persona.slug));

  return (
    <section aria-label="Personas">
      <Heading step={2} title="Persona reviews">
        Field experts, played by a model, walk through their working week with this idea and say honestly whether they would use it and pay for it. Simulated, so treat them as a strong first filter, not as customers.
      </Heading>

      <PaperCard className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <PaperButton variant="ghost" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            {suggest.isPending ? `Hermes is choosing roles… ${WAIT}` : "Suggest who should vet it"}
          </PaperButton>
          {unused.length > 0 ? (
            <label className="inline-flex items-center gap-2">
              <span className="text-[13px] text-paper-sage">or add from the library</span>
              <select
                value=""
                onChange={(event) => event.target.value && add(event.target.value)}
                className={cn(PAPER_INPUT, "pr-8")}
              >
                <option value="">Choose…</option>
                {unused.map((persona) => (
                  <option key={persona.slug} value={persona.slug}>
                    {persona.name} · {persona.role}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {suggest.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{suggest.error.message}</p> : null}

        {suggest.data ? (
          <ul className="mt-4 grid gap-2">
            {suggest.data.map((suggestion) => {
              const existing = suggestion.existing ? personas.find((persona) => persona.slug === suggestion.existing) : undefined;
              const added = existing && validation.personas.includes(existing.slug);
              return (
                <li key={`${suggestion.role}-${suggestion.industry}`} className="flex flex-wrap items-center justify-between gap-3 bg-paper-linen px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-paper-moss">
                      {suggestion.role}
                      {suggestion.industry ? <span className="text-paper-sage"> · {suggestion.industry}</span> : null}
                    </p>
                    <p className="text-[13px] leading-5 text-paper-char">{suggestion.why}</p>
                  </div>
                  {added ? (
                    <Tag tone="green">Added</Tag>
                  ) : existing ? (
                    <PaperButton onClick={() => add(existing.slug)}>Use {existing.name}</PaperButton>
                  ) : (
                    <PaperButton disabled={draft.isPending} onClick={() => draft.mutate({ role: suggestion.role, industry: suggestion.industry, notes: suggestion.why }, { onSuccess: setEditing })}>
                      {draft.isPending && draft.variables?.role === suggestion.role ? "Writing…" : "Write this persona"}
                    </PaperButton>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (role.trim()) draft.mutate({ role: role.trim() }, { onSuccess: (persona) => { setEditing(persona); setRole(""); } });
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">A role to write a persona for</span>
            <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Or name a role, e.g. Practice manager at a dental clinic" className={cn(PAPER_INPUT, "w-full")} />
          </label>
          <PaperButton type="submit" disabled={draft.isPending || !role.trim()}>
            <Plus className="size-3.5" aria-hidden="true" />
            {draft.isPending ? `Writing… ${WAIT}` : "Write persona"}
          </PaperButton>
        </form>
        {draft.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{draft.error.message}</p> : null}
      </PaperCard>

      {editing ? (
        <div className="mt-4">
          <PersonaEditor
            persona={editing}
            saving={savePersona.isPending}
            error={savePersona.error?.message}
            notice="Hermes wrote this persona. Make it true to the people you know in this role, then save it to the library."
            onCancel={() => setEditing(undefined)}
            onSave={(persona) =>
              savePersona.mutate(persona, {
                onSuccess: (saved) => {
                  setEditing(undefined);
                  add(saved.slug);
                },
              })
            }
          />
        </div>
      ) : null}

      {chosen.length > 0 ? (
        <ul className="mt-4 grid gap-4 lg:grid-cols-2">
          {chosen.map((persona) => (
            <li key={persona.slug}>
              <ReviewCard
                persona={persona}
                review={reviews.get(persona.slug)}
                running={review.isPending && review.variables === persona.slug}
                disabled={review.isPending}
                onRun={() => review.mutate(persona.slug)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {review.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{review.error.message}</p> : null}
      {save.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{save.error.message}</p> : null}
    </section>
  );
}

function ReviewCard({ persona, review, running, disabled, onRun }: { persona: Persona; review?: PersonaReview; running: boolean; disabled: boolean; onRun: () => void }) {
  return (
    <PaperCard className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-paper-sage" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-paper-moss">{persona.name}</p>
            <p className="text-[13px] text-paper-sage">
              {persona.role}
              {persona.industry ? ` · ${persona.industry}` : ""}
            </p>
          </div>
        </div>
        {review ? (
          <span className="font-paper-display text-[22px] font-extrabold text-paper-moss tabular-nums" aria-label={`Fit ${review.fitScore} out of 10`}>
            {review.fitScore}
            <span className="text-[13px] font-medium text-paper-sage">/10</span>
          </span>
        ) : null}
      </div>

      {review ? (
        <div className="mt-3 space-y-2 text-[13.5px] leading-6 text-paper-char">
          <div className="flex flex-wrap gap-2">
            <Tag tone="blue">Simulated</Tag>
            <Tag tone={review.wouldPay === "yes" ? "green" : review.wouldPay === "no" ? "flame" : "marigold"}>Would pay: {review.wouldPay}{review.price ? ` · ${review.price}` : ""}</Tag>
          </div>
          <p className="italic">“{review.verdict}”</p>
          <ReviewList label="Deal-breakers" tone="text-paper-flame-deep" items={review.dealBreakers} />
          <ReviewList label="Missing" tone="text-paper-moss" items={review.missing} />
        </div>
      ) : (
        <p className="mt-3 text-[13.5px] text-paper-sage">Not reviewed yet.</p>
      )}

      <PaperButton className="mt-4" variant={review ? "quiet" : "ghost"} disabled={disabled} onClick={onRun}>
        {running ? `${persona.name} is reading it… ${WAIT}` : review ? "Review again" : "Ask for a review"}
      </PaperButton>
    </PaperCard>
  );
}

function ReviewList({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={cn("font-medium", tone)}>{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Conversations({ detail, validation }: { detail: VentureDetail; validation: Validation }) {
  const save = useSaveValidation(detail);
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState({ who: "", role: "", pain: 3, wouldPay: "maybe" as "yes" | "maybe" | "no", quotes: "", notes: "" });

  const submit = () => {
    const conversation = ConversationSchema.parse({ ...entry, date: new Date().toISOString().slice(0, 10), quotes: entry.quotes.split("\n").map((line) => line.trim()).filter(Boolean) });
    save.put({ ...validation, conversations: [...validation.conversations, conversation] }, () => {
      setOpen(false);
      setEntry({ who: "", role: "", pain: 3, wouldPay: "maybe", quotes: "", notes: "" });
    });
  };

  return (
    <section aria-label="Real conversations">
      <Heading step={3} title="Real conversations (optional)">
        If you have spoken to real people with this problem, log them here. They count towards the score as real-world evidence; without any, the personas carry it.
      </Heading>
      <PaperCard className="p-6">
        {validation.conversations.length > 0 ? (
          <ul className="mb-4 grid gap-2">
            {validation.conversations.map((conversation, index) => (
              <li key={`${conversation.who}-${index}`} className="bg-paper-linen px-4 py-3 text-[13.5px] leading-6 text-paper-char">
                <span className="font-medium text-paper-moss">{conversation.who || "Someone"}</span>
                {conversation.role ? `, ${conversation.role}` : ""} · pain {conversation.pain}/5 · would pay: {conversation.wouldPay}
                {conversation.quotes[0] ? <span className="block italic">“{conversation.quotes[0]}”</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {open ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <FieldLabel>Who</FieldLabel>
              <input value={entry.who} onChange={(event) => setEntry({ ...entry, who: event.target.value })} className={cn(PAPER_INPUT, "w-full")} />
            </label>
            <label>
              <FieldLabel>Their role</FieldLabel>
              <input value={entry.role} onChange={(event) => setEntry({ ...entry, role: event.target.value })} className={cn(PAPER_INPUT, "w-full")} />
            </label>
            <label>
              <FieldLabel>How much it hurts (1–5)</FieldLabel>
              <input type="number" min={1} max={5} value={entry.pain} onChange={(event) => setEntry({ ...entry, pain: Math.min(5, Math.max(1, Number(event.target.value) || 3)) })} className={cn(PAPER_INPUT, "w-24 tabular-nums")} />
            </label>
            <label>
              <FieldLabel>Would they pay?</FieldLabel>
              <select value={entry.wouldPay} onChange={(event) => setEntry({ ...entry, wouldPay: event.target.value as "yes" | "maybe" | "no" })} className={cn(PAPER_INPUT, "w-32")}>
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <FieldLabel>What they said (one quote per line)</FieldLabel>
              <textarea rows={3} value={entry.quotes} onChange={(event) => setEntry({ ...entry, quotes: event.target.value })} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} />
            </label>
            <label className="sm:col-span-2">
              <FieldLabel>Notes</FieldLabel>
              <textarea rows={2} value={entry.notes} onChange={(event) => setEntry({ ...entry, notes: event.target.value })} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <PaperButton variant="amber" disabled={save.isPending || !entry.who.trim()} onClick={submit}>
                {save.isPending ? "Saving…" : "Save conversation"}
              </PaperButton>
              <PaperButton onClick={() => setOpen(false)}>Cancel</PaperButton>
            </div>
          </div>
        ) : (
          <PaperButton onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Log a conversation
          </PaperButton>
        )}
        {save.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{save.error.message}</p> : null}
      </PaperCard>
    </section>
  );
}

function Score({ detail }: { detail: VentureDetail }) {
  const slug = detail.venture.slug;
  const score = useScoreVenture(slug);
  const pivot = usePivotVenture(slug);
  const stop = useStopVenture(slug);
  const [direction, setDirection] = useState("");

  const latest: ScoreAttempt | undefined = detail.scores.at(-1);
  // A score from before the latest pivot describes an idea that no longer exists.
  const current = latest && latest.attempt === detail.venture.pivotsUsed + 1 ? latest : undefined;
  const stopped = detail.venture.status === "stopped";
  const canPivot = detail.venture.pivotsUsed < MAX_PIVOTS;
  // A failed score is only re-run on new evidence: otherwise "Score again" would be a way to re-roll past the bar.
  const newEvidence =
    !current ||
    detail.reviews.length > current.personaReviews ||
    detail.reviews.some((review) => review.reviewedAt > current.at) ||
    (detail.stages.validate?.conversations.length ?? 0) > current.conversations;

  return (
    <section aria-label="Validity score">
      <Heading step={4} title="Validity score">
        All the evidence, scored on fixed dimensions. {VALIDITY_THRESHOLD}/10 or more and the MVP stage opens. Below it, one pivot; a second miss stops the venture, and the lesson is kept for the next one.
      </Heading>
      <PaperCard className="p-6">
        {current ? (
          <div>
            <div className="flex flex-wrap items-end gap-4">
              <p className="font-paper-display text-[44px] leading-none font-extrabold text-paper-moss tabular-nums">
                {current.total}
                <span className="text-[18px] font-bold text-paper-sage">/10</span>
              </p>
              <Tag tone={current.passed ? "green" : "flame"}>{current.passed ? "Passed" : `Below ${VALIDITY_THRESHOLD}`}</Tag>
              <span className="text-[13px] text-paper-sage">
                Attempt {current.attempt} · {current.personaReviews} persona review{current.personaReviews === 1 ? "" : "s"} · {current.conversations} real conversation{current.conversations === 1 ? "" : "s"}
              </span>
            </div>
            {current.summary ? <p className="mt-3 max-w-[70ch] text-[14px] leading-6 text-paper-char">{current.summary}</p> : null}
            <ul className="mt-5 grid gap-3">
              {current.dimensions.map((dimension) => (
                <li key={dimension.key} className="grid gap-1 sm:grid-cols-[14rem_1fr_3rem] sm:items-center sm:gap-4">
                  <span className="text-[13.5px] text-paper-char">
                    {dimension.label} <span className="text-paper-sage tabular-nums">({Math.round(dimension.weight * 100)}%)</span>
                  </span>
                  <div title={dimension.evidence.join("\n")}>
                    <Meter value={dimension.score / 10} label={`${dimension.label}: ${dimension.score} out of 10`} tone={dimension.score >= 8 ? "green" : dimension.score >= 5 ? "amber" : "flame"} size="md" />
                  </div>
                  <span className="text-right text-[13.5px] font-medium text-paper-moss tabular-nums">{dimension.score}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[14px] leading-6 text-paper-char">{detail.reviews.length === 0 ? "Run at least one persona review, then score." : "Ready to score."}</p>
        )}

        {!stopped && (!current || !current.passed) && newEvidence ? (
          <PaperButton variant={current ? "ghost" : "amber"} className="mt-5" disabled={score.isPending || detail.reviews.length === 0} onClick={() => score.mutate()}>
            {score.isPending ? `Scoring… ${WAIT}` : current ? "Score again with the new evidence" : "Score the idea"}
          </PaperButton>
        ) : null}
        {score.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{score.error.message}</p> : null}

        {current && !current.passed && !stopped ? (
          <div className="mt-6 border-t border-paper-mist pt-5">
            {canPivot ? (
              <>
                <FieldLabel>Pivot once, aimed at the weakest scores</FieldLabel>
                <p className="max-w-[66ch] text-[13.5px] leading-6 text-paper-char">
                  Hermes revises the idea to fix what scored lowest. Then review value, run the personas again and re-score. If the pivot also scores below {VALIDITY_THRESHOLD}, the venture stops.
                </p>
                <textarea rows={2} value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="Optional: your direction for the pivot" className={cn(PAPER_INPUT, "mt-3 w-full py-2 leading-6")} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <PaperButton variant="amber" disabled={pivot.isPending} onClick={() => pivot.mutate(direction.trim() || undefined)}>
                    {pivot.isPending ? `Pivoting… ${WAIT}` : "Pivot"}
                  </PaperButton>
                  <PaperButton variant="danger" disabled={stop.isPending} onClick={() => stop.mutate(`Scored ${current.total}/10; chose not to pivot.`)}>
                    Stop here
                  </PaperButton>
                </div>
              </>
            ) : (
              <PaperButton variant="danger" disabled={stop.isPending} onClick={() => stop.mutate(`Scored ${current.total}/10 after a pivot.`)}>
                Stop and record the lesson
              </PaperButton>
            )}
            {pivot.error || stop.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{(pivot.error ?? stop.error)?.message}</p> : null}
          </div>
        ) : null}
      </PaperCard>
    </section>
  );
}
