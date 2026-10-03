import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export interface TreeMenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

/**
 * 目录树的右键菜单：原生 popover 承担浮出、点外关闭与 Esc；
 * 菜单键位（↑↓ 循环、Home/End、Enter 由按钮原生触发）本地处理，关闭即卸载。
 * 位置钉在指针处并夹回视口，超出底部时向上展开。
 */
export function TreeMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: TreeMenuItem[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const trigger = document.activeElement;
    // 先按指针预置落点与生长角（避免首帧居中闪现），下一帧再入顶层：
    // 与 display/overlay 的离散过渡同帧 showPopover 会被 Chromium 误判为关闭。
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 8))}px`;
    element.style.transformOrigin = `${x > window.innerWidth / 2 ? "right" : "left"} ${
      y > window.innerHeight / 2 ? "bottom" : "top"
    }`;
    const frame = requestAnimationFrame(() => {
      element.showPopover();
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
      element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (
        trigger instanceof HTMLElement &&
        trigger.isConnected &&
        (element.contains(document.activeElement) || document.activeElement === document.body)
      )
        trigger.focus({ preventScroll: true });
    };
  }, [x, y]);
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    // manual 浮层没有轻 dismiss：发起右键的那次手势若被当成「外部点击」，
    // 松开就会把刚打开的菜单关掉。收束只认三件事——点到菜单外、Esc、点菜单项。
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) onClose();
    };
    const toggle = () => {
      if (!element.matches(":popover-open")) onClose();
    };
    document.addEventListener("pointerdown", outside);
    element.addEventListener("toggle", toggle);
    return () => {
      document.removeEventListener("pointerdown", outside);
      element.removeEventListener("toggle", toggle);
    };
  }, [onClose]);
  return (
    <div
      ref={menu}
      popover="manual"
      role="menu"
      aria-label="目录树操作"
      className="ui-popover ui-menu knowledge-overflow-menu knowledge-tree-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        const enabled = [
          ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
        ];
        const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          enabled[(index + step + enabled.length) % enabled.length]?.focus();
        } else if (event.key === "Home") {
          event.preventDefault();
          enabled[0]?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          enabled.at(-1)?.focus();
        }
      }}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          role="menuitem"
          className={item.danger ? "is-danger" : undefined}
          disabled={item.disabled}
          onClick={() => {
            menu.current?.hidePopover();
            item.run();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
