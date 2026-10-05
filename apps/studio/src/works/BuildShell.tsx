import { useState, type ReactNode } from "react";
import { Button } from "@bcr/react";
import { ArrowUpRight, History, SlidersHorizontal, FolderOpen, Download } from "lucide-react";
import type { WorkSummary } from "@bcr/work-core";
import type { WorkService } from "./service";
import { VersionHistory } from "./VersionHistory";
import "./build.css";

export function BuildShell({
  service,
  work,
  dirty,
  busy,
  status,
  onSubmit,
  controls,
  tools,
  inspector,
  inspectorOpen,
  onInspector,
  toggleLabel = "参数",
  onExport,
  children,
  bottom,
}: {
  service: WorkService;
  work: WorkSummary;
  dirty: boolean;
  busy: boolean;
  status: string;
  onSubmit: () => void;
  controls: ReactNode;
  tools?: ReactNode;
  inspector: ReactNode;
  inspectorOpen: boolean;
  onInspector: () => void;
  toggleLabel?: string;
  onExport: () => void;
  children: ReactNode;
  bottom?: ReactNode;
}) {
  const [history, setHistory] = useState(false);
  return (
    <section className="build-desk" aria-label="作品制作工作台">
      <header className="build-toolbar">
        <div className="build-title">
          <div>
            <span className="build-eyebrow">CREATE & EXPLORE</span>
            <h1>{work.title}</h1>
          </div>
        </div>
        <div className="build-toolbar-actions">
          <Button variant="ghost" disabled={busy} onClick={() => setHistory(true)}>
            <History size={15} />
            版本历史
          </Button>
          <Button variant="ghost" disabled={dirty || busy} onClick={onExport}>
            <Download size={15} />
            导出
          </Button>
          <Button disabled={dirty || busy || !work.targets.length} onClick={onSubmit}>
            <ArrowUpRight size={15} />
            提交审阅
          </Button>
        </div>
      </header>
      <div className="build-controlbar">
        <div>{controls}</div>
        <div>
          {tools}
          <Button variant="ghost" aria-pressed={inspectorOpen} onClick={onInspector}>
            {toggleLabel === "参数" ? <SlidersHorizontal size={14} /> : <FolderOpen size={14} />}
            <span>{toggleLabel}</span>
          </Button>
        </div>
      </div>
      <div className={`build-layout ${inspectorOpen ? "has-inspector" : ""}`}>
        <main className="build-canvas-area">{children}</main>
        {inspectorOpen && (
          <aside
            className="build-inspector"
            aria-label={toggleLabel === "参数" ? "制作参数" : "作品文件面板"}
          >
            {inspector}
          </aside>
        )}
      </div>
      <footer className="build-statusbar">
        <span className={dirty ? "is-dirty" : ""}>
          <i />
          {status}
        </span>
        <code>{work.revision.slice(0, 8)}</code>
        {bottom}
      </footer>
      {history && (
        <VersionHistory
          service={service}
          work={work}
          readOnly={dirty}
          close={() => setHistory(false)}
        />
      )}
    </section>
  );
}
