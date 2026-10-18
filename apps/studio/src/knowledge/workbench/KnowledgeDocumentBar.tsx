import { useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
import { notePath, parentPath } from "../notes/paths";
import { revealFolder, setSidebar } from "./workbench";
import type { KnowledgeWorkbench } from "./useKnowledgeWorkbench";

export function KnowledgeDocumentBar({ controller }: { controller: KnowledgeWorkbench }) {
  const {
    note,
    mobile,
    setToolbarSlot,
    workbench,
    sidebarElement,
    clearFilters,
    setFocusMode,
    setDrawer,
  } = controller;
  const [locating, setLocating] = useState(0);
  useEffect(() => {
    if (!locating) return;
    const frame = requestAnimationFrame(() => {
      const row = sidebarElement.current?.querySelector<HTMLElement>(
        '.knowledge-file-note[aria-current="page"]',
      );
      row?.scrollIntoView({ block: "nearest" });
      row?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [locating, sidebarElement]);
  if (!note) return null;
  const path = parentPath(notePath(note));
  return (
    <div className="knowledge-document-bar">
      <div className="knowledge-document-location">
        <nav aria-label="笔记路径" title={note.path ?? note.title}>
          <span>笔记库</span>
          <span aria-hidden="true">/</span>
          {path && (
            <>
              <span>{path}</span>
              <span aria-hidden="true">/</span>
            </>
          )}
          <strong>{note.title || "未命名笔记"}</strong>
        </nav>
        <button
          type="button"
          aria-label="定位当前笔记"
          title="在目录中定位当前笔记"
          onClick={() => {
            clearFilters();
            setFocusMode(false);
            workbench.setState((current) => revealFolder(setSidebar(current, "expanded"), path));
            if (mobile) setDrawer(true);
            setLocating((value) => value + 1);
          }}
        >
          <LocateFixed size={15} />
          <span>定位</span>
        </button>
      </div>
      <div ref={setToolbarSlot} className="knowledge-document-toolbar" />
    </div>
  );
}
