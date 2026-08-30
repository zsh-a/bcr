# Browser Compute Runtime (BCR)

面向本地计算型 Web 应用的浏览器 Runtime 初版实现，对应 `docs/ARCHITECTURE.md` 的 Phase 1 核心抽象。

本版范围：**核心 Runtime 包 + 一条端到端垂直切片**——
文件 → OPFS → Worker 内 WASM kernel（分块流式）→ Artifact → 内容寻址缓存命中。

## 仓库结构

```
├── packages/
│   ├── core/             # @bcr/core：ComputeTask / Artifact / Scheduler(Effect) / CacheKey / DAG 失效
│   ├── runtime-worker/   # @bcr/runtime-worker：typed MessagePort 协议 / WorkerPool / WorkerExecutor
│   ├── storage-opfs/     # @bcr/storage-opfs：BinaryStore 抽象，OPFS + Memory 实现
│   └── react/            # @bcr/react：RuntimeProvider / useSubmitTask / useTask / useArtifact
├── crates/
│   └── kernels/          # bcr-kernels：wasm-bindgen kernel（流式 BLAKE3 / RMS / Peak）
└── examples/
    └── demo/             # 垂直切片 demo（Vite+ + React 19）
```

与架构文档的对应关系：

| 架构                                  | 实现                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| §2 ComputeTask / §3 ArtifactRef       | `packages/core/src/schema.ts`（Effect Schema）                          |
| §3 DAG：cancel descendants / 下游失效 | `packages/core/src/scheduler.ts`（cancel 级联、invalidateArtifact）     |
| §6.1 Effect 调度语义                  | Scheduler：cancel / timeout / retry(Schedule) / progress Stream         |
| §6.2 typed MessagePort 协议           | `packages/runtime-worker/src/protocol.ts`（Effect Schema 编解码）       |
| §5 Worker 生命周期 ≠ Task 生命周期    | `WorkerPool` 常驻复用，cancel 只发命令不销毁 Worker                     |
| §7 Content-Addressed Cache            | `cacheKey = BLAKE3(artifactHash + operation + config + runtimeVersion)` |
| §4/§8 OPFS + 窗口流动                 | `BinaryStore`（readRange/putStream），kernel 按 4MB 窗口读取            |
| §9.1 wasm-bindgen kernel              | `crates/kernels`（wasm32-unknown-unknown）                              |
| §11 COOP/COEP                         | `examples/demo/vite.config.ts` 内置                                     |

## 命令

```bash
bun install            # 安装依赖
bun run build:wasm     # 构建 WASM kernel（首次或 kernel 变更后）
bun run test           # vp test：全部单元测试
bun run check          # vp check：format + lint
bun run demo           # 启动 demo（examples/demo）
cargo test --manifest-path crates/kernels/Cargo.toml
```

工具链为 [Vite+](https://viteplus.dev)（`vp` CLI 以本地 devDependency `vite-plus` 提供，不经全局安装）。

## Demo 验证路径

1. 选择文件 → 写入 OPFS（FileArtifact）。
2. 提交 `hash.blake3`（wasm runtime）→ compute.worker 分块读取、流式哈希、回报 progress。
3. 同一文件再次提交 → 缓存命中（界面标注，未重算）；换文件/换操作 → 重算。
4. 运行中可取消（级联语义见 core 测试）。

## 本版明确不做

WebGPU / WebCodecs / ONNX、SQLite WASM（CacheStore 已留接口）、WIT Component Model、
插件 capability 模型、Worker Pool 自动扩缩、Vitest Browser Mode。
对应架构文档 Phase 1 后续与 Phase 2/3。
