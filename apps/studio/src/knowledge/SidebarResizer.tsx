import { useRef, type RefObject } from "react";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from "./workbench";

/** 键盘调节步长（px），按住 Shift 时四倍。 */
const KEY_STEP = 24;

/**
 * 侧栏右缘的宽度手柄：拖拽过程直接写侧栏的 --w-sidebar-override（不触发 React
 * 重渲染，也不写持久化），松手才提交；双击回到流体默认。键盘按方向键步进。
 */
export function SidebarResizer({
  sidebar,
  width,
  onCommit,
}: {
  sidebar: RefObject<HTMLElement | null>;
  width: number | null;
  onCommit: (width: number | null) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  // 容器的一半是宽度上限：正文至少保住一半写作面，窗口再窄也不让侧栏吃掉它。
  const bounded = (value: number): number => {
    const container = sidebar.current?.parentElement?.clientWidth ?? window.innerWidth;
    return clampSidebarWidth(
      Math.min(value, Math.max(SIDEBAR_MIN_WIDTH, Math.floor(container / 2))),
    );
  };
  const apply = (value: number) => {
    sidebar.current?.style.setProperty("--w-sidebar-override", `${value}px`);
    handle.current?.setAttribute("aria-valuenow", String(value));
  };
  const endDrag = () => {
    sidebar.current?.removeAttribute("data-resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    drag.current = null;
  };
  return (
    <div
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      className="knowledge-sidebar-resize"
      onPointerDown={(event) => {
        const element = sidebar.current;
        if (event.button !== 0 || !element) return;
        // 不 preventDefault：拖拽期的选择副作用由下面的 body user-select 兜住，
        // 这里保留点击聚焦等默认行为。
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width: element.getBoundingClientRect().width,
          moved: false,
        };
        element.setAttribute("data-resizing", "");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.moved = true;
        apply(bounded(start.width + event.clientX - start.x));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        endDrag();
        // 只点没拖不提交：否则碰一下手柄就会把流体默认钉死成固定宽度。
        if (!start.moved) return;
        onCommit(bounded(start.width + event.clientX - start.x));
      }}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        sidebar.current?.style.removeProperty("--w-sidebar-override");
        onCommit(null);
      }}
      onKeyDown={(event) => {
        const element = sidebar.current;
        if (!element || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        const step = (event.shiftKey ? 4 : 1) * KEY_STEP * (event.key === "ArrowRight" ? 1 : -1);
        const width = bounded(element.getBoundingClientRect().width + step);
        apply(width);
        onCommit(width);
      }}
    />
  );
}
