import type { KeyboardEvent } from "react";
import { MailSendTagSchema, type MailSendTag } from "@shared/mail-compose-types";
import { TAG_LABEL } from "./mail-compose-model";

const TAGS: readonly MailSendTag[] = MailSendTagSchema.options;

interface MailTagPickerProps {
  value: MailSendTag;
  onChange: (tag: MailSendTag) => void;
  labelledBy?: string;
  disabled?: boolean;
}

/** Normal / Business / Virtara as one radio group. Arrow keys move between them. */
export function MailTagPicker({ value, onChange, labelledBy, disabled }: MailTagPickerProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const group = event.currentTarget;
    const next = TAGS[(TAGS.indexOf(value) + step + TAGS.length) % TAGS.length];
    onChange(next);
    requestAnimationFrame(() => {
      group.querySelector<HTMLButtonElement>(`[data-tag="${next}"]`)?.focus();
    });
  };

  return (
    <div className="mail-tag-picker" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          role="radio"
          data-tag={tag}
          aria-checked={value === tag}
          tabIndex={value === tag ? 0 : -1}
          className={`mail-tag-option mail-tag-option--${tag}${value === tag ? " is-active" : ""}`}
          onClick={() => onChange(tag)}
          disabled={disabled}
        >
          {TAG_LABEL[tag]}
        </button>
      ))}
    </div>
  );
}
