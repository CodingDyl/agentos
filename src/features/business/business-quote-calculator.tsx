import { useMemo, useState } from "react";
import {
  COMPLEXITY_MULTIPLIERS,
  CYCLE,
  DEFAULT_HOURLY_RATE,
  MAINTENANCE_FREQUENCIES,
  PRICED_FEATURES,
  priceQuote,
  QuoteInputSchema,
  SERVICE_SKUS,
  STANDARD_FEATURES,
  URGENCY_MULTIPLIERS,
  type QuoteInput,
} from "@shared/business-quote-pricing";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, SegmentedControl } from "@/components/paper";
import { cn } from "@/lib/utils";
import { formatRand } from "./business-model";

/**
 * The quote calculator: Virtec's pricing, worked out live, with every factor
 * shown so the price can be explained line by line to the client.
 *
 * It prices; it does not yet save or send. Where a saved quote lives (Virtec
 * or AgentOS) is still to be decided, so this hands back a plain-text summary
 * to paste into the quote instead of inventing a second record.
 */

type Kind = QuoteInput["kind"];

const numberInput = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

export function QuoteCalculator({ clientName, onClose }: { clientName?: string; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("project");
  const [projectType, setProjectType] = useState("Website");
  const [complexity, setComplexity] = useState<keyof typeof COMPLEXITY_MULTIPLIERS>("Medium");
  const [urgency, setUrgency] = useState<keyof typeof URGENCY_MULTIPLIERS>("Standard");
  const [hours, setHours] = useState(0);
  const [rate, setRate] = useState(DEFAULT_HOURLY_RATE);
  const [features, setFeatures] = useState<string[]>([]);
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "hourly" | "hours">("none");
  const [discountValue, setDiscountValue] = useState(0);
  const [hosting, setHosting] = useState(0);
  const [maintenance, setMaintenance] = useState(0);
  const [frequency, setFrequency] = useState<(typeof MAINTENANCE_FREQUENCIES)[number]>("monthly");
  const [sku, setSku] = useState<"" | "care" | "seo" | "bundle">("care");
  const [copied, setCopied] = useState(false);

  const input = useMemo(
    () =>
      QuoteInputSchema.safeParse(
        kind === "project"
          ? { kind, projectType, complexity, urgency, estimatedHours: hours, hourlyRate: rate, features, discountType, discountValue, hostingCost: hosting, maintenanceCost: maintenance }
          : { kind, projectType, frequency, serviceSku: sku || undefined, hoursPerCycle: hours, hourlyRate: rate, features },
      ),
    [kind, projectType, complexity, urgency, hours, rate, features, discountType, discountValue, hosting, maintenance, frequency, sku],
  );
  const price = input.success ? priceQuote(input.data) : undefined;

  const toggle = (name: string) => setFeatures((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]));

  const summary = price
    ? [
        `${kind === "project" ? "Quote" : "Maintenance quote"}${clientName ? ` for ${clientName}` : ""}: ${projectType}`,
        ...price.lines.map((line) => `  ${line.label}: ${line.type === "multiplier" ? `×${line.value}` : formatRand(line.value)}`),
        kind === "project" ? `Total: ${formatRand(price.total)}` : `Total: ${formatRand(price.total)} per ${CYCLE[frequency]} (${formatRand(price.monthly ?? 0)}/month)`,
        features.length ? `Includes: ${features.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PaperCard className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-paper-display text-[19px] font-bold">New quote{clientName ? ` · ${clientName}` : ""}</h2>
        <SegmentedControl
          label="Quote type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "project", label: "Project" },
            { value: "maintenance", label: "Maintenance" },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <Field label="Project type">
            <input value={projectType} onChange={(event) => setProjectType(event.target.value)} maxLength={120} className={cn(PAPER_INPUT, "w-full")} />
          </Field>

          {kind === "project" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Estimated hours">
                  <input type="number" min={0} value={hours} onChange={(event) => setHours(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                </Field>
                <Field label="Hourly rate (R)">
                  <input type="number" min={0} value={rate} onChange={(event) => setRate(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                </Field>
                <Field label="Complexity">
                  <select value={complexity} onChange={(event) => setComplexity(event.target.value as typeof complexity)} className={cn(PAPER_INPUT, "w-full")}>
                    {Object.entries(COMPLEXITY_MULTIPLIERS).map(([name, factor]) => (
                      <option key={name} value={name}>{`${name} (×${factor})`}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Urgency">
                  <select value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)} className={cn(PAPER_INPUT, "w-full")}>
                    {Object.entries(URGENCY_MULTIPLIERS).map(([name, factor]) => (
                      <option key={name} value={name}>{`${name} (×${factor})`}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-[12.5px] font-medium text-paper-char">Features that change the price</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {PRICED_FEATURES.map((feature) => (
                    <label key={feature.name} className="flex min-h-8 cursor-pointer items-center gap-2 text-[14px]">
                      <input type="checkbox" checked={features.includes(feature.name)} onChange={() => toggle(feature.name)} />
                      {feature.name}
                      <span className="text-[12.5px] text-paper-sage">×{feature.multiplier}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <details>
                <summary className="cursor-pointer text-[13px] text-paper-blue">Included features (listed, not priced)</summary>
                <div className="mt-2 grid gap-1 sm:grid-cols-3">
                  {STANDARD_FEATURES.map((name) => (
                    <label key={name} className="flex min-h-8 cursor-pointer items-center gap-2 text-[13.5px]">
                      <input type="checkbox" checked={features.includes(name)} onChange={() => toggle(name)} />
                      {name}
                    </label>
                  ))}
                </div>
              </details>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Discount">
                  <select value={discountType} onChange={(event) => setDiscountType(event.target.value as typeof discountType)} className={cn(PAPER_INPUT, "w-full")}>
                    <option value="none">None</option>
                    <option value="percentage">Percentage off</option>
                    <option value="hourly">Lower hourly rate by R</option>
                    <option value="hours">Fewer hours</option>
                  </select>
                </Field>
                {discountType !== "none" ? (
                  <Field label={discountType === "percentage" ? "Percent" : discountType === "hourly" ? "Rate reduction (R)" : "Hours off"}>
                    <input type="number" min={0} value={discountValue} onChange={(event) => setDiscountValue(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                  </Field>
                ) : null}
                <Field label="Hosting (R, once-off)">
                  <input type="number" min={0} value={hosting} onChange={(event) => setHosting(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                </Field>
                <Field label="Maintenance (R, once-off)">
                  <input type="number" min={0} value={maintenance} onChange={(event) => setMaintenance(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                </Field>
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Plan">
                <select value={sku} onChange={(event) => setSku(event.target.value as typeof sku)} className={cn(PAPER_INPUT, "w-full")}>
                  {SERVICE_SKUS.map((entry) => (
                    <option key={entry.id} value={entry.id}>{`${entry.name}, R${entry.monthly}/month`}</option>
                  ))}
                  <option value="">Custom hours</option>
                </select>
              </Field>
              <Field label="Billed">
                <select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)} className={cn(PAPER_INPUT, "w-full")}>
                  {MAINTENANCE_FREQUENCIES.map((entry) => (
                    <option key={entry} value={entry}>{entry}</option>
                  ))}
                </select>
              </Field>
              {sku ? (
                <p className="text-[13px] text-paper-sage sm:col-span-2">{SERVICE_SKUS.find((entry) => entry.id === sku)?.includes}</p>
              ) : (
                <>
                  <Field label="Hours per cycle">
                    <input type="number" min={0} value={hours} onChange={(event) => setHours(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                  </Field>
                  <Field label="Hourly rate (R)">
                    <input type="number" min={0} value={rate} onChange={(event) => setRate(numberInput(event.target.value))} className={cn(PAPER_INPUT, "w-full")} />
                  </Field>
                </>
              )}
            </div>
          )}
        </div>

        <aside aria-label="Price breakdown" className="grid content-start gap-3 border border-paper-mist bg-paper-cream p-4">
          {price ? (
            <>
              <ul className="grid gap-1.5 text-[13.5px]">
                {price.lines.map((line) => (
                  <li key={line.label} className="flex justify-between gap-3">
                    <span className="text-paper-char">{line.label}</span>
                    <span className={line.type === "discount" ? "text-paper-green" : undefined}>{line.type === "multiplier" ? `×${line.value}` : formatRand(line.value)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-paper-mist pt-3">
                <span className="block text-[12.5px] text-paper-sage">{kind === "project" ? "Total" : `Per ${CYCLE[frequency]}`}</span>
                <span className="font-paper-display text-[28px] font-bold">{formatRand(price.total)}</span>
                {kind === "maintenance" && price.monthly !== undefined ? <span className="block text-[12.5px] text-paper-sage">{formatRand(price.monthly)} a month</span> : null}
              </p>
            </>
          ) : (
            <p className="text-[13.5px] text-paper-char">{input.success ? "" : input.error.issues[0]?.message}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <PaperButton variant="amber" disabled={!price} onClick={() => void copy()}>
              {copied ? "Copied" : "Copy breakdown"}
            </PaperButton>
            <PaperButton variant="quiet" onClick={onClose}>
              Close
            </PaperButton>
          </div>
        </aside>
      </div>
    </PaperCard>
  );
}
