import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { settingsFor, type FeatureSettingDefinition } from "@shared/feature-settings-types";
import type { RebuildRun } from "@shared/website-rebuild-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useFeatureSettings, useSaveFeatureSettings } from "@/lib/agentos/rebuilds";
import { cn } from "@/lib/utils";

/**
 * What the run's features need to work for real, asked before the functions
 * stage builds them. Secrets are write-only: once saved, the page only knows
 * that one is set. Everything here goes to the Vercel preview, never production.
 */
export function FeatureSettingsPanel({ run }: { run: RebuildRun }) {
  const id = useId();
  const current = useFeatureSettings(run.id);
  const save = useSaveFeatureSettings(run.id);
  const fields = settingsFor(run.requiredFunctions);
  const wantsUrls = run.requiredFunctions.includes("blog");
  const [clearing, setClearing] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  if (fields.length === 0 && !wantsUrls) return null;
  if (current.isPending) return null;
  const view = current.data ?? { values: {}, secretsSet: {}, legacyUrls: [] };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const values: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of fields) {
      if (field.secret) {
        // Left empty keeps the saved secret; "Remove" clears it.
        if (clearing[field.key]) secrets[field.key] = "";
        else if (text(field.key)) secrets[field.key] = text(field.key);
      } else values[field.key] = text(field.key);
    }
    const legacyUrls = wantsUrls ? text("legacyUrls").split(/\s+/).filter(Boolean) : view.legacyUrls;
    setSaved(false);
    save.mutate(
      { values, secrets, legacyUrls },
      {
        onSuccess: () => {
          setClearing({});
          setSaved(true);
          // A saved secret is never shown again: empty its field, and keep what was typed elsewhere.
          for (const definition of fields.filter((entry) => entry.secret)) {
            const input = element.elements.namedItem(definition.key);
            if (input instanceof HTMLInputElement) input.value = "";
          }
        },
      },
    );
  };

  const field = (definition: FeatureSettingDefinition) => {
    const isSet = Boolean(view.secretsSet[definition.key]);
    const removing = clearing[definition.key];
    return (
      <label key={definition.key} htmlFor={`${id}-${definition.key}`} className="block">
        <FieldLabel>{definition.label}</FieldLabel>
        <input
          id={`${id}-${definition.key}`}
          name={definition.key}
          type={definition.type}
          autoComplete={definition.secret ? "off" : undefined}
          spellCheck={false}
          disabled={removing}
          placeholder={definition.secret && isSet ? (removing ? "Will be removed" : "Saved. Type to replace it") : undefined}
          defaultValue={definition.secret ? "" : (view.values[definition.key] ?? "")}
          className={cn(PAPER_INPUT, "w-full")}
        />
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-paper-sage">
          <span>{definition.hint}</span>
          {definition.secret && isSet ? (
            <button
              type="button"
              className="cursor-pointer font-medium text-paper-blue underline-offset-2 hover:underline"
              onClick={() => setClearing((state) => ({ ...state, [definition.key]: !removing }))}
            >
              {removing ? "Keep it" : "Remove"}
            </button>
          ) : null}
        </span>
      </label>
    );
  };

  const configured = fields.filter((definition) => (definition.secret ? view.secretsSet[definition.key] : view.values[definition.key])).length;

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border border-paper-mist bg-paper-linen p-4" aria-labelledby={`${id}-title`}>
      <div>
        <h4 id={`${id}-title`} className="flex flex-wrap items-center gap-2 font-semibold text-paper-moss">
          <KeyRound className="size-4 text-paper-sage" aria-hidden="true" />
          What the features need
          <span className="text-[12.5px] font-normal text-paper-sage tabular-nums">
            {configured} of {fields.length} set{wantsUrls ? ` · ${view.legacyUrls.length} old address${view.legacyUrls.length === 1 ? "" : "es"}` : ""}
          </span>
        </h4>
        <p className="mt-1 max-w-[75ch] text-[13px] leading-5 text-paper-char">
          The features are built to read these by name and AgentOS puts them in the Vercel preview, never production. Anything left empty is built and reported as not configured. AgentOS never sends a test enquiry.
        </p>
      </div>
      {fields.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">{fields.map(field)}</div> : null}
      {wantsUrls ? (
        <label htmlFor={`${id}-legacyUrls`} className="block">
          <FieldLabel>Old addresses that must keep working</FieldLabel>
          <textarea
            id={`${id}-legacyUrls`}
            name="legacyUrls"
            spellCheck={false}
            defaultValue={view.legacyUrls.join("\n")}
            placeholder={"/articles/\n/articles/antenuptial-contracts/"}
            className={cn(PAPER_INPUT, "min-h-20 w-full max-w-[75ch] font-mono text-[12.5px]")}
          />
          <span className="mt-0.5 block text-[12.5px] text-paper-sage">One path per line, from the current site. Each must redirect to its new page or still be served.</span>
        </label>
      ) : null}
      {save.error ? (
        <p role="alert" className="text-[12.5px] text-paper-flame-deep">
          {save.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <PaperButton type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </PaperButton>
        {saved && !save.isPending ? (
          <span role="status" className="inline-flex items-center gap-1 text-[12.5px] text-paper-green">
            <CheckCircle2 className="size-3.5" aria-hidden="true" /> Saved. The next functions revision and preview use these.
          </span>
        ) : null}
      </div>
    </form>
  );
}
