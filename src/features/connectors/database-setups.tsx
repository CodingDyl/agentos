import { Check, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { DatabaseSetup } from "@shared/database-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import {
  useAddDatabaseSetup,
  useDatabaseSetups,
  useRemoveDatabaseSetup,
  useTestDatabaseSetup,
  useUpdateDatabaseSetup,
} from "@/lib/agentos/databases";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { setupIdFrom } from "../databases/database-model";
import { formatWhen } from "./connectors-model";

/**
 * Supabase setups: one per project and environment, each with its own key,
 * each linked to the workspaces that use it.
 *
 * The key is typed once. It goes into `.env` as `SUPABASE_KEY__<ID>` and is
 * never shown again; replacing it is typing a new one.
 */
export function DatabaseSetups() {
  const setups = useDatabaseSetups();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {setups.isPending ? (
        <p className="text-[14px] text-paper-sage">Reading database setups…</p>
      ) : setups.isError ? (
        <p role="alert" className="text-[14px] text-paper-flame-deep">{setups.error.message}</p>
      ) : setups.data.length === 0 && !adding ? (
        <p className="text-[14px] text-paper-sage">No databases yet. Add one per Supabase project and environment.</p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
          {setups.data.map((setup) => (
            <SetupRow key={setup.id} setup={setup} />
          ))}
        </ul>
      )}

      {adding ? (
        <SetupForm onDone={() => setAdding(false)} />
      ) : (
        <PaperButton variant="ghost" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add database
        </PaperButton>
      )}
    </div>
  );
}

