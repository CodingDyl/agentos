import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Film, Plus, X } from "lucide-react";
import {
  BUDGET_PLANS,
  CREDIT_COST_TABLE,
  MOTION_WIZARD_STEP_LABEL,
  MOTION_WIZARD_STEPS,
  REFERENCE_LIBRARY_LINKS,
  REFERENCE_LIKE_LABEL,
  REFERENCE_LIKES,
  type MotionBrief,
  type MotionDraft,
  type MotionReference,
  type MotionWizardStep,
  type ReferenceLike,
  type YouDecideFields,
} from "@shared/motion-design-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperError, PaperSwitch } from "@/components/paper";
import {
  suggestedReferences,
  uploadMotionReference,
  useInstallMotionSkill,
  useLaunchMotionDesign,
  useMotionDraft,
  useMotionSetup,
  useSaveMotionDraft,
} from "@/lib/agentos/motion-design";
import { cn } from "@/lib/utils";

const INTAKE: MotionWizardStep[] = ["setup", "references", "brief", "launch"];

const emptyBrief: MotionBrief = {
  brandName: "",
  brandSells: "",
  brandAudience: "",
  vibe: "",
  journeyStart: "",
  journeyEnd: "",
  journeyBeats: "",
  sections: "",
  cta: "",
  extrasCharacter: false,
  extrasDeploy: "",
  youDecide: {},
};

function emptyDraft(): MotionDraft {
  return {
    step: "setup",
    brief: emptyBrief,
    references: [],
    budgetPlan: "standard",
    budgetCeiling: 330,
    codeOnly: false,
    model: "claude-opus-5-5",
    effort: "max",
    workspaceName: "",
  };
}

