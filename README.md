# Browser Compute Runtime (BCR)

面向本地计算型 Web 应用的浏览器 Runtime 初版实现，对应 `docs/ARCHITECTURE.md` 的 Phase 1 核心抽象。

本版范围：**核心 Runtime 包 + Media / Quant / Markets 三类端到端垂直切片**——
文件或行情 → OPFS → Worker Pipeline → Artifact → 内容寻址缓存 → 跨刷新项目恢复。

## 仓库结构

```
├── packages/
│   ├── core/             # @bcr/core：ComputeTask / Artifact / Scheduler(Effect) / CacheKey / DAG 失效 / Pipeline
│   ├── runtime-worker/   # @bcr/runtime-worker：typed MessagePort 协议 / WorkerPool / WorkerExecutor
│   ├── storage-opfs/     # @bcr/storage-opfs：BinaryStore 抽象，OPFS + Memory 实现
│   ├── storage-sqlite/   # @bcr/storage-sqlite：SQLite WASM 元数据引擎（Cache / 血缘 / TaskJournal）
│   ├── market-data/      # @bcr/market-data：统一市场数据契约 / stock-sdk 适配 / 缓存降级
│   └── react/            # @bcr/react：RuntimeProvider / useSubmitTask / useTask / useArtifact
├── apps/
│   ├── studio/           # BCR Studio 工作台 UI（Dockview + Tailwind 4 + Base UI）
│   ├── media-studio/     # Media Studio · Subtitle——第一个上层应用（§0 孵化策略）
│   ├── quant-lab/        # Quant Lab · Strategy Workbench——第二类 workload 验证
│   └── market-board/     # Market Atlas——CN / HK / US / 全球期货市场看板
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
| §5 Worker 生命周期 ≠ Task 生命周期    | `WorkerPool` 可取消等待、关闭传播、min/max 按需扩容与 idle timeout 自动收缩          |
| §7 Content-Addressed Cache            | `cacheKey = BLAKE3(ordered(port + artifactHash) + operation + config + runtime)`     |
| §7 Artifact 内容身份                  | 源文件流式 BLAKE3；派生 JSON/波形携带内容 hash 并写入不可变路径                      |
| §7 缓存持久化（刷新不重算）           | `packages/storage-sqlite`：cache_entries 表 + 血缘（task_outputs / dependencies）    |
| §4/§8 OPFS + 窗口流动                 | `BinaryStore`（readRange/putStream/size），kernel 按 4MB 窗口读取                    |
| §8 SQLite WASM 元数据                 | `openSqliteDb`（整库字节经 BinaryStore 落 OPFS，可换任意 BinaryStore）               |
| §8 TaskJournal / 崩溃恢复             | queued/running/终态写穿 SQLite；输入完整时重放，缺失时转 blocked                     |
| §9.1 wasm-bindgen kernel              | `crates/kernels`（wasm32-unknown-unknown）                                           |
| §10.1 WebGPU 探测降级                 | `apps/media-studio`：ASR device=auto（GPU→WASM 静默降级）/显式选择；headless 走 WASM |
| §10.2 Whisper ASR                     | transformers.js ONNX（q8 / webgpu fp32+q4），失败回退演示引擎                        |
| 文本翻译                              | opus-mt（英↔中方向可选）：逐条 cue 批量平移，1:1 对齐，无二次音频推理                |
| §14 Quant workload                    | DuckDB WASM + Arrow IPC + Parquet → SMA Signal → Backtest Pipeline                   |
| Market Atlas                          | stock-sdk → Quote / Search / OHLCV / Dividend 契约 → 多市场看板与 Quant handoff      |
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
bun run quant          # 启动 Quant Lab · Strategy Workbench（apps/quant-lab）
bun run markets        # 启动 Market Atlas（apps/market-board）
cargo test --manifest-path crates/kernels/Cargo.toml
bun run test:browser   # 自动启停 dev server，运行离线 Playwright 主链路
```

GitHub Actions 会执行格式/类型/单测、Rust/WASM、四端生产构建，并在真实 Chromium 中验证
Media Studio 短音频、150 秒分窗、Studio 刷新缓存/任务历史、Quant Lab 回测参数重跑以及
Market Atlas 数据质量与交互；
失败时保留截图与 server 日志。

## BCR Studio（apps/studio）

工作站式 UI，遵循「DOM → interaction · React → composition · Canvas → visualization · Worker → rendering/compute · WASM → algorithms」的分层原则：

- **Dockview 8**：dock / split / drag / floating / popout 布局，JSON 持久化到 localStorage
- **Tailwind 4 + 原生 CSS variables tokens**：Rhea 风格高信息密度暗色主题（IBM Plex Sans/Mono）
- **Base UI**：命令面板（⌘K）等 headless 交互原语；本地 shadcn 风格组件源码（Button/Badge/...）
- **TanStack Router**：选中文件/任务在 URL search（`?file=&task=`），链接可恢复 workspace view
- **TanStack Virtual**：项目文件 / 任务历史 / 控制台日志全部虚拟化
- **OffscreenCanvas**：波形由 `render.worker` 在 Worker 内绘制，主线程零图形负载
- **SQLite WASM 持久化（§8）**：元数据库落 `opfs://studio/project/meta.db`——缓存条目、任务血缘、
  文件列表与 TaskJournal 全部跨刷新保留；异常退出遗留任务在输入 Artifact 完整时自动重放，输入缺失则标记
  `blocked`；导入 → 计算 → **刷新浏览器 → 历史恢复、重跑直接缓存命中**（`node scripts/verify-persistence.mjs`）
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

