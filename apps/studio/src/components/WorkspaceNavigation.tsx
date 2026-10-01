import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceNavigationProvider } from "@bcr/react";
import { TopBar } from "./TopBar";

/** Global navigation overlays app content; opening it never changes the app's viewport. */
export function WorkspaceNavigation(props: Parameters<typeof TopBar>[0] & { children: ReactNode }) {
  const floating = props.active !== "home";
  const [open, setOpen] = useState(false);
  const id = useId();
  const surface = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | undefined>(undefined);
  const availableTrigger = () =>
    [...document.querySelectorAll<HTMLButtonElement>("[data-workspace-trigger]")].find(
      (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible",
    );
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = !floating || open;

  const clearTimers = () => {
    clearTimeout(revealTimer.current);
    clearTimeout(hideTimer.current);
  };
  const protectedSurface = () =>
    !!document.querySelector("dialog[open]") ||
    !!surface.current?.querySelector(":popover-open") ||
    !!surface.current?.contains(document.activeElement);
  const close = (restoreFocus = false) => {
    clearTimers();
    surface.current
      ?.querySelectorAll<HTMLElement>(":popover-open")
      .forEach((el) => el.hidePopover());
    setOpen(false);
    if (restoreFocus)
      requestAnimationFrame(() =>
        (trigger.current ?? availableTrigger())?.focus({ preventScroll: true }),
      );
  };
  const reveal = (source?: HTMLButtonElement, focus = false) => {
    trigger.current = source ?? availableTrigger();
    clearTimers();
    if (document.querySelector("dialog[open]")) return;
    setOpen(true);
    if (focus)
      requestAnimationFrame(() =>
        surface.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }),
      );
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!protectedSurface() && !surface.current?.matches(":hover")) close();
    }, 600);
  };

  useLayoutEffect(() => {
    close();
  }, [props.active]);
  const latest = useRef({ close, reveal, scheduleHide, open, floating });
  latest.current = { close, reveal, scheduleHide, open, floating };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const state = latest.current;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !state.floating ||
        document.querySelector("dialog[open]")
      )
        return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "Backquote") {
        event.preventDefault();
        if (state.open) state.close(true);
        else state.reveal(undefined, true);
      } else if (
        event.key === "Escape" &&
        state.open &&
        !surface.current?.querySelector(":popover-open")
      ) {
        event.preventDefault();
        state.close(true);
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        latest.current.open &&
        event.target instanceof Node &&
        !surface.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      ) {
        // Native popovers dismiss after pointerdown; check their state after focus settles.
        latest.current.scheduleHide();
      }
    };
    const toggle = () => {
      if (latest.current.open) latest.current.scheduleHide();
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("toggle", toggle, true);
    return () => {
      clearTimers();
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("toggle", toggle, true);
    };
  }, []);

  return (
    <WorkspaceNavigationProvider
      value={{
        expanded: open,
        controls: id,
        reveal,
        preview: (source) => {
          clearTimeout(revealTimer.current);
          revealTimer.current = setTimeout(() => reveal(source), 220);
        },
        cancelPreview: () => clearTimeout(revealTimer.current),
        openAssistant: props.onOpenAgent,
      }}
    >
      <div className="studio-shell-frame flex h-full flex-col" data-app={props.active}>
        <div className="studio-navigation" data-floating={floating} data-open={visible}>
          <div
            ref={surface}
            id={id}
            className="studio-navigation-surface"
            hidden={!visible}
            onPointerEnter={() => clearTimeout(hideTimer.current)}
            onPointerLeave={scheduleHide}
            onFocusCapture={() => clearTimeout(hideTimer.current)}
            onBlurCapture={scheduleHide}
          >
            <TopBar {...props} onCollapse={floating ? () => close(true) : undefined} />
          </div>
        </div>
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
    </WorkspaceNavigationProvider>
  );
}
