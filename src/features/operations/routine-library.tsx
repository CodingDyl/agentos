import { Eye, Plus } from "lucide-react";
import type { Routine, RoutinesResponse } from "@shared/routine-types";
import { PaperButton, Tag } from "@/components/paper";
import { useInstallRoutine, usePreviewRoutine } from "@/lib/agentos/routines";

/**
 * One routine: what it sends and when, a preview of the message as it would
 * read right now, and the one change made from here, installing it as a
 * Hermes job. After that it is an ordinary scheduled task, paused and run
 * from the list above.
 */
function RoutineRow({ routine }: { routine: Routine }) {
  const install = useInstallRoutine();
  const preview = usePreviewRoutine();
  const failure = install.error ?? preview.error;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-paper-moss">{routine.name}</h3>
            <Tag tone={routine.installed ? "green" : "muted"}>{routine.installed ? "Installed" : "Not installed"}</Tag>
          </div>
          <p className="mt-2 max-w-[72ch] text-[13px] leading-5 text-paper-char">{routine.summary}</p>
          <p className="mt-1 text-[13px] leading-5 text-paper-sage">
            {routine.when} · Sends nothing when {routine.quietWhen}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex gap-1.5">
            <PaperButton variant="quiet" disabled={preview.isPending} onClick={() => preview.mutate(routine.id)}>
              <Eye className="size-3.5" aria-hidden="true" />
              {preview.isPending ? "Reading…" : "Preview"}
            </PaperButton>
            {!routine.installed ? (
              <PaperButton variant="ghost" disabled={install.isPending} onClick={() => install.mutate(routine.id)}>
                <Plus className="size-3.5" aria-hidden="true" />
                {install.isPending ? "Installing…" : "Install"}
              </PaperButton>
            ) : null}
          </div>
          {failure ? (
            <p className="max-w-[34ch] text-[13px] text-paper-flame-deep sm:text-right" role="alert">
              {failure instanceof Error ? failure.message : "Hermes did not accept that."}
            </p>
          ) : null}
        </div>
      </div>

      {preview.isSuccess ? (
        <div className="mt-3 max-w-[72ch]" role="status" aria-live="polite">
          {preview.data ? (
            <>
              <p className="text-[13px] text-paper-sage">It would send this now</p>
              <p className="mt-1.5 rounded-md border border-paper-mist bg-paper-linen px-4 py-3 text-[13px] leading-5 break-words whitespace-pre-wrap text-paper-moss">
                {preview.data}
              </p>
            </>
          ) : (
            <p className="text-[13px] leading-5 text-paper-char">It would send nothing now: {routine.quietWhen}.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The routines AgentOS can install into Hermes, with whether a message can
 * reach the phone at all said once above the list.
 */
export function RoutineLibrary({ data }: { data: RoutinesResponse }) {
  const { phone } = data;

  return (
    <>
      <p className="mt-2 max-w-[100ch] text-[13px] leading-6 text-paper-char">
        <Tag tone={phone.connected ? "green" : "flame"} className="mr-2">
          {phone.connected ? "Telegram connected" : "Telegram not connected"}
        </Tag>
        {phone.connected ? (
          "AgentOS writes each message and Hermes sends it to your phone. No model reads it, so a run costs nothing."
        ) : (
          <>
            Routines cannot reach your phone yet. {phone.detail} Set it up with{" "}
            <code className="font-mono text-[12px]">hermes gateway setup</code>.
          </>
        )}
      </p>
      <ul className="mt-3 divide-y divide-paper-mist rounded-md border border-paper-mist">
        {data.routines.map((routine) => (
          <RoutineRow key={routine.id} routine={routine} />
        ))}
      </ul>
    </>
  );
}
