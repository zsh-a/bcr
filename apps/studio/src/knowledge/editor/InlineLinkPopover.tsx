import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@bcr/react";
import { ExternalLink, Link, Unlink } from "lucide-react";
import { editorUnlink, safeEditorLink, targetValid, type EditorTarget } from "./editorContext";
import { runEditorEdit } from "./editorCommands";
import { EditorLinkDialog } from "./EditorLinkDialog";
import "./editorContext.css";

export function InlineLinkPopover({
  target,
  onClose,
  onOpenLink,
}: {
  target: EditorTarget | null;
  onClose: () => void;
  onOpenLink?: ((target: string) => void) | undefined;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!target || !element) return;
    element.showPopover();
    const position = () => {
      const box = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(target.x, innerWidth - box.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(target.y, innerHeight - box.height - 8))}px`;
    };
    position();
    if (target.keyboard)
      element.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const dismiss = () => onClose();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [target, onClose]);
  const link = target?.link;
  return (
    <>
      {target && link && (
        <div
          ref={panel}
          popover="auto"
          role="dialog"
          aria-label="链接操作"
          className="knowledge-inline-link-popover"
          onToggle={(event) => {
            if (event.newState === "closed") onClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              target.view.focus();
            }
          }}
        >
          <div className="knowledge-link-destination" title={link.url}>
            {link.url}
          </div>
          <div className="knowledge-inline-link-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={!safeEditorLink(link.url) || (link.internal && !onOpenLink)}
              onClick={() => {
                if (!targetValid(target, false)) return onClose();
                if (link.internal) onOpenLink?.(link.target);
                else window.open(link.url, "_blank", "noopener,noreferrer");
                onClose();
              }}
            >
              <ExternalLink size={14} />
              打开
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={target.view.state.readOnly}
              onClick={() => {
                if (targetValid(target)) {
                  setEditing(target);
                  onClose();
                }
              }}
            >
              <Link size={14} />
              编辑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={target.view.state.readOnly}
              onClick={() => {
                if (targetValid(target)) {
                  const text = editorUnlink(target);
                  runEditorEdit(target.view, {
                    changes: { from: link.from, to: link.to, insert: text },
                    selection: { anchor: link.from + text.length },
                    userEvent: "input",
                  });
                }
                onClose();
              }}
            >
              <Unlink size={14} />
              移除链接
            </Button>
          </div>
        </div>
      )}
      {editing && <EditorLinkDialog target={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
