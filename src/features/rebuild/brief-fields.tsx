import { REBUILD_FUNCTION_LABEL, RebuildFunctionSchema, type RebuildFunction } from "@shared/website-rebuild-types";
import { FieldLabel, PAPER_INPUT } from "@/components/paper";

/** What the starting values of the brief are. `company` is left out when the workspace already names the client. */
export interface BriefDefaults {
  company?: string;
  websiteUrl: string;
  targetMarket: string;
}

/**
 * The rebuild's brief: who the client is, what the site is for, and the
 * features it needs. Shared by every place a rebuild can start, so they all
 * ask the same questions.
 */
export function RebuildBriefFields({ id, defaults, functions, onFunctions }: { id: string; defaults: BriefDefaults; functions: RebuildFunction[]; onFunctions: (next: RebuildFunction[]) => void }) {
  const field = (name: string, label: string, defaultValue: string, hint?: string, type = "text", required = true) => (
    <label className="block" htmlFor={`${id}-${name}`}>
      <FieldLabel>{label}</FieldLabel>
      <input id={`${id}-${name}`} name={name} type={type} required={required} className={PAPER_INPUT} defaultValue={defaultValue} />
      {hint ? <span className="mt-0.5 block text-[13px] text-paper-sage">{hint}</span> : null}
    </label>
  );

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {defaults.company !== undefined ? field("company", "Company", defaults.company) : null}
        {field("websiteUrl", "Current website (optional)", defaults.websiteUrl, "Leave empty if they have none. A Facebook or other social page is fine: reading the site is skipped.", "url", false)}
        {field("targetMarket", "Target market", defaults.targetMarket, "Who they sell to, e.g. homeowners needing an electrician")}
        {field("location", "Location", "", "Town or area they serve")}
        {field("conversionGoal", "Main goal for visitors", "Get in touch", "What a visitor should do, e.g. book a call-out")}
        {field("designTemplate", "DESIGN.md template", "DESIGN.md", "Path to the DESIGN.md whose structure the three concepts follow")}
      </div>
      <fieldset>
        <legend>
          <FieldLabel>Functions the site needs</FieldLabel>
        </legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {RebuildFunctionSchema.options.map((value) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={functions.includes(value)}
                onChange={(event) => onFunctions(event.target.checked ? [...functions, value] : functions.filter((entry) => entry !== value))}
              />
              {REBUILD_FUNCTION_LABEL[value]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
