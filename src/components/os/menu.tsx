import { Menu as BaseMenu } from "@base-ui/react/menu";
import { createContext, useContext, useRef, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Queues what an item does until the menu has closed. See ActionMenu. */
const MenuItemContext = createContext<(run: () => void) => void>((run) => run());

/**
 * The one dropdown menu: page overflow, row actions, the Capture menu.
 *
 * Arrow keys, typeahead, Escape and outside-click come from Base UI. The
 * trigger is the caller's own control, so a menu never changes how a screen's
 * buttons look.
 *
 * An item runs only once the menu has closed and focus is back on the trigger.
 * A dialog it opens then records the trigger as where to return, and can take
 * focus without the closing menu pulling it back.
 */
export function ActionMenu({
  trigger,
  children,
  align = "end",
}: {
  /** A single element able to hold a ref: normally a `<button>`. */
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | undefined>(undefined);
  const chosen = useRef(false);

  return (
    <BaseMenu.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) chosen.current = false;
      }}
      onOpenChangeComplete={(open) => {
        if (open || !pending.current) return;
        const run = pending.current;
        pending.current = undefined;
        triggerRef.current?.focus();
        run();
      }}
    >
      <BaseMenu.Trigger ref={triggerRef} render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} sideOffset={4} className="z-[60]">
          <BaseMenu.Popup finalFocus={() => !chosen.current} className="qt-menu">
            <MenuItemContext.Provider
              value={(run) => {
                chosen.current = true;
                pending.current = run;
              }}
            >
              {children}
            </MenuItemContext.Provider>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function ActionMenuItem({
  onSelect,
  disabled,
  hint,
  shortcut,
  className,
  children,
}: {
  onSelect: () => void;
  disabled?: boolean;
  /** One line of supporting text under the label. */
  hint?: string;
  shortcut?: string;
  className?: string;
  children: ReactNode;
}) {
  const queue = useContext(MenuItemContext);

  return (
    <BaseMenu.Item
      disabled={disabled}
      onClick={() => queue(onSelect)}
      className={cn("qt-menu-item", className)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">{children}</span>
        {hint ? <span className="mt-0.5 block text-[13px] leading-5 text-os-muted">{hint}</span> : null}
      </span>
      {shortcut ? <kbd className="os-mono shrink-0 text-os-subtle">{shortcut}</kbd> : null}
    </BaseMenu.Item>
  );
}
