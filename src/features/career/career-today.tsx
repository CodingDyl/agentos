import { Link } from "react-router-dom";
import { PaperSection } from "@/components/paper";
import { useCareer } from "@/lib/agentos/career";

/**
 * Career on Today: only what is due — a routine whose day has come, a career
 * task due today or overdue. Nothing due, nothing shown: employment admin
 * should not take space on a day it doesn't need any.
 */
export function CareerToday({ className }: { className?: string }) {
  const { data } = useCareer();
  if (!data || data.todayItems.length === 0) return null;

  return (
    <PaperSection
      id="career"
      label="Career"
      count={data.todayItems.length}
      className={className}
      action={
        <Link
          to="/career"
          className="text-[12.5px] -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-paper-sage transition-colors duration-150 hover:text-paper-moss"
        >
          Open Career →
        </Link>
      }
    >
      <ul className="space-y-2.5">
        {data.todayItems.map((item) => (
          <li key={item.id} className="flex min-w-0 items-baseline gap-3">
            <span className="size-1.5 shrink-0 translate-y-[-0.15em] rounded-full border border-paper-amber-deep" aria-hidden="true" />
            <Link to={item.href} className="min-w-0 rounded-sm text-[16px] leading-7 text-paper-char transition-colors duration-150 hover:text-paper-moss">
              {item.title}
              {item.detail ? <span className="text-[12.5px] ml-2 text-paper-sage">{item.detail}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}
