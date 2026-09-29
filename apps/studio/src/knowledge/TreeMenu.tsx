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
    element.showPopover();
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggle = () => {
      if (!element.matches(":popover-open")) onClose();
    };
    element.addEventListener("toggle", toggle);
    return () => element.removeEventListener("toggle", toggle);
  }, [onClose]);
  return (
    <div
      ref={menu}
      popover="auto"
      role="menu"
      aria-label="目录树操作"
      className="knowledge-overflow-menu knowledge-tree-menu"
      onKeyDown={(event) => {
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
