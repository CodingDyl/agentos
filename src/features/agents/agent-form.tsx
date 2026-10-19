import { useState, type FormEvent } from "react";
import type { AgentPatch, AgentRecord, AgentSchedule } from "@shared/agent-types";
import { MODEL_ROUTE_EFFORTS, MODEL_ROUTE_TASK_TYPES } from "@shared/model-routing-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { csv, parseCsv } from "./agents-model";

export function AgentForm({
  agent,
  pending,
  error,
  onSave,
}: {
  agent: AgentRecord;
  pending: boolean;
  error?: string;
  onSave: (patch: AgentPatch) => void;
}) {
  const [name, setName] = useState(agent.name);
  const [avatar, setAvatar] = useState(agent.avatar);
  const [role, setRole] = useState(agent.role);
  const [mission, setMission] = useState(agent.mission);
  const [standingInstructions, setStandingInstructions] = useState(agent.standingInstructions);
  const [memoryNotes, setMemoryNotes] = useState(agent.memoryNotes);
  const [effort, setEffort] = useState(agent.effort ?? "");
  const [creditCeilingUsd, setCreditCeilingUsd] = useState(String(agent.creditCeilingUsd));
  const [allowedModelOverrides, setAllowedModelOverrides] = useState(csv(agent.allowedModelOverrides));
  const [allowedTools, setAllowedTools] = useState(csv(agent.allowedTools));
  const [allowedConnectors, setAllowedConnectors] = useState(csv(agent.allowedConnectors));
  const [allowedSkills, setAllowedSkills] = useState(csv(agent.allowedSkills));
  const [linkedWorkspaces, setLinkedWorkspaces] = useState(csv(agent.linkedWorkspaces));
  const [keywords, setKeywords] = useState(csv(agent.keywords));
  const [routes, setRoutes] = useState({
    plan: { model: agent.modelRoutes.plan?.model ?? "", effort: agent.modelRoutes.plan?.effort ?? "" },
    execute: { model: agent.modelRoutes.execute?.model ?? "", effort: agent.modelRoutes.execute?.effort ?? "" },
    motion: { model: agent.modelRoutes.motion?.model ?? "", effort: agent.modelRoutes.motion?.effort ?? "" },
    normal: { model: agent.modelRoutes.normal?.model ?? "", effort: agent.modelRoutes.normal?.effort ?? "" },
  });
  const [schedules, setSchedules] = useState<AgentSchedule[]>(agent.schedules);

  function submit(event: FormEvent) {
    event.preventDefault();
    const modelRoutes: AgentPatch["modelRoutes"] = {};
    for (const type of MODEL_ROUTE_TASK_TYPES) {
      const row = routes[type];
      if (row.model.trim() && row.effort) {
        modelRoutes[type] = { model: row.model.trim(), effort: row.effort as (typeof MODEL_ROUTE_EFFORTS)[number] };
      }
    }
    onSave({
      name,
      avatar,
      role,
      mission,
      standingInstructions,
      memoryNotes,
      effort: effort === "" ? undefined : (effort as AgentRecord["effort"]),
      creditCeilingUsd: Number(creditCeilingUsd) || 0,
      allowedModelOverrides: parseCsv(allowedModelOverrides),
      allowedTools: parseCsv(allowedTools),
      allowedConnectors: parseCsv(allowedConnectors),
      allowedSkills: parseCsv(allowedSkills),
      linkedWorkspaces: parseCsv(linkedWorkspaces),
      keywords: parseCsv(keywords),
      modelRoutes,
      schedules: schedules.filter((row) => row.label.trim() && row.cadence.trim()),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)]">
        <label>
          <FieldLabel>Avatar</FieldLabel>
          <input value={avatar} onChange={(event) => setAvatar(event.target.value)} className={PAPER_INPUT} maxLength={16} />
        </label>
        <label>
          <FieldLabel>Name</FieldLabel>
          <input value={name} onChange={(event) => setName(event.target.value)} className={PAPER_INPUT} required />
        </label>
        <label>
          <FieldLabel>Role</FieldLabel>
          <input value={role} onChange={(event) => setRole(event.target.value)} className={PAPER_INPUT} required />
        </label>
      </div>

      <label className="block">
        <FieldLabel>Mission</FieldLabel>
        <textarea value={mission} onChange={(event) => setMission(event.target.value)} className={PAPER_INPUT} rows={2} required />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block">
          <FieldLabel>Standing instructions</FieldLabel>
          <textarea value={standingInstructions} onChange={(event) => setStandingInstructions(event.target.value)} className={PAPER_INPUT} rows={5} />
        </label>
        <label className="block">
          <FieldLabel>Memory notes</FieldLabel>
          <textarea value={memoryNotes} onChange={(event) => setMemoryNotes(event.target.value)} className={PAPER_INPUT} rows={5} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label>
          <FieldLabel>Default effort</FieldLabel>
          <select value={effort} onChange={(event) => setEffort(event.target.value)} className={PAPER_INPUT}>
            <option value="">Table default</option>
            {MODEL_ROUTE_EFFORTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel>Monthly credit ceiling (USD)</FieldLabel>
          <input type="number" min={0} step="1" value={creditCeilingUsd} onChange={(event) => setCreditCeilingUsd(event.target.value)} className={PAPER_INPUT} />
        </label>
        <label>
          <FieldLabel>Linked workspaces</FieldLabel>
          <input value={linkedWorkspaces} onChange={(event) => setLinkedWorkspaces(event.target.value)} className={PAPER_INPUT} placeholder="pantry-pilot, virtara" />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-[12.5px] font-medium text-paper-char">Model routes (leave blank to use AI Stack)</legend>
        <div className="grid gap-2 md:grid-cols-4">
          {MODEL_ROUTE_TASK_TYPES.map((type) => (
            <label key={type} className="block">
              <FieldLabel>{type}</FieldLabel>
              <input
                value={routes[type].model}
                onChange={(event) => setRoutes((current) => ({ ...current, [type]: { ...current[type], model: event.target.value } }))}
                className={PAPER_INPUT}
                placeholder="model"
              />
              <select
                value={routes[type].effort}
                onChange={(event) => setRoutes((current) => ({ ...current, [type]: { ...current[type], effort: event.target.value } }))}
                className={`${PAPER_INPUT} mt-1`}
              >
                <option value="">effort</option>
                {MODEL_ROUTE_EFFORTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <FieldLabel>Allowed model overrides</FieldLabel>
          <input value={allowedModelOverrides} onChange={(event) => setAllowedModelOverrides(event.target.value)} className={PAPER_INPUT} />
        </label>
        <label>
          <FieldLabel>Keywords</FieldLabel>
          <input value={keywords} onChange={(event) => setKeywords(event.target.value)} className={PAPER_INPUT} />
        </label>
        <label>
          <FieldLabel>Allowed tools</FieldLabel>
          <input value={allowedTools} onChange={(event) => setAllowedTools(event.target.value)} className={PAPER_INPUT} />
        </label>
        <label>
          <FieldLabel>Allowed skills</FieldLabel>
          <input value={allowedSkills} onChange={(event) => setAllowedSkills(event.target.value)} className={PAPER_INPUT} />
        </label>
        <label className="md:col-span-2">
          <FieldLabel>Allowed connectors</FieldLabel>
          <input value={allowedConnectors} onChange={(event) => setAllowedConnectors(event.target.value)} className={PAPER_INPUT} />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-[12.5px] font-medium text-paper-char">Schedules (notes, or a Hermes automation id)</legend>
        <ul className="space-y-2">
          {schedules.map((row, index) => (
            <li key={row.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                value={row.label}
                onChange={(event) => setSchedules((current) => current.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)))}
                className={PAPER_INPUT}
                placeholder="Label"
              />
              <input
                value={row.cadence}
                onChange={(event) => setSchedules((current) => current.map((entry, i) => (i === index ? { ...entry, cadence: event.target.value } : entry)))}
                className={PAPER_INPUT}
                placeholder="weekdays, morning"
              />
              <input
                value={row.automationId ?? ""}
                onChange={(event) =>
                  setSchedules((current) =>
                    current.map((entry, i) => (i === index ? { ...entry, automationId: event.target.value || undefined } : entry)),
                  )
                }
                className={PAPER_INPUT}
                placeholder="automation id"
              />
              <PaperButton
                type="button"
                variant="ghost"
                onClick={() => setSchedules((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </PaperButton>
            </li>
          ))}
        </ul>
        <PaperButton
          type="button"
          variant="ghost"
          className="mt-2"
          onClick={() =>
            setSchedules((current) => [...current, { id: `sched-${current.length + 1}`, label: "", cadence: "" }])
          }
        >
          Add schedule
        </PaperButton>
      </fieldset>

      {error ? <p className="text-[13px] text-paper-flame">{error}</p> : null}

      <PaperButton type="submit" variant="amber" disabled={pending}>
        {pending ? "Saving…" : "Save agent"}
      </PaperButton>
    </form>
  );
}
