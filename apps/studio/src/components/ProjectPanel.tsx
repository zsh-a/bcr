import { useVirtualizer } from "@tanstack/react-virtual";
import { FilePlus2, File as FileIcon } from "lucide-react";
import { useRef } from "react";
import { importFile } from "../runtime";
import { useSelection } from "../router";
import { useServices } from "../services";
import { useStudio, type FileRecord } from "../store";
import { formatBytes, PanelEmpty } from "./ui";

/** 项目文件列表面板：大列表虚拟化（§12 TanStack Virtual）。 */
export function ProjectPanel() {
  const services = useServices();
  const files = useStudio((s) => s.files);
  const selection = useSelection();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
          {files.length} files
        </span>
        <button
          type="button"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.onchange = () => {
              const file = input.files?.[0];
              if (file !== undefined) {
                void importFile(services, file).then((ref) => selection.select({ file: ref.id }));
              }
            };
            input.click();
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-xs)] px-2.5 text-[11px] text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <FilePlus2 className="size-3" />
          导入
        </button>
      </div>

      {files.length === 0 ? (
        <PanelEmpty title="还没有文件" hint="导入的源文件会持久化到 OPFS" />
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const file = files[row.index];
              if (file === undefined) return null;
              return (
                <FileRow
                  key={file.ref.id}
                  file={file}
                  selected={selection.file === file.ref.id}
                  top={row.start}
                  height={row.size}
                  onSelect={() => selection.select({ file: file.ref.id })}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FileRow(props: {
  file: FileRecord;
  selected: boolean;
  top: number;
  height: number;
  onSelect: () => void;
}) {
  const { file } = props;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      style={{
        top: props.top,
        height: props.height,
        position: "absolute",
        left: 0,
        width: "100%",
      }}
      className={`flex items-center gap-2 border-l-2 px-2 text-left transition-colors ${
        props.selected ? "border-accent bg-raised" : "border-transparent hover:bg-raised/60"
      }`}
    >
      <FileIcon className="size-3.5 shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-text">{file.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-faint">{formatBytes(file.size)}</span>
    </button>
  );
}
