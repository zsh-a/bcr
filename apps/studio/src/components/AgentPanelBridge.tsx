import { Dialog } from "@base-ui/react/dialog";
import { Bot, GripVertical, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AgentChatPanel } from "@bcr/react";

/**
 * The agent chat, as a floating window over whatever workspace is open.
 *
 * Non-modal on purpose: the point is to talk about what is on screen while it
 * stays on screen and editable. A modal dialog would block the very thing being
 * discussed, and `SearchPanel` already establishes the overlay pattern here.
 *
 * It is drag-resizable and remembers its size, so a second session does not
 * start from scratch. Position is intentionally not remembered: a window that
 * reopens off-screen is worse than one that reopens centred.
 */
const SIZE_KEY = "bcr.studio.agent.size.v1";

interface Size {
  readonly width: number;
  readonly height: number;
}

function storedSize(): Size {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (raw === null) return { width: 420, height: 560 };
    const value = JSON.parse(raw) as Partial<Size>;
    if (typeof value.width === "number" && typeof value.height === "number")
      return { width: value.width, height: value.height };
  } catch {
    /* A corrupt entry falls back to the default size. */
  }
  return { width: 420, height: 560 };
}

export function AgentPanelBridge(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [size, setSize] = useState<Size>(storedSize);
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // ⌘J from anywhere in the shell.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "j") {
        event.preventDefault();
        props.onOpenChange(!props.open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onOpenChange]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const start = drag.current;
    if (start === null) return;
    // Anchor the top-left so dragging the bottom-right corner resizes predictably.
    setSize({
      width: Math.max(320, start.width + (start.x - event.clientX)),
      height: Math.max(320, start.height + (event.clientY - start.y)),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    drag.current = { x: event.clientX, y: event.clientY, ...size };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch {
      /* Resize still works for this session; only the memory of it is lost. */
    }
  }, [size]);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
      modal={false}
      // Clicking the document while the assistant is open is normal here: the
      // user is pointing at what they want changed, not dismissing the panel.
      disablePointerDismissal
    >
      <Dialog.Portal>
        <Dialog.Popup
          className="studio-agent-window fixed right-6 bottom-6 z-50 flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border-strong bg-bg shadow-2xl shadow-black/60 outline-none studio-enter"
          style={{ width: size.width, height: size.height }}
          aria-label="AI 助手"
        >
          <header className="flex items-center gap-2 border-b border-border bg-raised px-3 py-2">
            <Bot className="size-4 shrink-0 text-accent" />
            <strong className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">
              AI 助手
            </strong>
            <kbd className="shrink-0 rounded-[var(--radius-xs)] border border-border px-1.5 py-0.5 font-mono text-[9px] text-faint">
              ⌘J
            </kbd>
            <button
              type="button"
              onClick={() => props.onOpenChange(false)}
              aria-label="关闭 AI 助手"
              className="shrink-0 rounded p-1 text-faint transition-colors hover:text-text"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1">
            <AgentChatPanel />
          </div>
          {/* Bottom-left grab handle: the window is anchored bottom-right. */}
          <button
            type="button"
            onPointerDown={startResize}
            aria-label="调整 AI 助手窗口大小"
            className="absolute bottom-0 left-0 flex size-5 cursor-nesw-resize items-center justify-center text-faint opacity-40 hover:opacity-100"
          >
            <GripVertical className="size-3" />
          </button>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
