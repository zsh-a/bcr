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
│   └── studio/           # BCR Studio 工作台 UI（Dockview + Tailwind 4 + Base UI）
├── crates/
│   └── kernels/          # bcr-kernels：wasm-bindgen kernel（流式 BLAKE3 / RMS / Peak）
└── examples/
    └── demo/             # 最小垂直切片 demo（Vite+ + React 19）
```

与架构文档的对应关系：

| 架构                                  | 实现                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| §2 ComputeTask / §3 ArtifactRef       | `packages/core/src/schema.ts`（Effect Schema）                                    |
| §3 DAG：cancel descendants / 下游失效 | `packages/core/src/scheduler.ts`（cancel 级联、invalidateArtifact）               |
| §3 DAG 正向编排                       | `scheduler.submitPipeline`（节点图校验 + 上游完成自动触发 + fail-fast）           |
| §6.1 Effect 调度语义                  | Scheduler：cancel / timeout / retry(Schedule) / progress Stream                   |
| §6.2 typed MessagePort 协议           | `packages/runtime-worker/src/protocol.ts`（Effect Schema 编解码）                 |
| §5 Worker 生命周期 ≠ Task 生命周期    | `WorkerPool` 常驻复用，cancel 只发命令不销毁 Worker                               |
| §7 Content-Addressed Cache            | `cacheKey = BLAKE3(artifactHash + operation + config + runtimeVersion)`           |
| §7 缓存持久化（刷新不重算）           | `packages/storage-sqlite`：cache_entries 表 + 血缘（task_outputs / dependencies） |
| §4/§8 OPFS + 窗口流动                 | `BinaryStore`（readRange/putStream），kernel 按 4MB 窗口读取                      |
| §8 SQLite WASM 元数据                 | `openSqliteDb`（整库字节经 BinaryStore 落 OPFS，可换任意 BinaryStore）            |
| §9.1 wasm-bindgen kernel              | `crates/kernels`（wasm32-unknown-unknown）                                        |
| §11 COOP/COEP                         | `apps/studio/vite.config.ts` 内置                                                 |

## 命令

```bash
bun install            # 安装依赖
bun run build:wasm     # 构建 WASM kernel（首次或 kernel 变更后）
bun run test           # vp test：全部单元测试
bun run check          # vp check：format + lint
bun run demo           # 启动 demo（examples/demo）
bun run studio         # 启动 BCR Studio 工作台（apps/studio）
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

工具链为 [Vite+](https://viteplus.dev)（`vp` CLI 以本地 devDependency `vite-plus` 提供，不经全局安装）。

## Demo 验证路径

1. 选择文件 → 写入 OPFS（FileArtifact）。
2. 提交 `hash.blake3`（wasm runtime）→ compute.worker 分块读取、流式哈希、回报 progress。
3. 同一文件再次提交 → 缓存命中（界面标注，未重算）；换文件/换操作 → 重算。
4. 运行中可取消（级联语义见 core 测试）。
5. 刷新浏览器 → 文件列表恢复、再次提交直接缓存命中（SQLite 元数据持久化）。

## 本版明确不做

WebGPU / WebCodecs / ONNX、WIT Component Model、插件 capability 模型、
Worker Pool 自动扩缩、Vitest Browser Mode、TaskJournal 断点恢复。
对应架构文档 Phase 1 后续与 Phase 2/3。
