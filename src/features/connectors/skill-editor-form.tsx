import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { SKILL_MAX_BYTES, type SkillSummary } from "@shared/skill-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useConnectors } from "@/lib/agentos/connectors";
import { useParseSkill, useSaveSkill } from "@/lib/agentos/skills";

interface SkillEditorFormProps {
  /** The skill being edited; absent when adding a new one. */
  skill?: SkillSummary;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/**
 * Writing a skill on the page, or reviewing an uploaded SKILL.md before it is
 * saved. Nothing is stored until Save, and the server checks the skill the
 * same way it checks every other one before keeping it.
 */
export function SkillEditorForm({ skill, onDone, onCancel }: SkillEditorFormProps) {
  const id = useId();
  const save = useSaveSkill();
  const parse = useParseSkill();
  const connectors = useConnectors();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(skill?.id ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [requires, setRequires] = useState<string[]>(skill?.requirements.map((requirement) => requirement.connector) ?? []);
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [version, setVersion] = useState<string | undefined>();
  const [notes, setNotes] = useState<string[]>([]);

  const known = connectors.data?.connectors ?? [];
  const editing = Boolean(skill);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > SKILL_MAX_BYTES) {
      setNotes(["That file is larger than 256 KB."]);
      return;
    }
    const markdown = await file.text();
    parse.mutate(markdown, {
      onSuccess: (result) => {
        if (!editing) setName(result.draft.name);
        setDescription(result.draft.description);
        setRequires(result.draft.requires);
        setInstructions(result.draft.instructions);
        setVersion(result.draft.version);
        const unknown = result.draft.requires.filter((connector) => !known.some((entry) => entry.id === connector));
        setNotes([
          ...result.errors,
          ...unknown.map((connector) => `Needs a connector AgentOS doesn't have: ${connector}. Remove it to save.`),
          ...(editing && result.draft.name && result.draft.name !== skill?.id ? [`The file is named ${result.draft.name}; this skill keeps its name, ${skill?.id}.`] : []),
          `Read from ${file.name}. Review it, then save.`,
        ]);
      },
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      { id: skill?.id, draft: { name: name.trim(), description, requires, instructions, ...(version ? { version } : {}) } },
      { onSuccess: (saved) => onDone(editing ? `Saved ${saved.name} as v${saved.version}.` : `Added ${saved.name}. It is on, and offered when you delegate a job.`) },
    );
  };

  const toggleRequirement = (connector: string) =>
    setRequires((current) => (current.includes(connector) ? current.filter((entry) => entry !== connector) : [...current, connector]));

  return (
    <form onSubmit={submit} className="grid gap-4 border border-paper-mist bg-paper-cream p-4" aria-label={editing ? `Edit ${skill?.name}` : "Add a skill"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-paper-moss">{editing ? `Edit ${skill?.name}` : "Add a skill"}</h3>
        <div>
          <input ref={fileInput} type="file" accept=".md,text/markdown,text/plain" hidden onChange={(event) => void upload(event)} />
          <PaperButton type="button" variant="ghost" onClick={() => fileInput.current?.click()} disabled={parse.isPending}>
            <Upload className="size-3.5" aria-hidden="true" /> {parse.isPending ? "Reading…" : "Upload SKILL.md"}
          </PaperButton>
        </div>
      </div>

      {notes.length > 0 ? (
        <ul className="grid gap-1 text-[12.5px] text-paper-char" role="status">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <label className="block">
        <FieldLabel>Name</FieldLabel>
        <input
          id={`${id}-name`}
          className={`${PAPER_INPUT} w-full`}
          value={name}
          onChange={(event) => setName(event.target.value.toLowerCase())}
          placeholder="seo-audit"
          disabled={editing}
          required
          maxLength={63}
          pattern="[a-z0-9][a-z0-9-]*"
          title="Lowercase letters, digits and hyphens"
        />
        <span className="mt-1 block text-[12px] text-paper-sage">
          {editing ? "The name is the skill's id and can't change." : "Lowercase letters, digits and hyphens. This is the skill's id."}
        </span>
      </label>

      <label className="block">
        <FieldLabel>Description</FieldLabel>
        <textarea
          className={`${PAPER_INPUT} w-full resize-y py-2`}
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What the skill does, and when to use it"
          required
          maxLength={1000}
        />
      </label>

      <fieldset>
        <legend className="mb-1.5 block text-[12.5px] font-medium text-paper-char">Needs connectors (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {known.map((connector) => (
            <label key={connector.id} className="inline-flex items-center gap-1.5 border border-paper-mist px-2 py-1 text-[12.5px] text-paper-char">
              <input type="checkbox" checked={requires.includes(connector.id)} onChange={() => toggleRequirement(connector.id)} />
              {connector.name}
            </label>
          ))}
          {requires
            .filter((connector) => !known.some((entry) => entry.id === connector))
            .map((connector) => (
              <label key={connector} className="inline-flex items-center gap-1.5 border border-paper-flame/50 px-2 py-1 text-[12.5px] text-paper-flame-deep">
                <input type="checkbox" checked onChange={() => toggleRequirement(connector)} />
                {connector} (unknown)
              </label>
            ))}
        </div>
        <span className="mt-1 block text-[12px] text-paper-sage">A job can't use the skill until these are connected. Skills never carry credentials.</span>
      </fieldset>

      <label className="block">
        <FieldLabel>Instructions (Markdown)</FieldLabel>
        <textarea
          className={`${PAPER_INPUT} w-full resize-y py-2 font-mono text-[13px] leading-5`}
          rows={14}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={"# How to do this kind of work\n\n1. …\n2. …"}
          required
        />
        <span className="mt-1 block text-[12px] text-paper-sage">
          What the worker should do, step by step. Links to other local files aren't supported: put everything in here.
        </span>
      </label>

      {save.error ? (
        <p role="alert" className="text-[12.5px] text-paper-flame-deep">
          {save.error.message}
        </p>
      ) : null}
      {parse.error ? (
        <p role="alert" className="text-[12.5px] text-paper-flame-deep">
          {parse.error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <PaperButton type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </PaperButton>
        <PaperButton type="submit" variant="amber" disabled={save.isPending}>
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Add skill"}
        </PaperButton>
      </div>
    </form>
  );
}
