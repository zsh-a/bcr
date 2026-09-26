import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@bcr/react";
import { MoreHorizontal } from "lucide-react";

export interface NoteAction {
  label: string;
  icon: ReactNode;
  run(): void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

/** 笔记操作只有一个入口；原生浮层负责点击外部关闭与 Esc 焦点返回。 */
export function NoteActionsMenu({ actions }: { actions: NoteAction[] }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const place = () => {
      if (!element.matches(":popover-open")) return;
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const gap = parseFloat(getComputedStyle(element).getPropertyValue("--space-2"));
      element.style.top = `${anchor.bottom + gap}px`;
      element.style.left = `${Math.max(gap, Math.min(anchor.right - element.offsetWidth, innerWidth - element.offsetWidth - gap))}px`;
      element.style.maxHeight = `${Math.max(0, innerHeight - anchor.bottom - gap * 2)}px`;
    };
    const toggle = () => {
      const shown = element.matches(":popover-open");
      setOpen(shown);
      if (shown) {
        place();
      }
    };
    element.addEventListener("toggle", toggle);
    window.addEventListener("resize", place);
    return () => {
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", place);
    };
  }, []);
  return (
    <>
      <IconButton
        ref={trigger}
        label="更多操作"
        size="sm"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          const element = menu.current;
          if (!element) return;
          element.togglePopover();
          if (element.matches(":popover-open"))
            element
              .querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus({ preventScroll: true });
        }}
      >
        <MoreHorizontal size={18} />
      </IconButton>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="ui-popover knowledge-overflow-menu"
        role="menu"
        aria-label="更多操作"
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            menu.current?.hidePopover();
            trigger.current?.focus();
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          ];
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={action.disabled}
            className={
              `${action.danger ? "is-danger" : ""} ${action.separator ? "has-separator" : ""}`.trim() ||
              undefined
            }
            onClick={() => {
              menu.current?.hidePopover();
              trigger.current?.focus();
              action.run();
            }}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
