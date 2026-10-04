import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@bcr/react";
import { ArrowLeft, ChevronRight, Folder, MoreHorizontal, Settings2 } from "lucide-react";

export interface NoteAction {
  label: string;
  icon: ReactNode;
  run(): void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  group?: "笔记库管理" | "应用设置";
  hidden?: boolean;
}

/** 笔记操作只有一个入口；原生浮层负责点击外部关闭与 Esc 焦点返回。 */
export function NoteActionsMenu({
  actions,
  grouped = false,
}: {
  actions: NoteAction[];
  grouped?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<NoteAction["group"]>(undefined);
  const previousGroup = useRef<NoteAction["group"]>(undefined);
  const visible = actions.filter(
    (action) => !action.hidden && (!grouped || action.group === group),
  );
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element?.matches(":popover-open")) return;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const returning = !group && previousGroup.current;
    (
      buttons.find((button) => returning && button.textContent?.trim() === returning) ?? buttons[0]
    )?.focus({ preventScroll: true });
    element.scrollTop = 0;
    previousGroup.current = group;
  }, [group, grouped]);
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const place = () => {
      if (!element.matches(":popover-open")) return;
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const gap = parseFloat(getComputedStyle(element).getPropertyValue("--space-2"));
      const viewport = window.visualViewport;
      const visual = viewport?.scale === 1 ? viewport : null;
      const top = visual?.offsetTop ?? 0;
      const left = visual?.offsetLeft ?? 0;
      const height = visual?.height ?? innerHeight;
      const width = visual?.width ?? innerWidth;
      element.style.maxHeight = `${Math.max(0, height - gap * 2)}px`;
      element.style.top = `${Math.max(top + gap, Math.min(anchor.bottom + gap, top + height - element.offsetHeight - gap))}px`;
      element.style.left = `${Math.max(left + gap, Math.min(anchor.right - element.offsetWidth, left + width - element.offsetWidth - gap))}px`;
    };
    const toggle = () => {
      const shown = element.matches(":popover-open");
      setOpen(shown);
      if (shown) {
        place();
      } else setGroup(undefined);
    };
    element.addEventListener("toggle", toggle);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => {
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      observer.disconnect();
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
        className="ui-popover ui-menu knowledge-overflow-menu"
        role="menu"
        aria-label="更多操作"
        onKeyDown={(event) => {
          if (event.key === "Escape" && grouped && group) {
            event.preventDefault();
            event.stopPropagation();
            setGroup(undefined);
            return;
          }
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
        {grouped && group && (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-label="返回更多操作"
            onClick={() => setGroup(undefined)}
          >
            <ArrowLeft size={16} />
            {group}
          </button>
        )}
        {visible.map((action) => (
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
        {grouped &&
          !group &&
          (["笔记库管理", "应用设置"] as const).map((name) => (
            <button
              type="button"
              role="menuitem"
              key={name}
              tabIndex={-1}
              className="has-separator"
              onClick={() => setGroup(name)}
            >
              {name === "笔记库管理" ? <Folder size={16} /> : <Settings2 size={16} />}
              {name}
              <ChevronRight size={16} className="knowledge-menu-chevron" />
            </button>
          ))}
      </div>
    </>
  );
}
