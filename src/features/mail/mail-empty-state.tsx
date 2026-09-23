interface MailEmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface MailEmptyStateProps {
  title: string;
  description: string;
  action?: MailEmptyStateAction;
}

/**
 * Mail's own empty state, styled with `mail.css` rather than the shared
 * `EmptyState` — that component carries the existing AgentOS design tokens,
 * which would look inconsistent inside this screen's warm paper surface.
 */
export function MailEmptyState({ title, description, action }: MailEmptyStateProps) {
  return (
    <div className="mail-empty">
      <p className="mail-empty-title">{title}</p>
      <p className="mail-empty-description">{description}</p>
      {action ? (
        action.href ? (
          <a className="mail-btn-amber" href={action.href}>
            {action.label}
          </a>
        ) : (
          <button type="button" className="mail-btn-amber" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
