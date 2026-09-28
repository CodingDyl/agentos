import { pageWindow } from "./mail-model";

interface MailPagerProps {
  page: number;
  pageCount: number;
  firstIndex: number;
  lastIndex: number;
  total: number;
  onChange: (page: number) => void;
}

/** "26–50 of 150", with Previous / numbered pages / Next. Hidden entirely when everything fits on one page. */
export function MailPager({ page, pageCount, firstIndex, lastIndex, total, onChange }: MailPagerProps) {
  if (pageCount <= 1) return null;

  return (
    <nav className="mail-pager" aria-label="Inbox pages">
      <span className="mail-pager-range">
        {firstIndex}–{lastIndex} of {total}
      </span>
      <div className="mail-pager-controls">
        <button
          type="button"
          className="mail-pager-btn"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        {pageWindow(page, pageCount).map((value, index) =>
          value === null ? (
            <span key={`gap-${index}`} className="mail-pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={value}
              type="button"
              className={`mail-pager-btn mail-pager-num${value === page ? " mail-pager-num--active" : ""}`}
              aria-current={value === page ? "page" : undefined}
              aria-label={`Page ${value}`}
              onClick={() => onChange(value)}
            >
              {value}
            </button>
          ),
        )}
        <button
          type="button"
          className="mail-pager-btn"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
