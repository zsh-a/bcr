import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/** shadcn 风格的本地组件源码（Rhea 密度：紧凑、hairline、单 accent）。 */

type ButtonVariant = "default" | "primary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-raised text-text border border-border hover:border-border-strong hover:bg-overlay",
  primary: "bg-accent text-[#06251b] border border-accent hover:brightness-110 font-medium",
  ghost: "text-muted border border-transparent hover:text-text hover:bg-raised",
  danger: "text-danger border border-transparent hover:bg-raised hover:border-danger/40",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ variant = "default", className = "", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-[12px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
});

type BadgeTone = "accent" | "amber" | "danger" | "muted" | "info";

const badgeTones: Record<BadgeTone, string> = {
  accent: "text-accent border-accent/30 bg-accent-dim/40",
  amber: "text-amber border-amber/30 bg-amber/10",
  danger: "text-danger border-danger/30 bg-danger/10",
  muted: "text-muted border-border bg-raised",
  info: "text-info border-info/30 bg-info/10",
};

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-[var(--radius-xs)] border px-2 font-mono text-[10px] leading-none ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PanelEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
      <p className="text-[14px] text-muted">{title}</p>
      {hint !== undefined && <p className="max-w-64 text-[12px] leading-5 text-faint">{hint}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-2 font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
      {children}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-accent pulse-dot"
      : status === "queued"
        ? "bg-info pulse-dot"
        : status === "completed"
          ? "bg-accent"
          : status === "failed" || status === "blocked"
            ? "bg-danger"
            : status === "cancelled"
              ? "bg-amber"
              : "bg-faint";
  return <span className={`inline-block size-1.5 rounded-full ${color}`} />;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-raised">
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-150"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
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
