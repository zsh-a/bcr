import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./ui";

export type NoticeTone = "success" | "info" | "warning" | "error";
export interface Notice {
  readonly message: string;
  readonly tone: NoticeTone;
}

/** Success and informational feedback expires; actionable failures stay until dismissed. */
export function Toast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  return notice ? <ToastNotice key={notice.message} notice={notice} onDismiss={onDismiss} /> : null;
}

function ToastNotice({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (paused || notice.tone === "error" || notice.tone === "warning") return;
    const timer = window.setTimeout(() => dismissRef.current(), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, paused, dismissRef]);
  return (
    <div
      className="ui-toast"
      data-tone={notice.tone}
      role={notice.tone === "error" ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <span className="ui-toast-symbol" aria-hidden="true">
        {notice.tone === "success" ? "✓" : notice.tone === "info" ? "i" : "!"}
      </span>
      <span className="ui-toast-message">{notice.message}</span>
      <IconButton label="关闭提示" className="ui-toast-close" onClick={onDismiss}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="m4 4 8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </IconButton>
    </div>
  );
}

/** A single next action and a short explanation, shared across workspace empty states. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-empty-state ${className}`}>
      {icon && (
        <span className="ui-empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
