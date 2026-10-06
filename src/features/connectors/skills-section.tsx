import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import type { SkillSummary } from "@shared/skill-types";
import { PaperButton, PaperSection, PaperSwitch, Tag } from "@/components/paper";
import { useDeleteSkill, useSetSkillEnabled, useSkills } from "@/lib/agentos/skills";
import { SkillEditorForm } from "./skill-editor-form";

const SOURCE_LABEL: Record<SkillSummary["source"], string> = { bundled: "Bundled", local: "Local", added: "Added" };

/**
 * Skills sit beside connectors because they are the other half of "what may
 * AgentOS do": a skill is instructions, a connector is access. Turning a skill
 * on grants it nothing; its requirements show the connectors it still needs.
 */
export function SkillsSection() {
  const skills = useSkills();
  const list = skills.data?.skills ?? [];
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  return (
    <PaperSection label="Skills" count={list.length} className="mt-12">
      <p className="mb-4 max-w-[80ch] text-[13px] leading-5 text-paper-sage">
        Instructions for whole kinds of work, like a client website rebuild. A disabled skill can't be started, and runs already using it pause before
        their next stage with everything kept. Skills never carry credentials: the connectors they need keep their own switches.
      </p>
      <p className="mb-4 max-w-[80ch] text-[13px] leading-5 text-paper-sage">
        Skills you add are offered when you delegate a job in Workers: the worker gets the skill&apos;s instructions with the objective.
      </p>
      {adding ? (
        <div className="mb-4">
          <SkillEditorForm
            onCancel={() => setAdding(false)}
            onDone={(message) => {
              setAdding(false);
              setNotice(message);
            }}
          />
        </div>
      ) : (
        <div className="mb-4">
          <PaperButton
            type="button"
            variant="amber"
            onClick={() => {
              setNotice(undefined);
              setAdding(true);
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" /> Add skill
          </PaperButton>
        </div>
      )}
      {notice ? (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-3 border border-paper-mist bg-paper-cream px-3 py-2 text-[13px] text-paper-char">
          {notice}
          <button type="button" className="font-semibold text-paper-blue hover:underline" onClick={() => setNotice(undefined)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {skills.isPending ? (
        <p role="status" className="text-[13px]">
          Reading skills…
        </p>
      ) : skills.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {skills.error.message}
        </p>
      ) : list.length === 0 ? (
        <p className="text-[13px] text-paper-sage">No skills yet. Add one above, or upload a SKILL.md.</p>
      ) : (
        <ul className="grid gap-3">
          {list.map((skill) => (
            <li key={skill.id}>
              <SkillCard skill={skill} onNotice={setNotice} />
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

function SkillCard({ skill, onNotice }: { skill: SkillSummary; onNotice: (message: string) => void }) {
  const toggle = useSetSkillEnabled();
  const remove = useDeleteSkill();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <SkillEditorForm
        skill={skill}
        onCancel={() => setEditing(false)}
        onDone={(message) => {
          setEditing(false);
          onNotice(message);
        }}
      />
    );
  }
  const missing = skill.requirements.filter((requirement) => !requirement.connected);

  return (
    <article className="rounded-none border border-paper-mist bg-paper-cream p-4" aria-label={skill.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold text-paper-moss">
            {skill.name}
            <span className="font-paper-utility text-[12px] font-normal text-paper-sage">v{skill.version}</span>
            <Tag tone={skill.source === "bundled" ? "blue" : skill.source === "added" ? "green" : "muted"}>{SOURCE_LABEL[skill.source]}</Tag>
            {skill.activeRuns > 0 ? <Tag tone="marigold">{skill.activeRuns} active run{skill.activeRuns === 1 ? "" : "s"}</Tag> : null}
          </h3>
          <p className="mt-1 max-w-[80ch] text-[13px] leading-5 text-paper-char">{skill.description || "No description."}</p>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-paper-sage">{skill.enabled ? "Enabled" : "Disabled"}</span>
          <PaperSwitch
            checked={skill.enabled}
            disabled={toggle.isPending || (!skill.enabled && skill.errors.length > 0)}
            label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
            onChange={(enabled) => {
              if (!enabled && skill.activeRuns > 0 && !window.confirm(`${skill.activeRuns} run${skill.activeRuns === 1 ? " uses" : "s use"} this skill. They will pause before their next stage. Disable it?`)) return;
              toggle.mutate({ id: skill.id, enabled });
            }}
          />
        </div>
      </div>

      {skill.requirements.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-paper-sage">Needs:</span>
          {skill.requirements.map((requirement) => (
            <Tag key={requirement.connector} tone={requirement.connected ? "green" : "flame"}>
              {requirement.name} · {requirement.connected ? "connected" : requirement.known ? "not connected" : "unknown"}
            </Tag>
          ))}
        </p>
      ) : null}
      {missing.length > 0 && skill.enabled ? (
        <p className="mt-2 text-[12.5px] text-paper-sage">Work that needs {missing.map((requirement) => requirement.name).join(", ")} will block until connected; everything else can go ahead.</p>
      ) : null}

      {skill.errors.length > 0 ? (
        <ul role="alert" className="mt-3 grid gap-1 border border-paper-flame/40 bg-paper-flame/5 p-3 text-[12.5px] text-paper-char">
          {skill.errors.map((error) => (
            <li key={error} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-paper-flame" aria-hidden="true" />
              {error}
            </li>
          ))}
        </ul>
      ) : null}
      {toggle.error ? <p className="mt-2 text-[12.5px] text-paper-flame-deep">{toggle.error.message}</p> : null}
      {remove.error ? <p className="mt-2 text-[12.5px] text-paper-flame-deep">{remove.error.message}</p> : null}

      {skill.source === "added" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <PaperButton type="button" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${skill.name}`}>
            <Pencil className="size-3.5" aria-hidden="true" /> Edit
          </PaperButton>
          <PaperButton
            type="button"
            variant="danger"
            disabled={remove.isPending || skill.activeRuns > 0}
            title={skill.activeRuns > 0 ? "A run is using this skill" : undefined}
            aria-label={`Delete ${skill.name}`}
            onClick={() => {
              if (!window.confirm(`Delete the ${skill.name} skill? Jobs that already used it keep their copy of its instructions.`)) return;
              remove.mutate(skill.id, { onSuccess: () => onNotice(`Deleted ${skill.name}.`) });
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" /> {remove.isPending ? "Deleting…" : "Delete"}
          </PaperButton>
        </div>
      ) : null}

      <button type="button" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-paper-blue hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        {open ? "Hide instructions" : "View instructions"}
      </button>
      {open ? <pre className="mt-2 max-h-[420px] overflow-auto border border-paper-mist bg-paper-white p-3 text-[12px] leading-5 whitespace-pre-wrap text-paper-char">{skill.instructions}</pre> : null}
    </article>
  );
}
