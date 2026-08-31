# Browser Compute Runtime — 架构文档

> 版本：0.1（草案）
> 日期：2026-08-30
> 状态：方向已收敛，待 Phase 1 立项

---

## 0. 定位

Browser Compute Runtime（下称 BCR）**不是一个 "WASM 框架"**，而是一个**面向本地计算型 Web 应用的浏览器 Runtime**：

> 统一调度 WASM、WebGPU、WebCodecs、Worker、OPFS 等浏览器能力，
> 让原本需要桌面程序 / 本地 Python / 服务器 GPU 的工作，尽可能直接在浏览器本地完成。

核心设计原则：

- **不要试图用 WASM 替代整个浏览器**，而是让 WASM 成为浏览器里的本地高性能 CPU Compute Layer。
- 各浏览器能力是**互补**的，按负载类型分发，而不是 "Everything → WASM"：

| Plane     | 职责                                             |
| --------- | ------------------------------------------------ |
| JS/TS     | Control Plane — 编排、调度、浏览器 API           |
| WASM      | CPU Compute Plane — 确定性 CPU 密集计算          |
| WebGPU    | Accelerator Plane — AI / 大规模并行计算          |
| WebCodecs | Media Plane — 硬件媒体编解码                     |
| OPFS      | Storage Plane — 大容量持久本地存储               |
| Workers   | Execution Plane — 主线程之外的执行环境           |
| Agent     | Intelligence Plane — 通过 Tool Call 驱动 Runtime |

孵化策略：**不从 Runtime 开始找场景，而是从 Media Studio 这样的真实产品中反向抽象 Runtime**。先用真实应用验证抽象，再正式拆包。

---

## 1. 分层架构

```text
┌─────────────────────────────────────────────────────┐
│                    Application                      │
│                                                     │
│   Media / Quant / Document / Data / Code / CAD     │
├─────────────────────────────────────────────────────┤
│                 Compute Runtime                     │
│                                                     │
│   Scheduler · DAG · Cache · Progress · Cancel      │
│   Resource Manager · Capability · Artifact         │
├──────────────┬──────────────┬───────────────────────┤
│ WASM Runtime │ GPU Runtime  │ Browser Native        │
│              │              │                       │
│ Rust/C/C++   │ WebGPU       │ WebCodecs             │
│ SIMD         │ ONNX/WebLLM  │ Fetch/File API        │
│ Threads      │ ML/Compute   │ Canvas/Web Audio      │
├──────────────┴──────────────┴───────────────────────┤
│                    Worker Layer                     │
│                                                     │
│   compute.worker · gpu.worker · media.worker       │
│   storage.worker · render.worker                   │
├─────────────────────────────────────────────────────┤
│                  Local Storage                      │
│                                                     │
│   OPFS · SQLite WASM · IndexedDB · Cache           │
└─────────────────────────────────────────────────────┘
```

总体架构图（含 Control Plane / Data Plane 边界）：

```text
┌─────────────────────────────────────────────┐
│ React 19 + TanStack Router + shadcn Rhea   │
└──────────────────────┬──────────────────────┘
                       │ Events
┌──────────────────────▼──────────────────────┐
│               Effect Runtime                │
│                                             │
│  Task · Scope · Stream · Fiber · Schedule  │
└───────────────┬───────────────┬─────────────┘
                │               │
          MessagePort      Artifact Graph
                │               │
       ┌────────▼──────┐        │
       │ Worker Pool   │        │
       └───┬────┬──────┘        │
           │    │               │
      ┌────▼─┐ ┌▼────────┐      │
      │ WASM │ │ WebGPU  │      │
      │ Rust │ │ ONNX    │      │
      └──────┘ └─────────┘      │
           │                    │
      SharedArrayBuffer         │
      + Atomics.waitAsync       │
                                │
┌───────────────────────────────▼─────────────┐
│            OPFS + SQLite                    │
│  Artifact · Cache · Project · Journal      │
└─────────────────────────────────────────────┘
```

