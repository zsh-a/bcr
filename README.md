# Browser Compute Runtime (BCR)

面向本地计算型 Web 应用的浏览器 Runtime 初版实现，对应 `docs/ARCHITECTURE.md` 的 Phase 1 核心抽象。

本版范围：**核心 Runtime 包 + 一条端到端垂直切片**——
文件 → OPFS → Worker 内 WASM kernel（分块流式）→ Artifact → 内容寻址缓存命中。

## 仓库结构

```
├── packages/
│   ├── core/             # @bcr/core：ComputeTask / Artifact / Scheduler(Effect) / CacheKey / DAG 失效 / Pipeline
│   ├── runtime-worker/   # @bcr/runtime-worker：typed MessagePort 协议 / WorkerPool / WorkerExecutor
│   ├── storage-opfs/     # @bcr/storage-opfs：BinaryStore 抽象，OPFS + Memory 实现
│   ├── storage-sqlite/   # @bcr/storage-sqlite：SQLite WASM 元数据引擎（CacheStore + 血缘持久化）
│   └── react/            # @bcr/react：RuntimeProvider / useSubmitTask / useTask / useArtifact
├── apps/
│   ├── studio/           # BCR Studio 工作台 UI（Dockview + Tailwind 4 + Base UI）
│   └── media-studio/     # Media Studio · Subtitle——第一个上层应用（§0 孵化策略）
├── crates/
│   └── kernels/          # bcr-kernels：wasm-bindgen kernel（流式 BLAKE3 / RMS / Peak）
└── examples/
    └── demo/             # 最小垂直切片 demo（Vite+ + React 19）
```

与架构文档的对应关系：

| 架构                                  | 实现                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| §2 ComputeTask / §3 ArtifactRef       | `packages/core/src/schema.ts`（Effect Schema）                                       |
| §3 DAG：cancel descendants / 下游失效 | `packages/core/src/scheduler.ts`（cancel 级联、invalidateArtifact）                  |
| §3 DAG 正向编排                       | `scheduler.submitPipeline`（命名端口绑定 + 上游完成自动触发 + fail-fast）            |
| §6.1 Effect 调度语义                  | Scheduler：cancel / timeout / retry(Schedule) / progress Stream                      |
| §5 Resource Manager                   | 线程/内存/GPU 多维预算；FIFO 排队、取消释放、超额快速失败、占用快照                  |
| §6.2 typed MessagePort 协议           | `packages/runtime-worker/src/protocol.ts`（Effect Schema 编解码）                    |
| §5 Worker 生命周期 ≠ Task 生命周期    | `WorkerPool` 常驻复用，cancel 只发命令不销毁 Worker                                  |
| §7 Content-Addressed Cache            | `cacheKey = BLAKE3(ordered(port + artifactHash) + operation + config + runtime)`     |
| §7 Artifact 内容身份                  | 源文件流式 BLAKE3；派生 JSON/波形携带内容 hash 并写入不可变路径                      |
| §7 缓存持久化（刷新不重算）           | `packages/storage-sqlite`：cache_entries 表 + 血缘（task_outputs / dependencies）    |
| §4/§8 OPFS + 窗口流动                 | `BinaryStore`（readRange/putStream/size），kernel 按 4MB 窗口读取                    |
| §8 SQLite WASM 元数据                 | `openSqliteDb`（整库字节经 BinaryStore 落 OPFS，可换任意 BinaryStore）               |
| §9.1 wasm-bindgen kernel              | `crates/kernels`（wasm32-unknown-unknown）                                           |
| §10.1 WebGPU 探测降级                 | `apps/media-studio`：ASR device=auto（GPU→WASM 静默降级）/显式选择；headless 走 WASM |
| §10.2 Whisper ASR                     | transformers.js ONNX（q8 / webgpu fp32+q4），失败回退演示引擎                        |
| 文本翻译                              | opus-mt（英↔中方向可选）：逐条 cue 批量平移，1:1 对齐，无二次音频推理                |
| §11 COOP/COEP                         | `apps/studio/vite.config.ts` 与 `apps/media-studio/vite.config.ts` 内置              |

## 命令

```bash
bun install            # 安装依赖
bun run build:wasm     # 构建 WASM kernel（首次或 kernel 变更后）
bun run test           # vp test：全部单元测试
bun run check          # format + lint + 全 workspace TypeScript 类型检查
bun run demo           # 启动 demo（examples/demo）
bun run studio         # 启动 BCR Studio 工作台（apps/studio）
bun run media          # 启动 Media Studio · Subtitle（apps/media-studio）
cargo test --manifest-path crates/kernels/Cargo.toml
```

## BCR Studio（apps/studio）

工作站式 UI，遵循「DOM → interaction · React → composition · Canvas → visualization · Worker → rendering/compute · WASM → algorithms」的分层原则：

- **Dockview 8**：dock / split / drag / floating / popout 布局，JSON 持久化到 localStorage
- **Tailwind 4 + 原生 CSS variables tokens**：Rhea 风格高信息密度暗色主题（IBM Plex Sans/Mono）
- **Base UI**：命令面板（⌘K）等 headless 交互原语；本地 shadcn 风格组件源码（Button/Badge/...）
- **TanStack Router**：选中文件/任务在 URL search（`?file=&task=`），链接可恢复 workspace view
- **TanStack Virtual**：项目文件 / 任务历史 / 控制台日志全部虚拟化
- **OffscreenCanvas**：波形由 `render.worker` 在 Worker 内绘制，主线程零图形负载
- **SQLite WASM 持久化（§8）**：元数据库落 `opfs://studio/project/meta.db`——缓存条目、任务血缘、
  文件列表全部跨刷新保留；导入 → 计算 → **刷新浏览器 → 重跑直接缓存命中**（`node scripts/verify-persistence.mjs`）
