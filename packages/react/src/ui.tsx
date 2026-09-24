import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import "./ui.css";

/**
 * 统一控件原语——全产品唯一的控件套件。
 * 样式在 ui.css，视觉令牌在 tokens.css；圆角/间距/动效禁止字面量。
 */

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ variant = "default", size = "md", className = "", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`.trim()}
      {...props}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: Exclude<ButtonSize, "lg">;
    label: string;
  }
>(function IconButton({ variant = "ghost", size = "md", label, className = "", ...props }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      className={`ui-btn ui-btn-${variant} ui-btn-${size} ui-icon-btn ${className}`.trim()}
      {...props}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`ui-input ${className}`.trim()} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={`ui-textarea ${className}`.trim()} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return <select ref={ref} className={`ui-select ${className}`.trim()} {...props} />;
  },
);

/** 原生 top-layer 对话框：进出场由 ui.css 统一，焦点循环与关闭由浏览器保证。 */
export function Dialog({
  open,
  onClose,
  title,
  placement = "center",
  className = "",
  closeLabel = "关闭",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  placement?: "center" | "sheet";
  className?: string;
  closeLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={`ui-dialog ui-dialog-${placement} ${className}`.trim()}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ui-dialog-frame">
        {title !== undefined && (
          <header className="ui-dialog-head">
            <h2 id={titleId} className="ui-dialog-title">
              {title}
            </h2>
            <IconButton
              label={closeLabel}
              size="sm"
              onClick={onClose}
              className="ui-dialog-close"
              style={{ marginLeft: "auto" }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M2 2l10 10M12 2L2 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          </header>
        )}
        <div className="ui-dialog-body">{children}</div>
      </div>
    </dialog>
  );
}

export type BadgeTone = "muted" | "accent" | "amber" | "danger" | "info" | "success";

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="ui-section-label">{children}</div>;
}

export function PanelEmpty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-panel-empty">
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`ui-dot ui-dot-${status}`} />;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={label}
    >
      <div className="ui-progress-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** 唯一的旋转加载指示；结构占位用 Skeleton。 */
export function Spinner({
  size = "md",
  label = "加载中",
  className = "",
  style,
}: {
  size?: "sm" | "md";
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      style={style}
      className={`ui-spinner ${size === "sm" ? "ui-spinner-sm" : ""} ${className}`.trim()}
    />
  );
}

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`ui-skeleton ${className}`.trim()} style={style} />;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