export function MotionDesignWizard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const setup = useMotionSetup();
  const stored = useMotionDraft();
  const save = useSaveMotionDraft();
  const install = useInstallMotionSkill();
  const launch = useLaunchMotionDesign();
  const [draft, setDraft] = useState<MotionDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [link, setLink] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [zipMessage, setZipMessage] = useState<string>();

  useEffect(() => {
    if (hydrated || stored.isPending) return;
    if (stored.data?.draft) setDraft(stored.data.draft);
    setHydrated(true);
  }, [hydrated, stored.data, stored.isPending]);

  const persist = save.mutate;
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => persist(draft), 600);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, persist]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const step = INTAKE.includes(draft.step) ? draft.step : "setup";
  const stepIndex = INTAKE.indexOf(step);
  const detected = setup.data?.setup;
  const codeOnly = Boolean(draft.codeOnly || detected?.codeOnly);
  const launchBlocked = detected ? !detected.ready : true;

  const go = (next: MotionWizardStep) => setDraft((current) => ({ ...current, step: next }));

  const start = async () => {
    try {
      const run = await launch.mutateAsync({
        brief: draft.brief,
        references: draft.references,
        budgetPlan: draft.budgetPlan,
        budgetCeiling: draft.budgetPlan === "custom" ? draft.budgetCeiling : BUDGET_PLANS.find((plan) => plan.id === draft.budgetPlan)?.credits,
        codeOnly,
        model: draft.model,
        effort: draft.effort,
        workspaceName: draft.workspaceName.trim() || draft.brief.brandName.trim() || undefined,
      });
      onClose();
      navigate(`/workspaces/${encodeURIComponent(run.workspaceSlug)}?tab=motion`);
    } catch {
      // Shown from launch.error below.
    }
  };

  const addLink = () => {
    const url = link.trim();
    if (!url || draft.references.length >= 10) return;
    setDraft((current) => ({
      ...current,
      references: [...current.references, { id: `ref_${crypto.randomUUID().slice(0, 8)}`, kind: "link", url, likes: [], note: "" }],
    }));
    setLink("");
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploadError(undefined);
    try {
      for (const file of [...files].slice(0, 10 - draft.references.length)) {
        const reference = await uploadMotionReference(file);
        setDraft((current) => ({ ...current, references: [...current.references, reference].slice(0, 10) }));
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The image could not be stored.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-paper-moss/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="motion-design-title">
      <div className="mb-8 w-full max-w-3xl border border-paper-mist bg-paper-white p-6 shadow-[0_24px_60px_rgba(20,24,20,0.18)] sm:p-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-paper-utility text-[12px] tracking-[0.08em] text-paper-sage uppercase">Workspaces</p>
            <h2 id="motion-design-title" className="mt-1 flex items-center gap-2 font-paper-display text-[28px] font-extrabold tracking-[-0.02em] text-paper-moss">
              <Film className="size-6" strokeWidth={1.75} aria-hidden="true" />
              Motion Design
            </h2>
            <p className="mt-1 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
              Builds a cinematic site in a new workspace with your local Claude Code worker and the motion-site-studio skill.
            </p>
          </div>
          <PaperButton variant="ghost" onClick={onClose} aria-label="Close Motion Design">
            <X className="size-4" strokeWidth={1.75} />
          </PaperButton>
        </header>

        <ol className="mt-6 grid grid-cols-4 gap-px border border-paper-mist bg-paper-mist" aria-label="Wizard steps">
          {INTAKE.map((id, index) => (
            <li key={id} className={cn("bg-paper-white px-3 py-2 font-paper-utility text-[11px] tracking-[0.08em] uppercase", index === stepIndex ? "text-paper-blue" : "text-paper-sage")}>
              {index + 1}. {MOTION_WIZARD_STEP_LABEL[id]}
            </li>
          ))}
        </ol>

        <div className="mt-6">
          {step === "setup" ? (
            <SetupStep
              loading={setup.isPending}
              error={setup.error?.message}
              onRetry={() => void setup.refetch()}
              retrying={setup.isFetching}
              setup={detected}
              higgsfield={setup.data?.higgsfield}
              confirmOverwrite={confirmOverwrite}
              onConfirmOverwrite={setConfirmOverwrite}
              installMessage={install.data?.message}
              installError={install.error instanceof Error ? install.error.message : undefined}
              installing={install.isPending}
              onInstall={() => install.mutate(confirmOverwrite)}
              onZip={async (file) => {
                const response = await fetch(`/api/motion-design/skill/zip${confirmOverwrite ? "?confirm=1" : ""}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/zip" },
                  body: file,
                });
                const payload: unknown = await response.json().catch(() => undefined);
                const message =
                  payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
                    ? payload.message
                    : response.ok
                      ? "Imported."
                      : "The zip could not be imported.";
                setConfirmOverwrite(false);
                setZipMessage(message);
                void setup.refetch();
              }}
              zipMessage={zipMessage}
              needsConfirm={install.data?.needsConfirm}
              codeOnly={codeOnly}
              onCodeOnly={(value) => setDraft((current) => ({ ...current, codeOnly: value }))}
            />
          ) : null}

          {step === "references" ? (
            <ReferencesStep
              draft={draft}
              link={link}
              onLink={setLink}
              onAddLink={addLink}
              onFiles={(list) => void addFiles(list)}
              uploadError={uploadError}
              onChange={(references) => setDraft((current) => ({ ...current, references }))}
              onSuggest={() => setDraft((current) => ({ ...current, references: suggestedReferences() }))}
            />
          ) : null}

          {step === "brief" ? (
            <BriefStep
              draft={draft}
              onBrief={(brief) => setDraft((current) => ({ ...current, brief, workspaceName: current.workspaceName || brief.brandName }))}
              onPlan={(budgetPlan, budgetCeiling) => setDraft((current) => ({ ...current, budgetPlan, budgetCeiling }))}
            />
          ) : null}

          {step === "launch" ? (
            <LaunchStep
              draft={draft}
              codeOnly={codeOnly}
              onChange={setDraft}
              error={launch.error instanceof Error ? launch.error.message : undefined}
            />
          ) : null}
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <PaperButton variant="ghost" onClick={() => (stepIndex === 0 ? onClose() : go(INTAKE[stepIndex - 1]!))}>
            {stepIndex === 0 ? "Cancel" : "Back"}
          </PaperButton>
          {step === "launch" ? (
            <PaperButton variant="amber" disabled={launchBlocked || launch.isPending} onClick={() => void start()}>
              {launch.isPending ? "Starting Claude Code…" : launchBlocked ? "Finish setup first" : "Launch build"}
            </PaperButton>
          ) : (
            <PaperButton
              variant="amber"
              disabled={step === "setup" && launchBlocked && !codeOnly && Boolean(detected && !detected.ready)}
              onClick={() => go(INTAKE[stepIndex + 1]!)}
            >
              Continue
            </PaperButton>
          )}
        </footer>
        {save.error instanceof Error ? (
          <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
            Draft could not be saved: {save.error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SetupStep({
  loading,
  error,
  onRetry,
  retrying,
  setup,
  higgsfield,
  confirmOverwrite,
  onConfirmOverwrite,
  installMessage,
  installError,
  installing,
  onInstall,
  onZip,
  zipMessage,
  needsConfirm,
  codeOnly,
  onCodeOnly,
}: {
  loading: boolean;
  error?: string;
  onRetry: () => void;
  retrying: boolean;
  setup?: import("@shared/motion-design-types").MotionSetup;
  higgsfield?: string;
  confirmOverwrite: boolean;
  onConfirmOverwrite: (value: boolean) => void;
  installMessage?: string;
  installError?: string;
  installing: boolean;
  onInstall: () => void;
  onZip: (file: File) => Promise<void>;
  zipMessage?: string;
  needsConfirm?: boolean;
  codeOnly: boolean;
  onCodeOnly: (value: boolean) => void;
}) {
  if (loading) return <p role="status">Checking this machine…</p>;
  if (error || !setup) {
    return <PaperError title="Setup could not be read." detail={error} onRetry={onRetry} isRetrying={retrying} headingLevel="h2" />;
  }

  return (
    <div className="grid gap-4">
      <ul className="divide-y divide-paper-stone border border-paper-mist">
        {setup.checks.map((check) => (
          <li key={check.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
            <div>
              <p className="font-medium text-paper-moss">
                {check.ok ? "Ready" : check.required ? "Missing" : "Optional"} · {check.label}
              </p>
              {check.detail ? <p className="mt-0.5 font-mono text-[12.5px] text-paper-sage">{check.detail}</p> : null}
              {!check.ok && check.fix ? <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-paper-char">{check.fix}</p> : null}
            </div>
            {check.id === "skill" && !check.ok ? (
              <div className="flex flex-col items-end gap-2">
                {needsConfirm ? (
                  <label className="flex items-center gap-2 text-[12.5px] text-paper-char">
                    <input type="checkbox" checked={confirmOverwrite} onChange={(event) => onConfirmOverwrite(event.target.checked)} />
                    Replace the installed copy
                  </label>
                ) : null}
                <PaperButton variant="amber" disabled={installing || (needsConfirm && !confirmOverwrite)} onClick={onInstall}>
                  {installing ? "Installing…" : "Install skill"}
                </PaperButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {higgsfield ? <p className="text-[13px] text-paper-sage">Higgsfield account: {higgsfield}</p> : null}
      {installMessage ? <p role="status" className="text-[13px] text-paper-char">{installMessage}</p> : null}
      {installError ? <p role="alert" className="text-[13px] text-paper-flame-deep">{installError}</p> : null}
      {zipMessage ? <p role="status" className="text-[13px] text-paper-char">{zipMessage}</p> : null}
      <label className="text-[12.5px] text-paper-sage">
        Secondary: import a skill zip
        <input
          type="file"
          accept=".zip,application/zip"
          className="mt-1 block"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onZip(file);
          }}
        />
      </label>
      {setup.codeOnly ? (
        <label className="flex items-start gap-3 border border-paper-marigold p-3 text-[13.5px] leading-5">
          <PaperSwitch checked={codeOnly} onChange={onCodeOnly} label="Code-only motion" />
          <span>
            Higgsfield is not signed in. Continue in <strong>code-only motion</strong> (the skill draws motion in code). This never runs{" "}
            <span className="font-mono text-[12.5px]">higgsfield auth login</span> for you — run that in your own terminal if you want generated film.
          </span>
        </label>
      ) : null}
    </div>
  );
}

function ReferencesStep({
  draft,
  link,
  onLink,
  onAddLink,
  onFiles,
  uploadError,
  onChange,
  onSuggest,
}: {
  draft: MotionDraft;
  link: string;
  onLink: (value: string) => void;
  onAddLink: () => void;
  onFiles: (files: FileList | null) => void;
  uploadError?: string;
  onChange: (references: MotionReference[]) => void;
  onSuggest: () => void;
}) {
  const update = (id: string, patch: Partial<MotionReference>) =>
    onChange(draft.references.map((reference) => (reference.id === id ? { ...reference, ...patch } : reference)));

  return (
    <div className="grid gap-4">
      <p className="text-[13.5px] leading-5 text-paper-char">Add 3–10 references as links or images. For each, say what you like: color, composition, typography, material, lighting, motion, or layout.</p>
      <div className="flex flex-wrap gap-3 text-[13px]">
        {REFERENCE_LIBRARY_LINKS.map((entry) => (
          <a key={entry.href} href={entry.href} target="_blank" rel="noopener noreferrer" className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
            {entry.label}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={link} onChange={(event) => onLink(event.target.value)} placeholder="https://…" aria-label="Reference link" className={cn(PAPER_INPUT, "min-w-[16rem] flex-1")} />
        <PaperButton onClick={onAddLink} disabled={draft.references.length >= 10}>
          <Plus className="size-3.5" />
          Add link
        </PaperButton>
        <label className={cn("inline-flex min-h-[var(--control-height)] cursor-pointer items-center border border-paper-mist px-3 text-[14px]", PAPER_FOCUS)}>
          Upload image
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => onFiles(event.target.files)} />
        </label>
        <PaperButton variant="ghost" onClick={onSuggest}>
          I have none, suggest three
        </PaperButton>
      </div>
      {uploadError ? <p role="alert" className="text-[13px] text-paper-flame-deep">{uploadError}</p> : null}
      {draft.references.length === 0 ? <p className="text-[13.5px] text-paper-sage">No references yet.</p> : null}
      <ul className="grid gap-3">
        {draft.references.map((reference) => (
          <li key={reference.id} className="border border-paper-mist p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate font-mono text-[12.5px] text-paper-moss">{reference.url ?? reference.filename ?? reference.path}</p>
              <button type="button" className={cn("text-paper-sage hover:text-paper-moss", PAPER_FOCUS)} aria-label="Remove reference" onClick={() => onChange(draft.references.filter((entry) => entry.id !== reference.id))}>
                <X className="size-3.5" />
              </button>
            </div>
            <fieldset className="mt-2 flex flex-wrap gap-1.5">
              <legend className="sr-only">What do you like</legend>
              {REFERENCE_LIKES.map((like) => {
                const on = reference.likes.includes(like);
                return (
                  <button
                    key={like}
                    type="button"
                    aria-pressed={on}
                    onClick={() => update(reference.id, { likes: on ? reference.likes.filter((item) => item !== like) : [...reference.likes, like] })}
                    className={cn("border px-2 py-0.5 font-paper-utility text-[11px] tracking-[0.06em] uppercase", PAPER_FOCUS, on ? "border-paper-moss bg-paper-moss text-paper-white" : "border-paper-mist text-paper-char")}
                  >
                    {REFERENCE_LIKE_LABEL[like as ReferenceLike]}
                  </button>
                );
              })}
            </fieldset>
            <input
              value={reference.note}
              onChange={(event) => update(reference.id, { note: event.target.value })}
              placeholder="Why I picked this"
              aria-label="Why I picked this"
              className={cn(PAPER_INPUT, "mt-2 w-full")}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BriefStep({
  draft,
  onBrief,
  onPlan,
}: {
  draft: MotionDraft;
  onBrief: (brief: MotionBrief) => void;
  onPlan: (plan: MotionDraft["budgetPlan"], ceiling?: number) => void;
}) {
  const brief = draft.brief;
  const set = (patch: Partial<MotionBrief>) => onBrief({ ...brief, ...patch });
  const toggle = (field: keyof YouDecideFields, checked: boolean) =>
    set({ youDecide: { ...brief.youDecide, [field]: checked } });

  return (
    <div className="grid gap-5">
      <Field youDecide={Boolean(brief.youDecide.brand)} onYouDecide={(value) => toggle("brand", value)} label="Brand">
        <input className={cn(PAPER_INPUT, "w-full")} value={brief.brandName} onChange={(event) => set({ brandName: event.target.value })} placeholder="Name" aria-label="Brand name" disabled={brief.youDecide.brand} />
        <input className={cn(PAPER_INPUT, "mt-2 w-full")} value={brief.brandSells} onChange={(event) => set({ brandSells: event.target.value })} placeholder="What it sells" aria-label="What it sells" disabled={brief.youDecide.brand} />
        <input className={cn(PAPER_INPUT, "mt-2 w-full")} value={brief.brandAudience} onChange={(event) => set({ brandAudience: event.target.value })} placeholder="Who it's for" aria-label="Who it's for" disabled={brief.youDecide.brand} />
      </Field>
      <Field youDecide={Boolean(brief.youDecide.vibe)} onYouDecide={(value) => toggle("vibe", value)} label="Vibe">
        <input className={cn(PAPER_INPUT, "w-full")} value={brief.vibe} onChange={(event) => set({ vibe: event.target.value })} placeholder="One line" disabled={brief.youDecide.vibe} />
      </Field>
      <Field youDecide={Boolean(brief.youDecide.journey)} onYouDecide={(value) => toggle("journey", value)} label="Journey" highlight>
        <p className="mb-2 text-[12.5px] text-paper-char">The most important answer: start frame, end frame, and intermediate states.</p>
        <input className={cn(PAPER_INPUT, "w-full")} value={brief.journeyStart} onChange={(event) => set({ journeyStart: event.target.value })} placeholder="Start frame" aria-label="Start frame" disabled={brief.youDecide.journey} />
        <input className={cn(PAPER_INPUT, "mt-2 w-full")} value={brief.journeyEnd} onChange={(event) => set({ journeyEnd: event.target.value })} placeholder="End frame" aria-label="End frame" disabled={brief.youDecide.journey} />
        <textarea className={cn(PAPER_INPUT, "mt-2 w-full py-2")} rows={3} value={brief.journeyBeats} onChange={(event) => set({ journeyBeats: event.target.value })} placeholder="Intermediate states" aria-label="Intermediate states" disabled={brief.youDecide.journey} />
      </Field>
      <Field youDecide={Boolean(brief.youDecide.sections)} onYouDecide={(value) => toggle("sections", value)} label="Sections below the film">
        <textarea className={cn(PAPER_INPUT, "w-full py-2")} rows={3} value={brief.sections} onChange={(event) => set({ sections: event.target.value })} placeholder="What each section must prove" disabled={brief.youDecide.sections} />
      </Field>
      <Field youDecide={Boolean(brief.youDecide.cta)} onYouDecide={(value) => toggle("cta", value)} label="Primary CTA">
        <input className={cn(PAPER_INPUT, "w-full")} value={brief.cta} onChange={(event) => set({ cta: event.target.value })} placeholder="The one button" disabled={brief.youDecide.cta} />
      </Field>
      <div className="border border-paper-mist p-3">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Higgsfield credit budget</FieldLabel>
          <label className="flex items-center gap-2 text-[12.5px] text-paper-char">
            You decide
            <PaperSwitch checked={Boolean(brief.youDecide.budget)} onChange={(value) => toggle("budget", value)} label="You decide budget" />
          </label>
        </div>
        <p className="mb-2 text-[12.5px] text-paper-char">You decide never authorizes spend. A concept and ceiling still need an explicit Approve after the skill proposes two ideas.</p>
        <div className="flex flex-wrap gap-2">
          {BUDGET_PLANS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => onPlan(plan.id, plan.credits ?? draft.budgetCeiling)}
              className={cn("border px-3 py-1.5 text-left text-[13px]", PAPER_FOCUS, draft.budgetPlan === plan.id ? "border-paper-blue text-paper-blue" : "border-paper-mist")}
            >
              <span className="block font-medium">{plan.label}{plan.credits ? ` · ~${plan.credits}` : ""}</span>
              <span className="block text-[12px] text-paper-sage">{plan.detail}</span>
            </button>
          ))}
        </div>
        {draft.budgetPlan === "custom" ? (
          <input
            type="number"
            min={1}
            className={cn(PAPER_INPUT, "mt-2 w-40")}
            value={draft.budgetCeiling ?? ""}
            onChange={(event) => onPlan("custom", Number(event.target.value))}
            aria-label="Custom credit ceiling"
          />
        ) : null}
        <table className="mt-3 w-full text-left text-[12.5px] text-paper-char">
          <caption className="mb-1 text-left text-[12px] text-paper-sage">Source-listed costs (October 2026). Plans keep about 15% spare.</caption>
          <tbody>
            {CREDIT_COST_TABLE.map((row) => (
              <tr key={row.output} className="border-t border-paper-stone">
                <td className="py-1 pr-3">{row.output}</td>
                <td className="py-1 pr-3">{row.model}</td>
                <td className="py-1 tabular-nums">{row.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field youDecide={Boolean(brief.youDecide.extras)} onYouDecide={(value) => toggle("extras", value)} label="Extras">
        <label className="flex items-center gap-2 text-[13.5px]">
          <input type="checkbox" checked={brief.extrasCharacter} onChange={(event) => set({ extrasCharacter: event.target.checked })} disabled={brief.youDecide.extras} />
          A small character
        </label>
        <input className={cn(PAPER_INPUT, "mt-2 w-full")} value={brief.extrasDeploy} onChange={(event) => set({ extrasDeploy: event.target.value })} placeholder="Deploy target, e.g. Vercel" aria-label="Deploy target" disabled={brief.youDecide.extras} />
      </Field>
    </div>
  );
}

function Field({
  label,
  highlight,
  youDecide,
  onYouDecide,
  children,
}: {
  label: string;
  highlight?: boolean;
  youDecide: boolean;
  onYouDecide: (value: boolean) => void;
  children: import("react").ReactNode;
}) {
  return (
    <div className={cn("border p-3", highlight ? "border-paper-blue" : "border-paper-mist")}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <FieldLabel>{label}{highlight ? " · most important" : ""}</FieldLabel>
        <label className="flex items-center gap-2 text-[12.5px] text-paper-char">
          You decide
          <PaperSwitch checked={youDecide} onChange={onYouDecide} label={`You decide ${label}`} />
        </label>
      </div>
      {children}
    </div>
  );
}

function LaunchStep({
  draft,
  codeOnly,
  onChange,
  error,
}: {
  draft: MotionDraft;
  codeOnly: boolean;
  onChange: (draft: MotionDraft) => void;
  error?: string;
}) {
  const ceiling = draft.budgetPlan === "custom" ? draft.budgetCeiling : BUDGET_PLANS.find((plan) => plan.id === draft.budgetPlan)?.credits;
  return (
    <form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <p className="text-[13.5px] leading-5 text-paper-char">
        Creates a workspace, writes the brief into its site folder, and starts a Claude Code worker job with{" "}
        <span className="font-mono text-[12.5px]">/motion-site-studio</span>. The skill will stop with two concepts before any Higgsfield spend.
      </p>
      <label>
        <FieldLabel>Workspace name</FieldLabel>
        <input className={cn(PAPER_INPUT, "w-full")} value={draft.workspaceName} onChange={(event) => onChange({ ...draft, workspaceName: event.target.value })} placeholder={draft.brief.brandName || "Motion site"} />
      </label>
      <label>
        <FieldLabel>Claude Code model</FieldLabel>
        <input className={cn(PAPER_INPUT, "w-full")} value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} />
      </label>
      <fieldset>
        <FieldLabel>Effort</FieldLabel>
        <div className="flex gap-2">
          {(["high", "xhigh", "max"] as const).map((effort) => (
            <button
              key={effort}
              type="button"
              onClick={() => onChange({ ...draft, effort })}
              className={cn("border px-3 py-1.5 font-mono text-[13px]", PAPER_FOCUS, draft.effort === effort ? "border-paper-blue text-paper-blue" : "border-paper-mist")}
            >
              {effort}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-[13px] text-paper-sage">
        {codeOnly ? "Code-only motion: no Higgsfield spend." : `Planning ceiling: ${ceiling ?? "unset"} credits. Approval still happens after the two concepts.`}
      </p>
      {error ? <PaperError title="The build could not start." detail={error} headingLevel="h2" /> : null}
    </form>
  );
}