- Runtime 接线：compute.worker 提供 `hash.blake3`（流式 BLAKE3）与 `audio.waveform`（2048 桶峰值包络）两个 WASM operation，任务进度 / cache hit / 取消直接投影到 UI

截图走查脚本：`node scripts/screenshot.mjs`；持久化闭环走查：`node scripts/verify-persistence.mjs`
（均需先 `bun run studio` 起 dev server，Playwright 驱动真实浏览器验证）。

## Media Studio · Subtitle（apps/media-studio）

第一个上层应用（§0：从真实产品反向抽象 Runtime），v1 只收敛一条链路：

```text
Video / Audio → decode（16kHz 单声道 PCM）→ ASR（Whisper）→ 分段 → 翻译（可选）→ 编辑 → SRT / VTT / ASS
```

整条链路是一条 `submitPipeline` DAG（media-studio 的第一次实战检验）：

```text
decode ─┬─ wave（Rust peak kernel 波形）
        └─ asr（transformers.js Whisper，ONNX q8）─ segment ─ translate（Whisper X→EN，双语可选）
```

- **每个节点都是 ComputeTask**：换模型只重算 ASR 下游；同内容文件重跑全部缓存命中；Whisper 下载失败自动回退演示引擎（能量分段），离线也能走通全链路；瞬态 demo 回退不写缓存，网络恢复后会重新尝试 Whisper
- **执行平面**：`runtime "js"` = 主线程 decode（AudioContext 仅主线程可用）；`runtime "wasm"` = media.worker（kernel + ASR），中间产物由 Worker 直写 OPFS
- **流式 decode（§4）**：Mediabunny 解复用 → AudioBufferSink 逐块解码 → 单声道混合 → 跨块相位连续线性重采样 16kHz → 30s 窗增量写 OPFS，任意大文件不整段装载
- **分窗 ASR**：长音频按 120s 窗 + 4s stride 切片推理——进度按窗推进、窗间可取消、Worker 内存只驻留一窗 PCM；每窗完成即发 chunk 事件，字幕**边算边出**（渐进回填编辑器）；stride 区间的归属由下一窗重新转写，边界不丢词不重复
- **计算设备（§10.1）**：ASR 节点 device=auto（`navigator.gpu` 探测，WebGPU 装载失败静默回退 WASM）/ 显式 webgpu（fp32 encoder + q4 decoder）/ wasm；设备参与缓存键
- **双语翻译**：opus-mt 文本翻译（英↔中方向可选）——逐条 cue 批量平移、1:1 对齐、批间可取消，替代 Whisper 二次音频推理（便宜一个数量级）
- **编辑器**：文本/译文/时间轴行内编辑、拆分、删除、点击定位播放；**undo/redo**（Ctrl+Z / Shift+Z / Ctrl+Y，流水线产出重置历史）；**跟随播放**（当前 cue 高亮 + 自动滚入视野）；**CPS 超速告警**（含译文，上限 20 单位/秒）；编辑自动持久化到 SQLite
- **导出**：SRT / WebVTT / ASS（双语第二行），纯函数实现带单测；ASS 支持卡拉 OK 标签——ASR 节点开启词级时间戳后，每词 `\k` 厘秒高亮自动生成
- 刷新恢复：源文件（OPFS Blob 重建播放）+ 字幕编辑 + 引擎设置全部从元数据库回放
- **模型缓存**：transformers.js 经浏览器 Cache API 缓存权重（按 origin 隔离）——
  dev 端口固定后同一浏览器内模型只下载一次；走查脚本用持久化 profile
  （`scripts/verify-browser.mjs`），跨脚本共享缓存，不再每次全量下载

走查脚本（先 `bun run media`，dev 端口固定 **5180**）：

- `node scripts/verify-media-studio.mjs` — 导入合成 WAV → 演示引擎生成 → SRT 导出 → 刷新恢复
- `node scripts/verify-windowed-asr.mjs` — 150s 长音频分窗回归（跨 120s 窗界归属/排序/导出）；`ENGINE=whisper` 走真实模型
- `node scripts/verify-m3.mjs` — undo/redo（键盘+按钮）+ 跟随播放高亮
- `node scripts/verify-karaoke.mjs` — 真实 Whisper 词级时间戳 → ASS `\k`（需外网）
- `node scripts/verify-m2.mjs` — device 探测降级 + opus-mt 双语导出（两轮流水线）
- `node scripts/verify-whisper-probe.mjs` — 真实 Whisper 短音频探针

工具链为 [Vite+](https://viteplus.dev)（`vp` CLI 以本地 devDependency `vite-plus` 提供，不经全局安装）。

## Demo 验证路径

1. 选择文件 → 写入 OPFS（FileArtifact）。
2. 提交 `hash.blake3`（wasm runtime）→ compute.worker 分块读取、流式哈希、回报 progress。
3. 同一文件再次提交 → 缓存命中（界面标注，未重算）；换文件/换操作 → 重算。
4. 运行中可取消（级联语义见 core 测试）。
5. 刷新浏览器 → 文件列表恢复、再次提交直接缓存命中（SQLite 元数据持久化）。

## 本版明确不做

WIT Component Model、插件 capability 模型、Worker Pool 自动扩缩、
Vitest Browser Mode、TaskJournal 断点恢复。
对应架构文档 Phase 1 后续与 Phase 2/3。