---

## 2. 核心抽象一：Task

上层应用**不直接管理 Worker**，统一提交 `ComputeTask`：

```ts
interface ComputeTask {
  id: string;

  runtime: "wasm" | "webgpu" | "webcodecs" | "js";

  operation: string; // 如 "asr.whisper" / "backtest.run" / "pdf.extract"

  inputs: ArtifactRef[];
  outputs: ArtifactSpec[];

  resources?: {
    memoryMB?: number;
    threads?: number;
    gpu?: boolean;
  };

  cache?: {
    enabled: boolean;
    key?: string;
  };
}
```

应用层因此不需要关心底层到底是 Rust WASM、ONNX WebGPU、Web Worker 还是 WebCodecs。

`resources` 由 Scheduler 的多维预算闸门执行：线程、内存和 GPU 槽任一不足时进入 FIFO
队列，取消任务会同时移除排队请求；单任务超过宿主总容量则直接失败，避免永久等待。

示例：

| 场景     | operation      | runtime | 输入 → 输出                                |
| -------- | -------------- | ------- | ------------------------------------------ |
| 语音识别 | `asr.whisper`  | webgpu  | `audio/chunk-001` → `transcript/chunk-001` |
| 量化回测 | `backtest.run` | wasm    | `BTCUSDT/30m.arrow` → `backtest/result`    |
| PDF 解析 | `pdf.extract`  | wasm    | `document/file` → `document/layout`        |

---

## 3. 核心抽象二：Artifact

任务之间不直接传 `ArrayBuffer / Blob / Float32Array / Object[]`，统一抽象为 `ArtifactRef`：

```ts
interface ArtifactRef {
  id: string;
  type: string; // "media/video.mp4" / "audio/pcm-f32" / "subtitle/segments" ...

  storage: "memory" | "shared-memory" | "opfs";

  port?: string; // 当前任务中的命名输入/输出端口
  format?: string;
  hash?: string;
}
```

图连线使用稳定端口名表达 `upstream.output → downstream.input`，`type` 只负责兼容性校验。
这样同一 operation 可以拥有多个相同类型的输入，调度器也不会因 fan-in 或数组扁平化选错数据。

Artifact 实体分四类：

```ts
type Artifact =
  | BlobArtifact // 一次性结果（transcript、trades 表）
  | FileArtifact // OPFS 中的大文件（源视频、parquet）
  | SharedArtifact // SharedArrayBuffer 承载的共享数据
  | StreamArtifact; // 流式数据（PCM 帧、解码帧）
```

`Task A → Artifact → Task B` 使整个 Runtime 天然成为 **DAG**：

- 用户删除源视频 → Runtime **cancel descendants**（取消下游任务）。
- 用户只修改翻译 → 不重跑 ASR，仅 **invalidate translate → render** 链路。

---

## 4. Data Plane：三级数据通道

性能瓶颈往往不在 WASM 运算本身，而在 **JS ↔ WASM ↔ Worker 之间的数据复制**。按数据规模分三级通道：

| 规模   | 通道              | 机制                                                        |
| ------ | ----------------- | ----------------------------------------------------------- |
| small  | Transferable      | `postMessage` + Transferable，零拷贝转移所有权              |
| medium | SharedArrayBuffer | 共享环形缓冲 + `Atomics.waitAsync`（Baseline 2025），无轮询 |
| huge   | OPFS              | 持久化，按窗口流动                                          |

对于 10 GB 视频这类数据，**禁止** `10GB → ArrayBuffer → WASM Memory` 的整段装载；始终以几十 MB 的窗口流动：

```text
File → chunk → decoder → ring buffer → compute
```

典型流式 pipeline：

```text
AudioDecoder
      ↓
StreamArtifact<Float32>
      ↓
Resampler WASM
      ↓
StreamArtifact<Float32>
      ↓
ASR
```

即 `stream → stream → stream`，而不是 `huge ArrayBuffer → huge ArrayBuffer`。

---

## 5. Worker Layer

