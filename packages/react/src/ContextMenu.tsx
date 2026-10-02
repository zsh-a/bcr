import { Fragment, useLayoutEffect, useRef, type ReactNode } from "react";
import { contextMenuPosition } from "./contextMenuPosition";

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separated?: boolean;
  /** Navigate within this surface without dismissing it. */
  submenu?: boolean;
  keepOpen?: boolean;
  run: () => void;
}

/** One native top-layer surface for pointer, keyboard and touch context actions. */
export function ContextMenu(props: {
  label: string;
  title?: string;
  x: number;
  y: number;
  trigger: HTMLElement;
  actions: ReadonlyArray<ContextMenuAction>;
  page?: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = (restoreFocus: boolean) => {
    const menu = ref.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    if (restoreFocus && props.trigger.isConnected) props.trigger.focus({ preventScroll: true });
    closeRef.current();
  };

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    menu.showPopover();
    const position = contextMenuPosition(
      { x: props.x, y: props.y },
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    Object.assign(menu.style, {
      left: `${position.left}px`,
      top: `${position.top}px`,
      maxWidth: `${position.maxWidth}px`,
      maxHeight: `${position.maxHeight}px`,
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const dismiss = () => {
      if (menu.matches(":popover-open")) menu.hidePopover();
      closeRef.current();
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.contains(event.target)) dismiss();
    };
    // Touch release may focus the original row again; Escape still closes the
    // topmost context menu before the parent library dialog or app shortcuts.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.matches(":popover-open")) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      if (menu.matches(":popover-open")) menu.hidePopover();
    };
  }, [props.x, props.y, props.trigger, props.page]);

  return (
    <div
      ref={ref}
      popover="manual"
      role="menu"
      aria-label={props.label}
      className="ui-popover ui-menu ui-context-menu"
      style={{ left: props.x, top: props.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          close(true);
          return;
        }
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowLeft" && props.onBack) {
          event.preventDefault();
          props.onBack();
          return;
        }
        if (event.key === "ArrowRight") {
          const action = props.actions.find((item) => item.id === buttons[index]?.dataset.action);
          if (action?.submenu) {
            event.preventDefault();
            action.run();
          }
          return;
        }
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % buttons.length
            : event.key === "ArrowUp"
              ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : null;
        if (next !== null) {
          event.preventDefault();
          buttons[next]?.focus({ preventScroll: true });
        }
      }}
    >
      {props.title && (
        <div className="ui-context-menu-title" title={props.title}>
          {props.title}
        </div>
      )}
      {props.actions.map((action) => (
        <Fragment key={action.id}>
          {action.separated && <div role="separator" className="ui-menu-separator" />}
          <button
            type="button"
            role="menuitem"
            data-action={action.id}
            aria-haspopup={action.submenu ? "menu" : undefined}
            disabled={action.disabled}
            className={action.danger ? "is-danger" : undefined}
            onClick={() => {
              if (!action.submenu && !action.keepOpen) close(true);
              action.run();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
            {action.shortcut && <kbd aria-hidden="true">{action.shortcut}</kbd>}
            {action.submenu && (
              <span className="ui-context-menu-arrow" aria-hidden="true">
                ›
              </span>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
