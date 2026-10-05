import { Check, CircleDashed, Eye, EyeOff, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { ConnectorDetail, ConnectorSetupItem } from "@shared/connector-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useSaveConnectorCredentials } from "@/lib/agentos/connectors";
import { cn } from "@/lib/utils";

/**
 * Setup, as a form: type the keys, press Enter, and AgentOS saves them into
 * `.env`, applies them without a restart, switches the connector on and tests
 * it. Each step of that is shown as it comes back.
 *
 * A saved key is never shown again. Its field says it is set, and left blank
 * it is left alone, so pressing Enter to change one setting can't wipe
 * another. Non-secret settings (an address, a team id) show their value.
 */
export function ConnectorSetupForm({ connector }: { connector: ConnectorDetail }) {
  const save = useSaveConnectorCredentials();
  const fields = connector.setup.filter((item) => item.envName);
  const steps = connector.setup.filter((item) => !item.envName);
  const [values, setValues] = useState<Record<string, string>>({});

  const filled = Object.values(values).some((value) => value.trim().length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!filled || save.isPending) return;
    save.mutate(
      { id: connector.id, values },
      // Keys leave the page once sent: nothing typed stays in memory longer than it has to.
      { onSuccess: () => setValues({}) },
    );
  };

  return (
    <div>
      <p className="max-w-[72ch] text-[13.5px] leading-6 text-paper-char">{connector.connectHint}</p>

      {steps.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {steps.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-[13.5px] text-paper-moss">
              <Done done={item.done} />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {fields.length > 0 ? (
        <form onSubmit={submit} className="mt-5 max-w-[640px] space-y-4" autoComplete="off" aria-label={`${connector.name} settings`}>
          {fields.map((item) => (
            <Field
              key={item.envName}
              item={item}
              value={values[item.envName ?? ""] ?? ""}
              onChange={(value) => setValues((current) => ({ ...current, [item.envName ?? ""]: value }))}
            />
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <PaperButton type="submit" variant="amber" disabled={!filled || save.isPending}>
              {save.isPending ? "Connecting…" : "Save & connect"}
            </PaperButton>
            <span className="text-[12.5px] text-paper-sage">
              Written to <code className="font-mono text-[12px]">.env</code> on this machine. Enter works from any field.
            </span>
          </div>
        </form>
      ) : null}

      {save.isError ? (
        <p role="alert" className="mt-4 text-[13px] text-paper-flame-deep">
          {save.error.message}
        </p>
      ) : null}

      {save.data ? (
        <ol aria-live="polite" aria-label="Save & connect" className="mt-5 max-w-[640px] divide-y divide-paper-stone rounded-none border border-paper-mist">
          {save.data.steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3 px-4 py-2.5 text-[13.5px]">
              {step.ok ? (
                <Check className="mt-0.5 size-4 shrink-0 text-paper-green" aria-label="Done" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-paper-flame-deep" aria-label="Failed" />
              )}
              <span className="min-w-0">
                <span className="font-semibold text-paper-moss">{step.label}</span>
                {step.detail ? <span className="block break-words text-paper-char">{step.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Done({ done }: { done: boolean }) {
  return done ? (
    <>
      <Check className="size-4 shrink-0 text-paper-green" aria-hidden="true" />
      <span className="sr-only">done:</span>
    </>
  ) : (
    <>
      <CircleDashed className="size-4 shrink-0 text-paper-ash" aria-hidden="true" />
      <span className="sr-only">not done:</span>
    </>
  );
}

function Field({ item, value, onChange }: { item: ConnectorSetupItem; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const secret = Boolean(item.secret);

  const placeholder = secret
    ? item.done
      ? "Saved. Type to replace it"
      : (item.placeholder ?? "Paste the key")
    : (item.value ?? item.placeholder ?? "");

  return (
    <div>
      <label htmlFor={id} className="block">
      <FieldLabel>
        <span className="flex flex-wrap items-center gap-2">
          <Done done={item.done} />
          <code className="font-mono text-[12px] text-paper-moss">{item.envName}</code>
          {item.label !== item.envName ? <span className="text-paper-sage">{item.label.replace(item.envName ?? "", "").trim()}</span> : null}
          {item.optional ? <span className="text-paper-sage">optional</span> : null}
        </span>
      </FieldLabel>
      </label>
      <span className="flex gap-2">
        <input
          id={id}
          name={item.envName}
          type={secret && !shown ? "password" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={secret ? "new-password" : "off"}
          spellCheck={false}
          autoCapitalize="off"
          className={cn(PAPER_INPUT, "min-w-0 flex-1 font-mono text-[13px]")}
        />
        {secret ? (
          <button
            type="button"
            onClick={() => setShown((current) => !current)}
            aria-label={shown ? `Hide ${item.envName}` : `Show ${item.envName}`}
            aria-pressed={shown}
            className={cn("grid min-h-8 w-9 shrink-0 cursor-pointer place-items-center rounded-none border border-paper-ash text-paper-sage hover:text-paper-moss", PAPER_FOCUS)}
          >
            {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        ) : null}
      </span>
    </div>
  );
}