主线程**几乎只负责 UI 与交互**（React 渲染、用户输入），不承担计算。固定若干 Runtime Worker：

```text
main thread
     │
     ├── compute.worker     → Rust WASM（SIMD / threads）
     ├── gpu.worker         → WebGPU / ONNX Runtime Web / WebLLM
     ├── media.worker       → WebCodecs / Mediabunny
     ├── storage.worker     → OPFS / SQLite
     └── render.worker      → OffscreenCanvas（timeline / waveform / 大图渲染）
```

后续演进为 **Worker Pool**：`CPU Worker × N + GPU Worker × 1 + IO Worker × 1`，Scheduler 自动分发。

关键区分：**Worker 生命周期 ≠ Task 生命周期**。

- Effect Scope 管 Task 语义：cancel / timeout / resource 释放。
- Worker Pool 管物理执行资源：Worker 复用、池化、扩缩。

---

## 6. Control Plane：Effect + typed MessagePort

### 6.1 Effect 承载调度语义

Task Scheduler / Cancellation / Retry / Progress / Worker Pool / Resource Manager 不手写 Promise，直接使用 Effect（v3 stable 主线，v4 正式后再升级）：

```text
ComputeTask
     ↓
   Effect
     │
 ┌───┼────────┐
retry cancel timeout
 └───┼────────┘
     ↓
   Worker
```

天然获得：structured concurrency、cancellation、resource lifetime（Scope）、typed errors、retry（Schedule）、Stream、依赖注入（Layer）。

### 6.2 Worker IPC：typed MessagePort 协议（不使用 Comlink）

Object Proxy RPC（Comlink）无法自然表达 progress / stream / cancel / backpressure / priority / resource ownership。改用显式类型化协议：

```ts
type TaskCommand = { type: "run"; task: Task } | { type: "cancel"; taskId: string };

type TaskEvent =
  | { type: "progress"; value: number }
  | { type: "chunk"; artifact: ArtifactRef }
  | { type: "completed"; result: ArtifactRef };
```

`Main ↔ MessageChannel ↔ Worker`，外层包成 `Stream<TaskEvent>`，与 Effect Stream 自然对接。

### 6.3 Effect Schema 统一建模

Task / Worker protocol / Plugin manifest / Persistence / API / LLM structured output 全部用 Effect Schema，避免 Effect + Zod + 自定义 Result + 自定义 cancellation 四套抽象并存。

---

## 7. Content-Addressed Cache（核心差异化设计）

缓存键由输入与计算环境共同决定：

```text
cacheKey = BLAKE3(
  ordered(portName + artifactHash)
  + taskName
  + config
  + runtimeVersion
)
```

输入顺序与端口绑定属于任务语义；交换 `left/right` 等同于不同任务，不得命中同一缓存。

例如 `audio chunk + whisper-small + language=ja` 已执行过 → cache hit → 直接读 `OPFS/transcript/xxx`。

由此获得：

- 刷新浏览器 / 重开项目 → 不重算。
- 修改下游参数 → 仅失效下游。
- 重跑 workflow → 命中的节点直接跳过。

---

## 8. Local Project Engine

Runtime 自带 `OPFS + SQLite WASM` 的本地项目引擎：

**SQLite（元数据）**：projects、tasks、artifacts、dependencies、cache_entries、models、plugins、settings。

**OPFS（数据）**：

```text
project/
├── project.db
├── artifacts/
├── cache/
├── models/
└── temp/
```

媒体项目示例：`source.mp4 / audio-cache/ / transcript/ / translation/ / waveform/`。
量化项目示例：`parquet-cache/ / features/ / strategies/ / backtests/`。

刷新页面后恢复整个 Workspace —— 这是一个本地工作站，而不是传统 Web 页面。

上层 API 面向领域而非 SQL：`ProjectStore / ArtifactStore / CacheStore / TaskJournal`，不让 SQL 泄露到 UI。（TanStack DB 的 live query 值得关注，但仍处 beta，不进 MVP 核心。）

