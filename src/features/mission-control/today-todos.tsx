import { Check, X } from "lucide-react";
import { useState } from "react";
import { TODO_TEXT_MAX, type FocusToday } from "@shared/focus-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useAddTodo, useRemoveTodo, useUpdateTodo } from "@/lib/agentos/focus";
import { cn } from "@/lib/utils";

const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * Today's to-do list, under your three. What you wrote in "Anything on your
 * mind?" lands here, and you add the rest. Unfinished ones carry over to
 * tomorrow, so nothing written down is quietly lost.
 */
export function TodayTodos({ today, className }: { today: FocusToday; className?: string }) {
  const add = useAddTodo();
  const update = useUpdateTodo();
  const remove = useRemoveTodo();
  const [text, setText] = useState("");
  const { todos } = today.day;
  const finished = todos.filter((todo) => todo.done).length;
  // Open first, in the order they were added; done ones sink to the bottom.
  const ordered = [...todos.filter((todo) => !todo.done), ...todos.filter((todo) => todo.done)];
  const error = add.error ?? update.error ?? remove.error;

  return (
    <PaperSection
      label="To do today"
      className={className}
      action={
        todos.length > 0 ? (
          <span className="text-[13px] leading-5 text-paper-sage tabular-nums" aria-live="polite">
            {finished} of {todos.length} done
          </span>
        ) : undefined
      }
    >
      {todos.length === 0 ? (
        <p className="text-[14px] leading-[22px] text-paper-char">Nothing on the list yet.</p>
      ) : (
        <ul className="divide-y divide-paper-mist">
          {ordered.map((todo) => (
            <li key={todo.id} className="flex items-start gap-3 py-2 first:pt-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={todo.done}
                aria-label={`${todo.done ? "Not done" : "Done"}: ${todo.text}`}
                disabled={update.isPending}
                onClick={() => update.mutate({ id: todo.id, done: !todo.done })}
                className={cn(
                  "mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors duration-150 disabled:cursor-not-allowed",
                  todo.done ? "border-paper-green bg-paper-green text-[var(--on-accent)]" : "border-paper-ash hover:bg-paper-linen",
                  PAPER_FOCUS,
                )}
              >
                {todo.done ? <Check className="size-3.5" aria-hidden="true" /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-[14px] leading-[22px] break-words", todo.done ? "text-paper-sage line-through" : "text-paper-moss")}>{todo.text}</p>
                {todo.from === "mind" || todo.carriedFrom ? (
                  <p className="flex flex-wrap gap-2 text-[13px] text-paper-sage">
                    {todo.from === "mind" ? <Tag>On your mind</Tag> : null}
                    {todo.carriedFrom ? <span>From {shortDay(todo.carriedFrom)}</span> : null}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Remove: ${todo.text}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(todo.id)}
                className={cn("-my-1 -mr-2 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss disabled:cursor-not-allowed", PAPER_FOCUS)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim();
          if (value) add.mutate(value, { onSuccess: () => setText("") });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setText("");
        }}
      >
        <label className="min-w-0 flex-1 basis-60">
          <span className="mb-1.5 block text-[13px] leading-5 text-paper-char">Add to today's list</span>
          <input value={text} maxLength={TODO_TEXT_MAX} onChange={(event) => setText(event.target.value)} placeholder="One thing, then Enter" className={cn(PAPER_INPUT, "w-full")} />
        </label>
        <PaperButton type="submit" variant="ghost" disabled={!text.trim() || add.isPending}>
          Add
        </PaperButton>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-5 text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}
