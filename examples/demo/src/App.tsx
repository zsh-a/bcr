import { hashReadableStream, type ArtifactRef, type TaskHandle } from "@bcr/core";
import {
  RuntimeProvider,
  useArtifact,
  useRuntime,
  useSubmitTask,
  useTask,
  type RuntimeServices,
} from "@bcr/react";
import { Effect } from "effect";
import { useEffect, useState } from "react";
import { createRuntimeServices } from "./runtime";

let taskSeq = 0;

function Demo() {
  const { artifacts } = useRuntime();
  const submit = useSubmitTask();

  const [source, setSource] = useState<ArtifactRef | null>(null);
  const [operation, setOperation] = useState<"hash.blake3" | "audio.rms">("hash.blake3");
  const [handle, setHandle] = useState<TaskHandle | null>(null);
  const state = useTask(handle);
  const outputRef = state.outputs?.[0] ?? null;
  const outputBytes = useArtifact(outputRef);
  const outputText = outputBytes !== undefined ? new TextDecoder().decode(outputBytes) : undefined;

  const onPickFile = async (file: File) => {
    // §8：源文件落 OPFS（FileArtifact），stream 写入不整段进内存
    const hash = await hashReadableStream(file.stream());
    const ref: ArtifactRef = {
      id: `source/${hash}`,
      type: `file/${file.name.split(".").pop() ?? "bin"}`,
      storage: "opfs",
      hash,
    };
    await Effect.runPromise(artifacts.putStream(ref, file.stream()));
    setSource(ref);
    setHandle(null);
  };

  const runTask = () => {
    if (source === null) return;
    taskSeq += 1;
    void submit({
      id: `task-${taskSeq}`,
      runtime: "wasm",
      operation,
      inputs: [source],
      outputs: [{ type: "demo/result" }],
      cache: { enabled: true },
    }).then(setHandle);
  };

  return (
    <main style={{ fontFamily: "monospace", padding: 24, maxWidth: 720 }}>
      <h1>BCR 垂直切片</h1>
      <p>文件 → OPFS → Worker 内 WASM kernel（流式分块）→ Artifact → 内容寻址缓存</p>

      <section>
        <h2>1. 选择源文件</h2>
        <input
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void onPickFile(file);
          }}
        />
        {source !== null && <p>已写入 OPFS：{source.id}</p>}
      </section>

      <section>
        <h2>2. 提交任务（wasm runtime）</h2>
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value as "hash.blake3" | "audio.rms")}
        >
          <option value="hash.blake3">hash.blake3（流式 BLAKE3）</option>
          <option value="audio.rms">audio.rms（按 f32le PCM 统计）</option>
        </select>{" "}
        <button
          type="button"
          disabled={source === null || state.status === "running"}
          onClick={runTask}
        >
          运行
        </button>{" "}
        <button
          type="button"
          disabled={state.status !== "running"}
          onClick={() => {
            if (handle !== null) void Effect.runPromise(handle.cancel);
          }}
        >
          取消
        </button>
      </section>

      <section>
        <h2>3. 状态</h2>
        <p>
          status: {state.status}
          {handle?.cached === true && state.status === "completed" ? "（缓存命中，未重算）" : ""}
        </p>
        <progress value={state.progress} max={1} style={{ width: "100%" }} />
        {state.error !== undefined && <p>error: {state.error}</p>}
        {outputText !== undefined && <pre style={{ wordBreak: "break-all" }}>{outputText}</pre>}
      </section>

      <p style={{ color: "#666" }}>
        提示：同一文件再次运行同一操作 → 缓存命中；换文件或换操作 → 重算。
      </p>
    </main>
  );
}

export default function App() {
  const [services, setServices] = useState<RuntimeServices | null>(null);

  useEffect(() => {
    void createRuntimeServices().then(setServices);
  }, []);

  if (services === null) return <p>Runtime 初始化中…</p>;
  return (
    <RuntimeProvider services={services}>
      <Demo />
    </RuntimeProvider>
  );
}
