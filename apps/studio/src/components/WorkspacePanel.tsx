import { Effect } from "effect";
import { AudioWaveform, Hash, Upload } from "lucide-react";
import { useEffect, useRef } from "react";
import { importFile, runTask } from "../runtime";
import { useSelection } from "../router";
import { useServices } from "../services";
import { useStudio } from "../store";
import { Badge, Button, formatBytes, PanelEmpty } from "./ui";

/**
 * Workspace 中央面板：文件操作 + 波形视口。
 * 波形由 render.worker 在 OffscreenCanvas 中绘制（§5/§7 高频图形不进 React DOM）。
 */
export function WorkspacePanel() {
  const services = useServices();
  const selection = useSelection();
  const file = useStudio((s) => s.files.find((f) => f.ref.id === selection.file));
  const waveformTask = useStudio((s) =>
    s.tasks.find(
      (t) =>
        t.operation === "audio.waveform" &&
        t.status === "completed" &&
        t.inputId === selection.file,
    ),
  );
  const waveformDone = waveformTask !== undefined;
  const hashTask = useStudio((s) =>
    s.tasks.find(
      (t) =>
        t.operation === "hash.blake3" && t.status === "completed" && t.inputId === selection.file,
    ),
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const attachedRef = useRef(false);

  // OffscreenCanvas 移交 render.worker（每块 canvas 只能移交一次）。
  // canvas 仅在选中文件后挂载，因此依赖 hasFile 等它出现。
  const hasFile = file !== undefined;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || attachedRef.current) return;
    attachedRef.current = true;
    const worker = new Worker(new URL("../workers/render.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    const rect = canvas.getBoundingClientRect();
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage(
      {
        type: "attach",
        canvas: offscreen,
        width: rect.width,
        height: rect.height,
        dpr: window.devicePixelRatio,
      },
      [offscreen],
    );
    const observer = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      worker.postMessage({
        type: "resize",
        width: r.width,
        height: r.height,
        dpr: window.devicePixelRatio,
      });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasFile]);

  // 波形 artifact → render.worker（Transferable 零拷贝）
  useEffect(() => {
    if (file === undefined) return;
    const waveformRef = waveformTask?.outputs?.find((ref) => ref.type === "audio/waveform-peaks");
    if (waveformRef === undefined) {
      workerRef.current?.postMessage({ type: "clear" });
      return;
    }
    void Effect.runPromise(Effect.either(services.artifacts.get(waveformRef))).then((either) => {
      if (either._tag !== "Right") return;
      const bytes = either.right;
      const peaks = new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      workerRef.current?.postMessage({ type: "peaks", peaks }, [peaks.buffer]);
    });
  }, [file, waveformTask, services]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) {
      void importFile(services, dropped).then((ref) => selection.select({ file: ref.id }));
    }
  };

  if (file === undefined) {
    return (
      <div className="h-full p-3" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border-strong">
          <Upload className="size-5 text-faint" />
          <PanelEmpty
            title="拖入文件，或从左侧项目文件导入"
            hint="文件持久化到 OPFS；计算在 Worker + WASM 中本地完成"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-text">{file.name}</div>
          <div className="font-mono text-[10px] text-faint">
            {formatBytes(file.size)} · {file.ref.type} · opfs
          </div>
        </div>
        <Button
          variant="primary"
          onClick={() => void runTask(services, file.ref, "hash.blake3", file.size)}
        >
          <Hash className="size-3" />
          BLAKE3
        </Button>
        <Button onClick={() => void runTask(services, file.ref, "audio.waveform", file.size)}>
          <AudioWaveform className="size-3" />
          提取波形
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
          <canvas ref={canvasRef} className="absolute inset-0 size-full" />
          {!waveformDone && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[11px] text-faint">
                运行「提取波形」后在此渲染（Worker + OffscreenCanvas）
              </p>
            </div>
          )}
          {waveformDone && (
            <div className="absolute top-2 left-2">
              <Badge tone="accent">waveform · 2048 buckets</Badge>
            </div>
          )}
        </div>

        <div className="shrink-0 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
          <div className="mb-1 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
            BLAKE3
          </div>
          {hashTask?.outputs?.[0]?.hash !== undefined ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-accent">
                {hashTask.outputs[0].hash}
              </code>
              {hashTask.cached && <Badge tone="amber">cache hit</Badge>}
            </div>
          ) : (
            <p className="text-[11px] text-faint">尚未计算</p>
          )}
        </div>
      </div>
    </div>
  );
}
