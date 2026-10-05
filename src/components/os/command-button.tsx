import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CommandButtonVariant =
  | "primary"
  | "secondary"
  | "quiet"
  | "danger";

export interface CommandButtonProps
  extends Omit<ComponentProps<typeof Button>, "variant"> {
  variant?: CommandButtonVariant;
  icon?: LucideIcon;
  iconPosition?: "start" | "end";
  loading?: boolean;
  loadingLabel?: string;
}

const variantClasses: Record<CommandButtonVariant, string> = {
  primary:
    "rounded-md border-primary bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)]",
  secondary:
    "rounded-md border-os-border bg-transparent text-foreground hover:border-os-border-strong hover:bg-os-surface-raised",
  quiet:
    "rounded-md border-transparent bg-transparent text-os-muted hover:bg-os-surface-raised hover:text-foreground",
  danger:
    "rounded-md border-os-danger/40 bg-os-danger/10 text-os-danger hover:border-os-danger/60 hover:bg-os-danger/15",
};

export function CommandButton({
  children,
  className,
  disabled,
  icon: Icon,
  iconPosition = "end",
  loading = false,
  loadingLabel = "Working",
  type = "button",
  variant = "secondary",
  ...props
}: CommandButtonProps) {
  const DisplayIcon = loading ? LoaderCircle : Icon;

  return (
    <Button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      variant="outline"
      className={cn(
        "min-h-10 cursor-pointer gap-2 px-4 font-sans text-[14px] font-medium transition-colors duration-150",
        "focus-visible:border-os-amber focus-visible:ring-os-amber/35",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {DisplayIcon && iconPosition === "start" ? (
        <DisplayIcon
          className={cn("size-3.5", loading && "motion-safe:animate-spin")}
          aria-hidden="true"
        />
      ) : null}
      <span>{loading ? loadingLabel : children}</span>
      {DisplayIcon && iconPosition === "end" ? (
        <DisplayIcon
          className={cn("size-3.5", loading && "motion-safe:animate-spin")}
          aria-hidden="true"
        />
      ) : null}
    </Button>
  );
}
