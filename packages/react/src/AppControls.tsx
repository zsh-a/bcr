import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./ui";

interface WorkspaceNavigation {
  expanded: boolean;
  controls: string;
  reveal: (source?: HTMLButtonElement, focus?: boolean) => void;
  preview: (source: HTMLButtonElement) => void;
  cancelPreview: () => void;
  openAssistant?: () => void;
}

const WorkspaceContext = createContext<WorkspaceNavigation | null>(null);
export const WorkspaceNavigationProvider = WorkspaceContext.Provider;

/** Domain actions open the host's shared assistant without changing the workspace route. */
export function useOpenAssistant() {
  return useContext(WorkspaceContext)?.openAssistant;
}

/** App chrome shares one height, navigation entry and responsive control contract. */
export function AppToolbar({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <header className={`ui-app-toolbar ${className}`}>
      <WorkspaceTrigger />
      {children}
    </header>
  );
}

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
  variant = "panel",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  variant?: "panel" | "menu";
}) {
  const id = useId();
  const anchor = `--app-menu-${id.replaceAll(/[^a-zA-Z0-9]/g, "")}`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = variant === "menu";
  const controls = () =>
    [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ].filter((element) => element.checkVisibility());
  const close = () => {
    if (menuRef.current?.matches(":popover-open")) menuRef.current.hidePopover();
    triggerRef.current?.focus({ preventScroll: true });
  };
  return (
    <span className={`ui-action-menu ${className}`}>
      <IconButton
        ref={triggerRef}
        label={label}
        title={label}
        popoverTarget={id}
        aria-haspopup={menu ? "menu" : "dialog"}
        aria-expanded={open}
        style={{ anchorName: anchor }}
        onKeyDown={(event) => {
          if (!menu || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (!menuRef.current?.matches(":popover-open")) menuRef.current?.showPopover();
          const items = controls();
          (event.key === "ArrowUp" ? items.at(-1) : items[0])?.focus({ preventScroll: true });
        }}
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
        ref={menuRef}
        id={id}
        popover="auto"
        role={menu ? "menu" : "dialog"}
        aria-label={label}
        className={`ui-popover ui-action-menu-panel ${menu ? "ui-menu ui-action-menu-commands" : ""}`}
        style={{ positionAnchor: anchor }}
        onToggle={(event) => {
          if (event.target !== event.currentTarget) return;
          setOpen(event.newState === "open");
          if (
            menu &&
            event.newState === "open" &&
            !event.currentTarget.contains(document.activeElement)
          )
            controls()[0]?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (!menu) return;
          event.stopPropagation();
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            close();
            return;
          }
          const items = controls();
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "ArrowDown"
              ? (index + 1) % items.length
              : event.key === "ArrowUp"
                ? (index - 1 + items.length) % items.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : null;
          if (next !== null) {
            event.preventDefault();
            items[next]?.focus({ preventScroll: true });
          }
        }}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) {
            if (menu) close();
            else event.currentTarget.hidePopover();
          }
        }}
      >
        {children}
      </div>
    </span>
  );
}
