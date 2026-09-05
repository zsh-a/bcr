import { hashReadableStream, type ArtifactRef, type TaskHandle } from "@bcr/core";
import {
  RuntimeProvider,
  useArtifact,
  useRuntime,
  useRuntimeSession,
  useSubmitTask,
  useTask,
} from "@bcr/react";
import { Effect } from "effect";
import { useState } from "react";
import { createRuntimeServices } from "./runtime";

let taskSeq = 0;

function Demo() {
  const { artifacts } = useRuntime();
  const submit = useSubmitTask();

  const [source, setSource] = useState<ArtifactRef | null>(null);
  const [operation, setOperation] = useState<"hash.blake3" | "audio.rms">("hash.blake3");
  const [handle, setHandle] = useState<TaskHandle | null>(null);
  const state = useTask(handle);
  const outputRef = state.status === "completed" ? (state.outputs[0] ?? null) : null;
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
    <div className="slice-app">
      <header className="slice-header">
        <span className="slice-mark">BCR/01</span>
        <div>
          <small>BROWSER COMPUTE RUNTIME</small>
          <b>Vertical Slice</b>
        </div>
        <span className="slice-runtime">
          <i /> LOCAL RUNTIME
        </span>
      </header>

      <main className="slice-main">
        <section className="slice-hero">
          <div>
            <span className="slice-kicker">FILES BECOME COMPUTE</span>
            <h1>
              Local work.
              <br />
              Visible lineage.
            </h1>
          </div>
          <p>
            从浏览器文件到 Worker 内的 WASM
            kernel，再到内容寻址缓存。整个计算链路留在本地，也保持清晰可见。
          </p>
        </section>

        <div className="slice-flow" aria-label="计算流程">
          <span>FILE</span>
          <i>01</i>
          <span>OPFS</span>
          <i>02</i>
          <span>WASM WORKER</span>
          <i>03</i>
          <span>ARTIFACT</span>
        </div>

        <div className="slice-grid">
          <section className="slice-card">
            <header>
              <span>01</span>
              <h2>选择源文件</h2>
            </header>
            <p>文件将通过流式写入进入 OPFS，不需要整段载入内存。</p>
            <label className="slice-file">
              <span>{source === null ? "选择本地文件" : "替换当前文件"}</span>
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void onPickFile(file);
                }}
              />
            </label>
            <div className="slice-detail">
              {source === null ? "WAITING FOR SOURCE" : `OPFS · ${source.id}`}
            </div>
          </section>

          <section className="slice-card">
            <header>
              <span>02</span>
              <h2>提交计算任务</h2>
            </header>
            <p>选择 WASM 操作；相同输入与参数会直接命中内容缓存。</p>
            <label className="slice-field">
              <span>OPERATION</span>
              <select
                value={operation}
                onChange={(event) =>
                  setOperation(event.target.value as "hash.blake3" | "audio.rms")
                }
              >
                <option value="hash.blake3">hash.blake3 · 流式 BLAKE3</option>
                <option value="audio.rms">audio.rms · f32le PCM</option>
              </select>
            </label>
            <div className="slice-actions">
              <button
                className="primary"
                type="button"
                disabled={source === null || state.status === "running"}
                onClick={runTask}
              >
                运行任务
              </button>
              <button
                type="button"
                disabled={state.status !== "running"}
                onClick={() => {
                  if (handle !== null) void Effect.runPromise(handle.cancel);
                }}
              >
                取消
              </button>
            </div>
          </section>

          <section className="slice-card slice-result" aria-live="polite">
            <header>
              <span>03</span>
              <h2>查看运行结果</h2>
            </header>
            <div className="slice-status">
              <span>STATUS</span>
              <b data-status={state.status}>{state.status}</b>
            </div>
            <progress value={state.progress} max={1} />
            {handle?.cached === true && state.status === "completed" && (
              <p className="slice-cache">CACHE HIT · 结果来自内容寻址缓存</p>
            )}
            {"error" in state && <p className="slice-error">ERROR · {state.error}</p>}
            {outputText !== undefined ? (
              <pre>{outputText}</pre>
            ) : (
              <div className="slice-empty">计算产物将在这里显示</div>
            )}
          </section>
        </div>

        <footer className="slice-note">
          <span>REPRODUCIBLE BY DESIGN</span>
          <p>同一文件再次运行同一操作会命中缓存；替换文件或操作则触发新的计算链路。</p>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const { services, error } = useRuntimeSession(createRuntimeServices);
  if (error !== null) return <div role="alert">{error}</div>;

  if (services === null) {
    return (
      <div className="slice-boot">
        <i />
        <span>正在组装 Browser Compute Runtime…</span>
      </div>
    );
  }
  return (
    <RuntimeProvider services={services}>
      <Demo />
    </RuntimeProvider>
  );
}
