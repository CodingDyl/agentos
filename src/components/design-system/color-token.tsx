import { cn } from "@/lib/utils";

export interface ColorTokenProps {
  name: string;
  value: string;
  className: string;
}

export function ColorToken({ name, value, className }: ColorTokenProps) {
  return (
    <div className="group min-w-0">
      <div
        className={cn(
          "h-20 rounded-none border border-os-border transition-colors duration-150 group-hover:border-os-border-strong",
          className,
        )}
        aria-hidden="true"
      />
      <p className="mt-3 truncate text-[13px] text-foreground">{name}</p>
      <p className="mt-1 font-mono text-[12px] tracking-[0.04em] text-os-subtle uppercase">
        {value}
      </p>
    </div>
  );
}