---

## 9. WASM 策略：双模型

### 9.1 高性能 Kernel：wasm-bindgen

```text
wasm32-unknown-unknown + wasm-bindgen
```

适用：DSP、hash、statistics、backtest、image processing。核心诉求是 TypedArray / linear memory / 零拷贝或最小拷贝。

### 9.2 Plugin / Skill ABI：WIT Component Model

插件不走 wasm-bindgen 私有 ABI，走 `WIT + Component Model`：

```wit
interface skill {
    run: func(input: list<u8>) -> result<list<u8>, string>;
}
```

Rust 侧用 `wit-bindgen`，目标 `wasm32-wasip2`；其他语言（C/C++/Go/C#）同样可实现，得到语言无关 ABI。

**边界**：浏览器尚未原生支持 Component Model（Web embedding 仍在设计中），落地路径是：

```text
Component → jco → ES Module + core WASM → Browser
```

WASI 0.3（2026-06 发布，原生 async / stream / future）与 Task/Stream/Async 模型天然吻合，作为长期迁移方向预留：`custom ABI → WIT`。

### 9.3 Plugin Capability 模型

插件**没有**直接文件系统 / 网络 / DOM 访问权限，必须经 Host API + Capability Check：

```text
Plugin → Host API → Capability Check
```

```json
{
  "name": "backtest",
  "capabilities": {
    "filesystem": "project",
    "network": false
  }
}
```

这是 WASM 相比 JS Plugin 最大的架构优势，也是 **Agent Skill Runtime** 的安全基础（见 §10）。

### 9.4 明确不做的事

第一版**不做 WASI Browser OS**（不做完整 virtual filesystem / network stack / shell / package manager）。只需最小 Host ABI：

```text
read_artifact() / write_artifact() / report_progress() / log()
```

网络、文件权限由 Host 实现，避免 "Runtime 做出来了，但没有产品" 的半年陷阱。

---

## 10. GPU 与 Agent

### 10.1 GPU 分两层

- **AI 层**：ONNX Runtime Web → WebGPU（不自研 ML runtime）。
- **自定义 Compute 层**：WebGPU + WGSL（histogram / matrix / image filters / 大向量计算）。

GPU 能力不一致，必须 feature detection + 降级：

```text
WebGPU unavailable → WASM CPU fallback
```

### 10.2 Agent 集成

Agent 不直接 `exec shell`，而是通过 Runtime 的 Tool Call 入口：

```text
run_tool("statistics", input)
```

由 Runtime 决定权限 / CPU / 内存 / timeout / IO，形成安全的 **Agent Skill Runtime**。这可能是比单一 Media Studio 更有长期价值的方向。

---

## 11. 明确的边界与限制

| 限制                                                      | 应对                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **WASM wasm32 linear memory 上限**                        | 禁止 "load entire dataset into WASM"；Runtime 层强制 stream / chunk / batch / OPFS   |
| **SharedArrayBuffer 需要 cross-origin isolation**         | 部署层直接内置 COOP/COEP 配置                                                        |
| **浏览器不是 daemon**（关 tab / 休眠 / 杀后台会中断计算） | 定位为 interactive local compute，不做 7×24 persistent job；TaskJournal 支持断点恢复 |
| **GPU 能力不一致**                                        | feature detection + WASM fallback，不强绑单一 GPU 实现                               |
| **无任意文件系统访问**                                    | 围绕 File picker / Directory picker / OPFS 设计，不模拟 POSIX 桌面环境               |

---

## 12. 2026 技术栈