function WorkspacePicker({ selected, onChange }: { selected: string[]; onChange: (slugs: string[]) => void }) {
  const { data } = useProjects();
  const projects = data?.projects ?? [];
  if (projects.length === 0) return <p className="text-[13px] text-paper-sage">No workspaces to link yet.</p>;

  return (
    <fieldset>
      <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">Linked workspaces</legend>
      <div className="flex flex-wrap gap-2">
        {projects.map((project) => {
          const on = selected.includes(project.slug);
          return (
            <label
              key={project.slug}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-none border px-2.5 py-1 text-[13px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-paper-blue",
                on ? "border-paper-blue bg-paper-blue text-paper-white" : "border-paper-mist text-paper-moss hover:bg-paper-linen",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onChange(on ? selected.filter((slug) => slug !== project.slug) : [...selected, project.slug])}
              />
              {on ? <Check className="size-3.5" aria-hidden="true" /> : null}
              {project.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Add, or edit when given a setup. Enter in any field submits. */
function SetupForm({ setup, onDone }: { setup?: DatabaseSetup; onDone: () => void }) {
  const add = useAddDatabaseSetup();
  const update = useUpdateDatabaseSetup();
  const [name, setName] = useState(setup?.name ?? "");
  const [url, setUrl] = useState(setup?.url ?? "");
  const [environment, setEnvironment] = useState(setup?.environment ?? "");
  const [key, setKey] = useState("");
  const [projects, setProjects] = useState<string[]>(setup?.projectSlugs ?? []);
  const mutation = setup ? update : add;
  const id = setup?.id ?? setupIdFrom(`${name} ${environment}`);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = { name, url, environment: environment || undefined, key: key || undefined, projectSlugs: projects };
    if (setup) update.mutate({ id: setup.id, ...input }, { onSuccess: onDone });
    else add.mutate({ id, ...input }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} aria-label={setup ? `Edit ${setup.name}` : "Add database"} autoComplete="off" className="space-y-4 rounded-none border border-paper-mist bg-paper-cream p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input className={cn(PAPER_INPUT, "w-full")} name="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Pantry Pilot" />
        </label>
        <label className="block">
          <FieldLabel>Environment (optional)</FieldLabel>
          <input className={cn(PAPER_INPUT, "w-full")} name="environment" value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="production" />
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>Project URL</FieldLabel>
          <input className={cn(PAPER_INPUT, "w-full font-mono text-[13px]")} name="url" required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://abcd1234.supabase.co" />
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>Secret key (service_role or sb_secret_…)</FieldLabel>
          <input
            className={cn(PAPER_INPUT, "w-full font-mono text-[13px]")}
            name="key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={setup?.keySet ? "Saved. Type to replace it" : "Paste the key"}
          />
        </label>
      </div>

      <WorkspacePicker selected={projects} onChange={setProjects} />

      <p className="text-[12.5px] leading-5 text-paper-sage">
        The key is saved to <code className="font-mono">.env</code> as <code className="font-mono">{setup?.keyEnvName ?? `SUPABASE_KEY__${id.toUpperCase().replace(/-/g, "_")}`}</code> and
        never shown again. It bypasses row-level security, so AgentOS reads with it and writes only one row at a time, by primary key.
      </p>

      {mutation.isError ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">{mutation.error.message}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <PaperButton type="submit" variant="amber" disabled={mutation.isPending || !name.trim() || !url.trim()}>
          {mutation.isPending ? "Saving…" : setup ? "Save" : "Add & test"}
        </PaperButton>
        <PaperButton variant="quiet" onClick={onDone}>
          Cancel
        </PaperButton>
      </div>
    </form>
  );
}

function SetupRow({ setup }: { setup: DatabaseSetup }) {
  const test = useTestDatabaseSetup();
  const remove = useRemoveDatabaseSetup();
  const { data } = useProjects();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const names = new Map((data?.projects ?? []).map((project) => [project.slug, project.name]));

  if (editing) {
    return (
      <li className="p-3">
        <SetupForm setup={setup} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const error = test.error ?? remove.error;

  return (
    <li className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-paper-moss">
          {setup.name}
          {setup.environment ? <Tag tone="muted">{setup.environment}</Tag> : null}
          {!setup.keySet ? (
            <Tag tone="marigold">No key</Tag>
          ) : setup.lastTest ? (
            <Tag tone={setup.lastTest.ok ? "green" : "flame"}>{setup.lastTest.ok ? "Connected" : "Error"}</Tag>
          ) : (
            <Tag tone="muted">Not tested</Tag>
          )}
        </p>
        <p className="mt-0.5 truncate font-mono text-[12px] text-paper-sage">{setup.url}</p>
        {setup.lastTest ? (
          <p className={cn("mt-1 text-[12.5px]", setup.lastTest.ok ? "text-paper-char" : "text-paper-flame-deep")}>
            {setup.lastTest.detail} · {formatWhen(setup.lastTest.checkedAt)}
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
          {setup.projectSlugs.length === 0 ? (
            <span className="text-paper-sage">Not linked to a workspace</span>
          ) : (
            setup.projectSlugs.map((slug) => (
              <Link
                key={slug}
                to={`/workspaces/${encodeURIComponent(slug)}?tab=database`}
                className={cn("rounded-none bg-paper-linen px-2 py-0.5 text-paper-moss hover:bg-paper-stone", PAPER_FOCUS)}
              >
                {names.get(slug) ?? slug}
              </Link>
            ))
          )}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] text-paper-flame-deep">{error.message}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[12.5px] text-paper-char">Remove {setup.name} and its key?</span>
            <PaperButton variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(setup.id)}>
              {remove.isPending ? "Removing…" : "Remove"}
            </PaperButton>
            <PaperButton variant="quiet" onClick={() => setConfirming(false)} aria-label="Keep it">
              <X className="size-3.5" aria-hidden="true" />
            </PaperButton>
          </>
        ) : (
          <>
            <PaperButton variant="quiet" disabled={!setup.keySet || test.isPending} onClick={() => test.mutate(setup.id)}>
              {test.isPending ? "Testing…" : "Test"}
            </PaperButton>
            <PaperButton variant="quiet" onClick={() => setEditing(true)}>
              Edit
            </PaperButton>
            <PaperButton variant="quiet" onClick={() => setConfirming(true)}>
              Remove
            </PaperButton>
          </>
        )}
      </div>
    </li>
  );
}
