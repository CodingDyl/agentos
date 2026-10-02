import { useState } from "react";
import type { Sender, SenderInput } from "@shared/outreach-case";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useOutreachStatus } from "@/lib/agentos/outreach";
import { useDeleteSender, useSaveSender, useSenders } from "@/lib/agentos/outreach-cases";
import { cn } from "@/lib/utils";

/**
 * The companies you send outreach as. Each has the name the email shows as
 * from, a signature with the opt-out line, a line about what it does (for
 * Hermes), and your usual prices, copied into a case when you choose an
 * approach.
 */
export function SenderManager() {
  const senders = useSenders();
  const [editing, setEditing] = useState<string | "new" | undefined>(undefined);
  const list = senders.data ?? [];
  const open = editing ?? (list.length === 0 ? "new" : undefined);

  return (
    <div className="border border-paper-mist bg-paper-cream px-4 py-3">
      <p className="text-[12px] font-semibold tracking-[0.06em] text-paper-char uppercase">Your companies</p>
      {list.length > 0 ? (
        <ul className="mt-2 divide-y divide-paper-mist">
          {list.map((sender) =>
            open === sender.id ? (
              <li key={sender.id} className="py-3">
                <SenderForm sender={sender} onDone={() => setEditing(undefined)} />
              </li>
            ) : (
              <li key={sender.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span>
                  <span className="font-semibold text-paper-moss">{sender.company}</span>
                  <span className="text-paper-sage"> · sends as {sender.fromName}</span>
                </span>
                <button type="button" onClick={() => setEditing(sender.id)} className={cn("cursor-pointer text-paper-blue hover:underline", PAPER_FOCUS)}>
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}
      {open === "new" ? (
        <div className="mt-2">
          <SenderForm onDone={() => setEditing(undefined)} canCancel={list.length > 0} />
        </div>
      ) : (
        <PaperButton variant="ghost" className="mt-2" onClick={() => setEditing("new")}>
          Add a company
        </PaperButton>
      )}
    </div>
  );
}

const EMPTY: SenderInput = { company: "", fromName: "", about: "", website: "", signature: "", defaultMonthly: "", defaultSetup: "", defaultProject: "" };

function SenderForm({ sender, onDone, canCancel = true }: { sender?: Sender; onDone: () => void; canCancel?: boolean }) {
  const status = useOutreachStatus();
  const save = useSaveSender();
  const remove = useDeleteSender();
  // A first company starts from the signature already written for the mailbox.
  const [form, setForm] = useState<SenderInput>(() =>
    sender ? { ...EMPTY, ...sender } : { ...EMPTY, signature: status.data?.signature ?? "" },
  );
  const set = (key: keyof SenderInput) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const ready = form.company.trim() && form.fromName.trim() && form.signature.trim();

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        save.mutate({ input: form, senderId: sender?.id }, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company *" value={form.company} onChange={set("company")} placeholder="e.g. Virtara" />
        <Field label="Shows as from *" value={form.fromName} onChange={set("fromName")} placeholder="e.g. Dylan at Virtara" />
        <Field label="Website" value={form.website} onChange={set("website")} placeholder="virtara.co.za" />
        <Field label="What the company does" value={form.about} onChange={set("about")} placeholder="Websites and booking systems for small businesses" />
      </div>
      <label className="block">
        <FieldLabel>Signature and opt-out line *</FieldLabel>
        <textarea
          rows={3}
          value={form.signature}
          onChange={set("signature")}
          placeholder={'Dylan Petzer, Virtara (virtara.co.za)\nNot for you? Reply "no thanks" and I will not email you again.'}
          className={cn(PAPER_INPUT, "w-full")}
        />
        <span className="mt-0.5 block text-[12.5px] text-paper-sage">Added to the foot of every email from this company. Keep the opt-out line.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Usual monthly price" value={form.defaultMonthly} onChange={set("defaultMonthly")} placeholder="R450 a month" />
        <Field label="Usual set-up fee" value={form.defaultSetup} onChange={set("defaultSetup")} placeholder="None" />
        <Field label="Usual project price" value={form.defaultProject} onChange={set("defaultProject")} placeholder="from R25,000" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PaperButton type="submit" variant="amber" disabled={!ready || save.isPending}>
          {save.isPending ? "Saving…" : sender ? "Save company" : "Add company"}
        </PaperButton>
        {canCancel ? (
          <PaperButton type="button" onClick={onDone}>
            Cancel
          </PaperButton>
        ) : null}
        {sender ? (
          <PaperButton
            type="button"
            variant="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove ${sender.company}? Cases that use it will need another company.`)) remove.mutate(sender.id, { onSuccess: onDone });
            }}
          >
            Remove
          </PaperButton>
        ) : null}
      </div>
      {save.error ?? remove.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {(save.error ?? remove.error)?.message}
        </p>
      ) : null}
    </form>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (event: { target: { value: string } }) => void; placeholder?: string }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input value={value} onChange={onChange} placeholder={placeholder} className={cn(PAPER_INPUT, "w-full")} />
    </label>
  );
}
