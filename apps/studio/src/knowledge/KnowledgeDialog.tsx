import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import "./dialog.css";

/** Native top-layer dialog: keeps form drafts mounted without moving the document. */
export function KnowledgeDialog({
  open,
  title,
  onClose,
  children,
  error,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const visited = useRef(false);
  const startedOutside = useRef(false);
  const id = useId();
  const [busy, setBusy] = useState(false);
  if (open) visited.current = true;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = document.activeElement;
    dialog.showModal();
    const updateBusy = () => setBusy(!!dialog.querySelector('[aria-busy="true"]'));
    updateBusy();
    const observer = new MutationObserver(updateBusy);
    observer.observe(dialog, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
      childList: true,
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      observer.disconnect();
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [open]);
  function dismiss() {
    if (ref.current?.querySelector('[aria-busy="true"]')) return;
    onClose();
  }
  if (!visited.current) return null;
  return (
    <dialog
      ref={ref}
      className="knowledge-dialog"
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, a[href], summary, [tabindex]",
          ),
        ].filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            element.checkVisibility() &&
            element.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls.at(-1);
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
        dismiss();
      }}
      onPointerDown={(event) => {
        startedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && startedOutside.current) dismiss();
        startedOutside.current = false;
      }}
    >
      <div className="knowledge-dialog-surface">
        <header className="knowledge-dialog-heading">
          <div>
            <span>知识工作台</span>
            <h2 id={id}>{title}</h2>
          </div>
          <button
            type="button"
            className="knowledge-button"
            aria-label={`关闭${title}`}
            disabled={busy}
            onClick={dismiss}
            autoFocus
          >
            <X size={20} />
          </button>
        </header>
        <div className="knowledge-dialog-body">
          {error && (
            <p role="alert" className="knowledge-alert">
              {error}
            </p>
          )}
          {children}
        </div>
      </div>
    </dialog>
  );
}