| Layer           | 选型                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| Language        | TypeScript 7                                                                  |
| UI              | React 19.2 + React Compiler                                                   |
| Toolchain       | Vite+                                                                         |
| Package manager | Bun 1.4（仅开发环境；浏览器代码不依赖 Bun/Node API）                          |
| Router          | TanStack Router（type-safe URL = 可分享的 Workspace View）                    |
| Styling         | Tailwind 4.3                                                                  |
| Components      | shadcn/ui + Base UI，风格 Rhea（高信息密度 product interface）                |
| Runtime Control | Effect 3 stable（→ Effect 4 正式后升级）                                      |
| Worker IPC      | typed MessagePort 协议                                                        |
| Stream 同步     | SharedArrayBuffer + Atomics.waitAsync                                         |
| CPU kernel      | Rust 2024 → core WASM + wasm-bindgen                                          |
| Plugin ABI      | WIT Component Model（jco 转译进浏览器）                                       |
| GPU ML          | ONNX Runtime Web + WebGPU                                                     |
| GPU compute     | WebGPU + WGSL                                                                 |
| Rendering       | OffscreenCanvas（Worker 内渲染）                                              |
| Media           | Mediabunny + WebCodecs                                                        |
| Storage         | OPFS + SQLite WASM                                                            |
| OLAP            | DuckDB WASM + Arrow + Parquet                                                 |
| Test            | Vitest Browser Mode（stable）+ Playwright，直接测 OPFS/WASM/Worker/SAB/WebGPU |

状态管理分层，不建巨型 global store：URL State → TanStack Router；Runtime State → Runtime Core；Persistent State → SQLite；组件内 → React；少量跨组件 UI state → tiny store（第一版可以不装 Zustand）。

---

## 13. 仓库结构

```text
browser-compute/
│
├── packages/                    # TypeScript
│   ├── core/                    # task / scheduler / artifact / cache
│   ├── graph/                   # Pipeline DAG 图模型 + 编译器 + 可视化编辑器（跨 app 复用）
│   ├── runtime-wasm/
│   ├── runtime-webgpu/
│   ├── runtime-webcodecs/
│   ├── runtime-worker/
│   ├── storage-opfs/
│   ├── storage-sqlite/
│   └── react/
│
├── crates/                      # Rust → WASM
│   ├── kernels/                 #   wasm32-unknown-unknown（dsp / hash / image / backtest）
│   ├── components/              #   wasm32-wasip2（media-skill / document-skill / quant-skill）
│   ├── compute-core/
│   ├── media-core/
│   └── quant-core/
│
├── apps/
│   ├── studio/                  # Shell 宿主：OS 式单页（/ 启动台 · /studio · /media，keep-alive 切换）
│   ├── media-studio/            # 可挂载 App Module（@bcr/media-studio/app；standalone 入口保留）
│   └── quant-lab/               # （Phase 2 规划）
│
├── plugins/                     # ffmpeg-demux / resampler / subtitle / backtest / pdf / statistics / image
│
└── examples/
```

---

## 14. 路线图

### Phase 1 — Media Studio 驱动的 Runtime MVP

```text
Task Scheduler · Artifact · Worker Pool · OPFS · Cache · Cancellation
+ WASM DSP · WebGPU ASR · WebCodecs
```

验证关键问题：大数据、streaming、CPU、GPU、storage —— 几乎全部核心假设在这一步得到检验。

### Phase 2 — 加入 Quant workload

```text
DuckDB WASM · Arrow · Rust Backtester · Parquet Cache
```

测试另一类 workload：columnar data / batch compute / large datasets。
**Media + Quant 都能良好运行在同一 Runtime 上，即证明抽象成立。**

### Phase 3 — 正式抽包与生态

```text
@browser-compute/core
@browser-compute/wasm
@browser-compute/gpu
@browser-compute/storage
@browser-compute/react
```

之后才考虑 Plugin SDK、Agent Skills、WIT 全面迁移。

---

## 15. 价值判断

```text
短期 → 为 Media Studio 提供高性能本地 runtime
中期 → Media / Quant / Document 共用同一套计算基础设施
长期 → Browser-native AI + WASM Skill Platform（Agent Skill Runtime）
```

**结论**：技术可行性高（8.5/10，全部基础能力已成熟），值得作为独立基础设施项目孵化；但必须从 Media Studio 这样的真实产品中逐步抽象，而不是先造 Runtime 再找场景。
