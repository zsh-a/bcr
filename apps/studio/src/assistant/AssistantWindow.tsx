import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AgentChatPanel } from "@bcr/react";
import Markdown from "react-markdown";
import { GripHorizontal, Maximize2, Minimize2, Minus, RotateCcw, Sparkles, X } from "lucide-react";
import {
  defaultWindow,
  fitWindow,
  validGeometry,
  type ViewportSize,
  type WindowGeometry,
} from "./windowGeometry";
import "./window.css";

export type AssistantVisibility = "closed" | "open" | "minimized";
const STORAGE_KEY = "bcr.assistant.window.v1";
const viewportSize = (): ViewportSize => ({ width: window.innerWidth, height: window.innerHeight });

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown">
      <Markdown
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function loadGeometry(): WindowGeometry {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (validGeometry(value)) return fitWindow(value, viewportSize());
  } catch {
    /* Window placement is optional. */
  }
  return defaultWindow(viewportSize());
}

export function AssistantWindow({
  visibility,
  onVisibilityChange,
  workspaceId,
  workspaceLabel,
}: {
  visibility: AssistantVisibility;
  onVisibilityChange: (value: AssistantVisibility) => void;
  workspaceId: string;
  workspaceLabel: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState(viewportSize);
  const [geometry, setGeometry] = useState(loadGeometry);
  const geometryRef = useRef(geometry);
  const [expanded, setExpanded] = useState(false);
  const [moving, setMoving] = useState(false);
  const gesture = useRef<{
    kind: "move" | "resize";
    x: number;
    y: number;
    rect: WindowGeometry;
  } | null>(null);
  const compact = viewport.width < 640;
  const maximized = expanded || compact;
  const visible = visibility === "open";
  const frame = maximized
    ? fitWindow({ x: 12, y: 76, width: viewport.width, height: viewport.height }, viewport)
    : fitWindow(geometry, viewport);

  const place = (rect: WindowGeometry) => {
    const next = fitWindow(rect, viewportSize());
    geometryRef.current = next;
    setGeometry(next);
  };
  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(geometryRef.current));
    } catch {
      /* Keep the live geometry. */
    }
  };

  useEffect(() => {
    const resize = () => {
      setViewport(viewportSize());
      place(geometryRef.current);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!visible) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frameId);
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, [visible]);

  const startGesture = (event: PointerEvent<HTMLButtonElement>, kind: "move" | "resize") => {
    if (maximized || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, rect: geometryRef.current };
    setMoving(true);
  };
  const moveGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    place(
      start.kind === "move"
        ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
        : { ...start.rect, width: start.rect.width + dx, height: start.rect.height + dy },
    );
  };
  const endGesture = () => {
    gesture.current = null;
    setMoving(false);
    persist();
  };
  const keyboardGeometry = (event: KeyboardEvent<HTMLButtonElement>, kind: "move" | "resize") => {
    if (maximized || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
      return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    const rect = geometryRef.current;
    place(
      kind === "move"
        ? { ...rect, x: rect.x + dx, y: rect.y + dy }
        : { ...rect, width: rect.width + dx, height: rect.height + dy },
    );
    persist();
  };

  return (
    <>
      {visibility === "minimized" && (
        <button
          className="assistant-launcher"
          onClick={() => onVisibilityChange("open")}
          aria-label="展开 AI 助手"
        >
          <Sparkles size={16} />
          <span>继续对话</span>
          <kbd>⌘J</kbd>
        </button>
      )}
      <section
        ref={panel}
        className={`assistant-window${maximized ? " is-expanded" : ""}${moving ? " is-moving" : ""}`}
        hidden={!visible}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.stopPropagation();
            onVisibilityChange("minimized");
          }
        }}
      >
        <header className="assistant-window-bar">
          <button
            className="assistant-window-drag"
            aria-label="拖动 AI 助手"
            title="拖动窗口，或用方向键移动"
            onPointerDown={(event) => startGesture(event, "move")}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            onKeyDown={(event) => keyboardGeometry(event, "move")}
            onDoubleClick={() => setExpanded((value) => !value)}
          >
            <Sparkles size={16} />
            <span id={titleId}>AI 助手</span>
            <GripHorizontal size={14} className="assistant-window-grip" />
          </button>
          <nav aria-label="助手窗口操作">
            <button
              aria-label="重置窗口位置"
              title="重置位置和大小"
              onClick={() => {
                setExpanded(false);
                place(defaultWindow(viewportSize()));
                persist();
              }}
            >
              <RotateCcw size={14} />
            </button>
            <button
              aria-label={expanded ? "还原助手窗口" : "展开助手窗口"}
              title={expanded ? "还原窗口" : "展开窗口"}
              disabled={compact}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              aria-label="收起 AI 助手"
              title="收起，保留对话"
              onClick={() => onVisibilityChange("minimized")}
            >
              <Minus size={16} />
            </button>
            <button
              aria-label="关闭 AI 助手"
              title="关闭窗口，保留对话"
              onClick={() => onVisibilityChange("closed")}
            >
              <X size={16} />
            </button>
          </nav>
        </header>
        <div className="assistant-window-content">
          <AgentChatPanel
            workspaceId={workspaceId}
            workspaceLabel={workspaceLabel}
            renderText={AssistantMarkdown}
          />
        </div>
        {!maximized && (
          <button
            className="assistant-window-resize"
            aria-label="调整助手窗口大小"
            title="拖动或用方向键调整大小"
            onPointerDown={(event) => startGesture(event, "resize")}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            onKeyDown={(event) => keyboardGeometry(event, "resize")}
          >
            <span />
          </button>
        )}
      </section>
    </>
  );
}
