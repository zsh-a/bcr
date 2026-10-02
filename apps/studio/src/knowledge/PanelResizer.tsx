import { useRef } from "react";

/** 键盘调节步长（px），按住 Shift 时四倍。 */
const KEY_STEP = 24;

/**
 * 面板宽度手柄：贴在面板的一侧边缘，拖拽过程把宽度覆盖变量直接写到面板的
 * 布局父级（不触发 React 重渲染，也不写持久化），松手才提交；双击回到流体默认。
 * 面板侧的 CSS 链条（如 min(var(--w-sidebar-override, var(--w-sidebar)), 50%)）
 * 从父级继承该变量，React 提交的持久值与拖拽中的即时值因此落在同一元素上。
 */
export function PanelResizer({
  getPanel,
  width,
  min,
  max,
  edge,
  variable,
  label,
  onCommit,
}: {
  /** 被调节宽度的面板元素（只测量用）。 */
  getPanel: () => HTMLElement | null;
  width: number | null;
  min: number;
  max: number;
  /** 手柄贴的边：right 表示拖向右变宽，left 相反。 */
  edge: "left" | "right";
  /** 面板宽度覆盖变量名，如 --w-sidebar-override。 */
  variable: string;
  label: string;
  onCommit: (width: number | null) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  // 容器的一半是宽度上限：正文至少保住一半写作面，窗口再窄也不让面板吃掉它。
  const bounded = (value: number): number => {
    const panel = getPanel();
    const container = panel?.parentElement?.clientWidth ?? window.innerWidth;
    const capped = Math.min(value, Math.max(min, Math.floor(container / 2)));
    return Math.min(max, Math.max(min, Math.round(capped)));
  };
  const apply = (value: number) => {
    getPanel()?.parentElement?.style.setProperty(variable, `${value}px`);
    handle.current?.setAttribute("aria-valuenow", String(value));
  };
  const endDrag = () => {
    getPanel()?.removeAttribute("data-resizing");
    handle.current?.removeAttribute("data-resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    drag.current = null;
  };
  return (
    <div
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      className="knowledge-panel-resize"
      onPointerDown={(event) => {
        const panel = getPanel();
        if (event.button !== 0 || !panel) return;
        // 不 preventDefault：拖拽期的选择副作用由下面的 body user-select 兜住，
        // 这里保留点击聚焦等默认行为。
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width: panel.getBoundingClientRect().width,
          moved: false,
        };
        panel.setAttribute("data-resizing", "");
        event.currentTarget.setAttribute("data-resizing", "");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.moved = true;
        const direction = edge === "right" ? 1 : -1;
        apply(bounded(start.width + direction * (event.clientX - start.x)));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        endDrag();
        // 只点没拖不提交：否则碰一下手柄就会把流体默认钉死成固定宽度。
        if (!start.moved) return;
        const direction = edge === "right" ? 1 : -1;
        onCommit(bounded(start.width + direction * (event.clientX - start.x)));
      }}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        getPanel()?.parentElement?.style.removeProperty(variable);
        onCommit(null);
      }}
      onKeyDown={(event) => {
        const panel = getPanel();
        if (!panel || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        const step =
          (event.shiftKey ? 4 : 1) *
          KEY_STEP *
          (event.key === "ArrowRight" ? 1 : -1) *
          (edge === "right" ? 1 : -1);
        // Repeated keys build on the committed width while the CSS transition is in flight.
        const nextWidth = bounded((width ?? panel.getBoundingClientRect().width) + step);
        apply(nextWidth);
        onCommit(nextWidth);
      }}
    />
  );
}
