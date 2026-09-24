import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Native top-layer modality: inert background, focus containment and restoration.
 * 常驻 dialog 由 open 驱动——进入/退出都走 @starting-style + allow-discrete 动效;
 * 退出期间保留最后一帧内容,动效结束后再卸载。
 */
export function ReaderSheet(props: {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
  labelId: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const frozenRef = useRef<ReactNode>(null);
  const [settled, setSettled] = useState(true);
  if (props.open && props.children != null) frozenRef.current = props.children;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || !props.open) return;
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettled(false);
    dialog.showModal();
    return () => {
      dialog.close();
      const trigger = triggerRef.current;
      if (trigger !== null && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [props.open]);

  // 退出动效结束后卸载内容;transitionend 提前到达则提前卸载,计时兜底。
  useEffect(() => {
    if (props.open) return;
    const timer = window.setTimeout(() => setSettled(true), 400);
    return () => window.clearTimeout(timer);
  }, [props.open]);

  const content = props.open ? props.children : settled ? null : frozenRef.current;
  return (
    <dialog
      ref={ref}
      className={`reader-modal-layer ${props.className ?? "reader-mobile-sheet-layer"}`}
      aria-labelledby={props.labelId}
      onTransitionEnd={(event) => {
        if (!props.open && event.target === event.currentTarget) setSettled(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
          ),
        ].filter(
          (element) =>
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      {content}
    </dialog>
  );
}
