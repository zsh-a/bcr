import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { studio, useStudio, type LogLevel } from "../store";
import { formatTime, PanelEmpty } from "./ui";

const levelColor: Record<LogLevel, string> = {
  info: "text-info",
  ok: "text-accent",
  warn: "text-amber",
  error: "text-danger",
};

/** Runtime 控制台：日志流虚拟化 + 自动吸底。 */
export function ConsolePanel() {
  const logs = useStudio((s) => s.logs);
  const parentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  useEffect(() => {
    if (stickToBottom.current && logs.length > 0) {
      virtualizer.scrollToIndex(logs.length - 1, { align: "end" });
    }
  }, [logs.length, virtualizer]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
          runtime log · {logs.length}
        </span>
        <button
          type="button"
          onClick={() => studio.clearLogs()}
          className="inline-flex h-5 items-center gap-1 rounded-[var(--radius-xs)] px-1.5 text-[11px] text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <Trash2 className="size-3" />
          清空
        </button>
      </div>

      {logs.length === 0 ? (
        <PanelEmpty title="无日志" />
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const log = logs[row.index];
              if (log === undefined) return null;
              return (
                <div
                  key={row.index}
                  style={{
                    top: row.start,
                    height: row.size,
                    position: "absolute",
                    left: 0,
                    width: "100%",
                  }}
                  className="flex items-baseline gap-2 px-2 font-mono text-[11px]"
                >
                  <span className="shrink-0 text-faint">{formatTime(log.ts)}</span>
                  <span
                    className={`shrink-0 uppercase ${levelColor[log.level]}`}
                    style={{ width: 40 }}
                  >
                    {log.level}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted">{log.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
