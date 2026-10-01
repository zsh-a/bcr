import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { IconButton } from "./ui";

interface WorkspaceNavigation {
  expanded: boolean;
  controls: string;
  reveal: (source?: HTMLButtonElement, focus?: boolean) => void;
  preview: (source: HTMLButtonElement) => void;
  cancelPreview: () => void;
}

const WorkspaceContext = createContext<WorkspaceNavigation | null>(null);
export const WorkspaceNavigationProvider = WorkspaceContext.Provider;

/** Hosts supply navigation; standalone apps keep their own chrome. */
export function WorkspaceTrigger({ className = "" }: { className?: string }) {
  const navigation = useContext(WorkspaceContext);
  if (!navigation) return null;
  return (
    <IconButton
      label="展开工作区导航"
      title="工作区导航 · Alt+`"
      className={`ui-workspace-trigger ${className}`}
      data-workspace-trigger=""
      aria-controls={navigation.controls}
      aria-expanded={navigation.expanded}
      aria-keyshortcuts="Alt+`"
      onClick={(event) => navigation.reveal(event.currentTarget, true)}
      onPointerMove={(event) => {
        if (
          event.pointerType === "mouse" &&
          matchMedia("(hover: hover) and (pointer: fine)").matches
        )
          navigation.preview(event.currentTarget);
      }}
      onPointerLeave={navigation.cancelPreview}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    </IconButton>
  );
}

/** Native top-layer menu: anchored to its button with browser dismissal and focus recovery. */
export function ActionMenu({
  label,
  children,
  className = "",
  icon,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const id = useId();
  const anchor = `--app-menu-${id.replaceAll(/[^a-zA-Z0-9]/g, "")}`;
  const [open, setOpen] = useState(false);
  return (
    <span className={`ui-action-menu ${className}`}>
      <IconButton
        label={label}
        title={label}
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ anchorName: anchor }}
      >
        {icon ?? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        )}
      </IconButton>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="ui-popover ui-action-menu-panel"
        style={{ positionAnchor: anchor }}
        onToggle={(event) => {
          if (event.target === event.currentTarget) setOpen(event.newState === "open");
        }}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button"))
            event.currentTarget.hidePopover();
        }}
      >
        {children}
      </div>
    </span>
  );
}