## Quant Lab（apps/quant-lab）

第二个上层应用用量化 batch workload 反向检验同一 Runtime 抽象：

```text
CSV / Parquet → DuckDB WASM → Year Manifest → Arrow IPC shards → SMA Cross → Rust/WASM Backtest
                                      └──────→ ZSTD Parquet shards └───────→ Equity / Trades / Metrics
```

- 首次启动提供固定种子的 5,040 根日线基准行情，可导入标准 OHLCV CSV 或 Parquet
- DuckDB WASM 对行情执行 schema 规范化、SQL profiling，并按年度物化 Arrow IPC / ZSTD Parquet 分区与内容寻址清单
- Worker 并行读取年度 Arrow 分区；合并 Parquet 仍可直接下载并重新导入，旧单文件项目会自动迁移
- 两节点 `submitPipeline` 在弹性 WorkerPool 中执行；行情内容、快慢周期、资金和费率均进入缓存键
- Rust/WASM kernel 通过 Float64Array / Uint8Array 批次执行 long-only 回测，产出权益、交易与完整指标
- Worker 会与 TypeScript 参考实现逐点校验；WASM 不可用或数值失配时显式标记降级
- 行情、列式缓存、结果 Artifact、Cache、血缘、TaskJournal 与项目参数经 OPFS + SQLite 跨刷新恢复
- UI 采用高密度策略终端：价格/双均线/买卖点、权益曲线、Pipeline 状态和 Trade Blotter 同屏

走查：`node scripts/verify-quant-lab.mjs`（由 `bun run test:browser` 自动执行）。

## Market Atlas（apps/market-board）

第四个 keep-alive 应用以实时、持续更新的 market-data workload 补充 Quant Lab 的批量计算链路：

```text
stock-sdk (CN / HK / US / Global Futures)
             ↓
@bcr/market-data canonical snapshot + daily OHLCV history
             ↓
live delayed / partial / cached / demo quality states
             ↓
Market Atlas · pulse / candlesticks / watchlist → Quant Lab handoff
```

- `stock-sdk@2.4.2` 只存在于数据适配层；UI 不直接依赖第三方返回类型，后续可组合欧洲、日本、FX 数据源
- CN / HK / US 与全球期货独立请求、独立健康状态；整体失败优先恢复 localStorage 最后快照，再显式降级 fixture
- 行情始终展示来源、更新时间与 `DELAYED / PARTIAL / CACHED / DEMO` 质量，不把公开接口标记为撮合级实时数据
- Midnight Atlas 编辑式界面提供全球交易时区轨道、市场焦点、方向宽度、跨资产行情、异动和持久化 Watchlist
- Pulse 基准集扩展为 CN / HK / US 各 5 个指数与龙头标的；顶栏搜索通过 `sdk.search()` 发现三地股票、指数与场内基金，内置 33 个常用标的目录作为即时/离线降级，并持久化最近打开标的
- 标的焦点支持 1M / 3M / 6M / 1Y / 3Y 日线 K 线、成交量与指针读数；长周期只在显示层聚合，交接仍保留完整日线
- Income Ledger 使用 `sdk.reference.dividendDetail()` 展示 A 股个股现金分红、股息率、除权日、登记日与实施进度；HK / US / 基金尚无同口径 provider 时明确显示覆盖边界
- “Send to Quant” 将当前历史柱交给 Quant Lab，后者自动生成年度 Arrow / Parquet 分区并运行策略；快照微型图仍只表达“昨收 → 最新”
- 确定性模拟曲线与 OHLCV 仅出现在明确标记的演示 fixture 中，不伪装成实时历史数据

走查：`node scripts/verify-market-atlas.mjs`（由 `bun run test:browser` 自动执行）。

## Demo 验证路径

1. 选择文件 → 写入 OPFS（FileArtifact）。
2. 提交 `hash.blake3`（wasm runtime）→ compute.worker 分块读取、流式哈希、回报 progress。
3. 同一文件再次提交 → 缓存命中（界面标注，未重算）；换文件/换操作 → 重算。
4. 运行中可取消（级联语义见 core 测试）。
5. 刷新浏览器 → 文件列表与任务历史恢复、异常中断任务安全重放、再次提交直接缓存命中。

## 本版明确不做

WIT Component Model、插件 capability 模型、Worker 崩溃健康替换、多资产组合、
SIMD/多线程 Quant kernel、Vitest Browser Mode、跨设备任务迁移。
对应架构文档 Phase 1 后续与 Phase 2/3。
