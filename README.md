# Browser Compute Runtime (BCR)

面向本地计算型 Web 应用的浏览器 Runtime 初版实现，对应 `docs/ARCHITECTURE.md` 的 Phase 1 核心抽象。

当前实现的所有权、会话生命周期与接入契约见 [Runtime 架构](docs/RUNTIME-ARCHITECTURE.md)。
计算应用通过 `@bcr/runtime-browser` 统一组装，嵌入 Studio 时共享资源预算，领域计算与搜索投影由应用自身提供。

Studio 另提供[个人知识库与 Git 同步](docs/KNOWLEDGE-SYNC.md)：独立手写 Markdown、资料引用、全局搜索，以及基于 GitHub 私有仓库的多设备同步与冲突恢复。入口为 `/knowledge`。

[绘图工作区](docs/DRAWING.md)使用 Excalidraw 提供本地画布、Mermaid 转换、图表导入导出与 AI 局部编辑，入口为 `/diagram`。

本版范围：**核心 Runtime 包 + Media / Quant / Markets / Manga / Reader / Document / Data 七类端到端垂直切片**——
文件或行情 → OPFS → Worker Pipeline → Artifact → 内容寻址缓存 → 跨刷新项目恢复。

## 仓库结构

```
├── packages/
│   ├── core/             # @bcr/core：ComputeTask / Artifact / Scheduler(Effect) / CacheKey / DAG 失效 / Pipeline
│   ├── runtime-worker/   # @bcr/runtime-worker：typed MessagePort 协议 / WorkerPool / WorkerExecutor
│   ├── runtime-browser/  # @bcr/runtime-browser：会话组装 / 共享预算 / 项目写锁 / 生命周期
│   ├── storage-opfs/     # @bcr/storage-opfs：BinaryStore 抽象，OPFS + Memory 实现
│   ├── storage-sqlite/   # @bcr/storage-sqlite：SQLite WASM 元数据引擎（Cache / 血缘 / TaskJournal）
│   ├── market-data/      # @bcr/market-data：统一市场数据契约 / stock-sdk 适配 / 缓存降级
│   ├── react/            # @bcr/react：RuntimeProvider / useSubmitTask / useTask / useArtifact
│   ├── scene-renderer/   # @bcr/scene-renderer：WebGPU/WebGL 静态场景渲染（零业务依赖）
│   ├── reader-core/      # @bcr/reader-core：出版物 / 章节 / Locator / 搜索契约
│   ├── document-core/    # @bcr/document-core：文档格式 / 阶段状态 / 跨工作台 handoff 契约
│   ├── docgen-core/      # @bcr/docgen-core：账单模板 / 条码 / 水印 / 实拍合成
│   ├── data-core/        # @bcr/data-core：表格 / Schema / 类型推断 / Canonical 数据契约
│   ├── graph/            # @bcr/graph：计算图模型与 React 画布
│   ├── reader-studio/    # Reader Studio——多格式本地阅读、全文搜索与进度恢复（库）
│   ├── document-studio/  # Document Studio——Ingest / Extract / OCR / Translate 流水线入口（库）
│   └── data-studio/      # Data Studio——CSV / JSON / NDJSON 表格探索与导出（库）
├── apps/
│   ├── studio/           # BCR Studio 工作台 UI（Dockview + Tailwind 4 + Base UI）
│   ├── media-studio/     # Media Studio · Subtitle——第一个上层应用（§0 孵化策略）
│   ├── quant-lab/        # Quant Lab · Strategy Workbench——第二类 workload 验证
│   ├── market-board/     # Market——行情 / 行业 / 历史宽度 / 自选研究
│   ├── manga-studio/     # Manga Studio——漫画 OCR / 翻译 / 清理 / CJK 排版审校
│   └── docgen-studio/    # DocGen Lab——虚构账单生成
├── crates/
│   └── kernels/          # bcr-kernels：wasm-bindgen kernel（流式 BLAKE3 / RMS / Peak）
├── examples/
│   └── demo/             # 最小垂直切片 demo（Vite+ + React 19）
└── scripts/              # 单元外的真实浏览器走查（Playwright）与共享 harness（scripts/lib/）
```

> `apps/` 只放**可独立启动**的 Vite 应用（含 `index.html`）；只通过包 `exports` 被 Studio 壳以
> `lazy(() => import("@bcr/xxx-studio/app"))` 挂载、没有独立入口的工作台归属 `packages/`。
> 工具链配置集中在根 `vite.config.ts`（format / lint / test / 任务图），单 workspace 的
> `vite.config.ts` 只保留端口、插件与 COOP/COEP 等应用专属配置。

与架构文档的对应关系：

| 架构                                  | 实现                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| §2 ComputeTask / §3 ArtifactRef       | `packages/core/src/schema.ts`（Effect Schema）                                              |
| §3 DAG：cancel descendants / 下游失效 | `packages/core/src/scheduler.ts`（cancel 级联、invalidateArtifact）                         |
| §3 DAG 正向编排                       | `scheduler.submitPipeline`（命名端口绑定 + 上游完成自动触发 + fail-fast）                   |
| §6.1 Effect 调度语义                  | Scheduler：cancel / timeout / retry(Schedule) / progress Stream                             |
| §5 Resource Manager                   | 线程/内存/GPU 多维预算；FIFO 排队、取消释放、超额快速失败、占用快照                         |
| §6.2 typed MessagePort 协议           | `packages/runtime-worker/src/protocol.ts`（Effect Schema 编解码）                           |
| §5 Worker 生命周期 ≠ Task 生命周期    | `WorkerPool` 可取消等待、关闭传播、min/max 按需扩容与 idle timeout 自动收缩                 |
| §7 Content-Addressed Cache            | `cacheKey = BLAKE3(ordered(port + artifactHash) + operation + config + runtime)`            |
| §7 Artifact 内容身份                  | 源文件流式 BLAKE3；派生 JSON/波形携带内容 hash 并写入不可变路径                             |
| §7 缓存持久化（刷新不重算）           | `packages/storage-sqlite`：cache_entries 表 + 血缘（task_outputs / dependencies）           |
| §4/§8 OPFS + 窗口流动                 | `BinaryStore`（readRange/putStream/size），kernel 按 4MB 窗口读取                           |
| Artifact 生命周期可观测性             | `ArtifactStore.inventory/usage`：跨后端容量清单、前缀过滤与稳定聚合，不读取内容             |
| Artifact 可恢复读取                   | `ArtifactStore.getBlob`：OPFS 原生 Blob 快照，内存后端自动回退，避免 handoff 依赖 File 句柄 |
| Artifact 安全 GC                      | `planCleanup/reclaim`：血缘 + 显式根保护、dry-run、path/size 二次校验后再回收               |
| Cache / TaskJournal 保留策略          | Scheduler 维护入口：缓存 30 天 / 200 条、历史 90 天 / 500 条，终态与竞态二次校验            |
| Workspace 全局搜索                    | `@bcr/core` 轻量索引契约：按 source 增量替换、中文/英文词项匹配、SQLite 元数据持久化        |
| §8 SQLite WASM 元数据                 | `openSqliteDb`（整库字节经 BinaryStore 落 OPFS，可换任意 BinaryStore）                      |
| §8 TaskJournal / 崩溃恢复             | queued/running/终态写穿 SQLite；输入完整时重放，缺失时转 blocked                            |
| §9.1 wasm-bindgen kernel              | `crates/kernels`（wasm32-unknown-unknown）                                                  |
| §10.1 WebGPU 探测降级                 | `apps/media-studio`：ASR device=auto（GPU→WASM 静默降级）/显式选择；headless 走 WASM        |
| §10.2 Whisper ASR                     | transformers.js ONNX（q8 / webgpu fp32+q4），失败回退演示引擎                               |
| 文本翻译                              | opus-mt（英↔中方向可选）：逐条 cue 批量平移，1:1 对齐，无二次音频推理                       |
| §14 Quant workload                    | ClickHouse / Arrow → Rust/WASM 多股票回测与参数研究                                         |
| Market Atlas                          | stock-sdk / ClickHouse → 行情 / 行业 / Rust 每日宽度 → OPFS 冻结快照与 Quant 引用交接       |
| Document Studio                       | DocumentJob / Stage 状态机 → 本地导入 / 格式边界 / Reader·Manga handoff                     |
| Data Studio                           | CSV / JSON / NDJSON → Worker 解析 → Canonical Table Artifact → Schema / 搜索 / 导出         |
| §11 COOP/COEP                         | `apps/studio/vite.config.ts` 与 `apps/media-studio/vite.config.ts` 内置                     |

## 命令

```bash
bun install            # 安装依赖（版本统一由根 package.json 的 catalog 提供）
bun run build:wasm     # 构建 kernels、Quant 与 Agent WASM（首次或 Rust 变更后）
bun run test           # vp test：全部单元测试
bun run check          # vp check（format + lint）+ tsc 全仓类型检查
bun run typecheck      # 仅类型检查（单一 tsconfig.json 覆盖所有 workspace）
bun run demo           # 启动 demo（examples/demo）
bun run studio         # 启动 BCR Studio 工作台（apps/studio）
bun run media          # 启动 Media Studio · Subtitle（apps/media-studio）
bun run quant          # 启动 Quant Lab · Strategy Workbench（apps/quant-lab）
bun run markets        # 启动 Market Atlas（apps/market-board）
bun run manga          # 启动 Manga Studio（apps/manga-studio）
bun run docgen         # 启动 DocGen Lab（apps/docgen-studio）
bun run build:cloudflare  # 构建 WASM + BCR Studio 静态产物
bun run deploy:cloudflare # 部署 apps/studio/dist 到 Cloudflare Workers
cargo test --manifest-path crates/kernels/Cargo.toml
bun run test:browser   # 自动启停 dev server，3 组并行运行 26 个核心浏览器检查
bun run test:browser:full # 运行全部 79 个浏览器检查
bun run test:ci        # 验证浏览器分组和命令行选择
bun run test:pwa       # 使用已构建的 apps/studio/dist 验证生产版 Reader 离线与更新
bun run test:pwa:knowledge # 使用已构建的 apps/studio/dist 验证生产版 Notes 独立 PWA（/notes/）
```

`bun run dev` / `bun run studio` 是唯一的工作台入口：Reader / Document / Data Studio 位于
`packages/`，作为库被 Studio 壳在 `/reader`、`/documents`、`/data` 路由下懒加载，没有独立
dev server。走查脚本位于 `scripts/`，共享的浏览器与路径 helper 在 `scripts/lib/`。

架构边界（`packages/core` 只能依赖 storage、`runtime-worker` / `runtime-browser` 的分层、
跨包不得直接 import 另一个包的 `src/`）由根 `vite.config.ts` 的 `lint.overrides` 中
`no-restricted-imports` 强制，不再需要单独的手写 AST 校验脚本。

GitHub Actions 的 push / PR 流程保留全仓格式、类型、单元测试、Rust/WASM、ClickHouse 导出边界和
Studio 生产构建。浏览器检查按 workspace / quant / reader 三组并行，覆盖 26 个核心流程，
包括回测、图表事件、实验与滚动验证、附件与恢复、Worker 和会话隔离；Reader 与 Notes 的生产
PWA 离线检查也保留。每个检查记录耗时，失败时上传截图与日志。

全部 79 个浏览器检查、各应用 PWA 安装矩阵、独立应用与 demo 构建、原生 ClickHouse 集成和
上游 Agent Runtime 全量测试移到手动完整检查：GitHub Actions → CI → Run workflow → 勾选 `full`，
或执行 `gh workflow run ci.yml -f full=true`。重复的布局、分页和格式组合检查不再延长每次提交的反馈时间。
本地可用 `bun run test:browser --group=quant` 只检查一个分组，`--list` 查看计划；
已有开发服务时，设置 `BCR_VERIFY_STUDIO_PORT=5317 BCR_VERIFY_MEDIA_PORT=5320` 使用独立端口，
三个 Studio 分组依次使用 5317、5318、5319。浏览器档案按本次运行隔离，只清理本次创建的目录。

## BCR Studio（apps/studio）

工作站式 UI，遵循「DOM → interaction · React → composition · Canvas → visualization · Worker → rendering/compute · WASM → algorithms」的分层原则：

- **Dockview 8**：dock / split / drag / floating / popout 布局，JSON 持久化到 localStorage
- **Tailwind 4 + 原生 CSS variables tokens**：Rhea 风格高信息密度暗色主题（IBM Plex Sans/Mono）
- **Base UI**：命令面板（⌘K）等 headless 交互原语；本地 shadcn 风格组件源码（Button/Badge/...）
- **TanStack Router**：选中文件/任务在 URL search（`?file=&task=`），链接可恢复 workspace view
- **自动隐藏全局导航**：主页保留完整顶栏，进入 App 后收起全局栏，释放 56px 高度，各 App 操作栏保持可见。
  悬停或点击顶部短线、聚焦入口后按 Enter，或使用 Alt + 反引号展开导航浮层；离开后自动收起，也可用 Esc 或收起按钮关闭。
  菜单、对话框和键盘焦点正在使用导航时保持展开；展开/收起不改变 App 视口，回测会话与阅读分页保持稳定。
  浏览器走查：`bun run test:browser:navigation`（通过 `BASE_URL` 指定已启动的 Studio 服务）。
- **TanStack Virtual**：项目文件 / 任务历史 / 控制台日志全部虚拟化
- **OffscreenCanvas**：波形由 `render.worker` 在 Worker 内绘制，主线程零图形负载
- **SQLite WASM 持久化（§8）**：元数据库落 `opfs://studio/project/meta.db`——缓存条目、任务血缘、
  文件列表与 TaskJournal 全部跨刷新保留；异常退出遗留任务在输入 Artifact 完整时自动重放，输入缺失则标记
  `blocked`；导入 → 计算 → **刷新浏览器 → 历史恢复、重跑直接缓存命中**（`node scripts/verify-persistence.mjs`）
- **Artifact 存储可观测性**：全局导航「工作区选项 → 存储与运行状态」展示本地 Artifact 对象数与容量；统计按 30 秒低频刷新，
  也可手动刷新，清单查询只访问 OPFS/Memory 的路径和 size，不读取大对象内容。
- **Storage Plane 面板**：Studio 的「存储」Dock tab 集中展示 Artifact 后端分布、项目源文件、最近产物及
  Cache / TaskJournal 保留候选；面板只读，治理动作统一从 ⌘K 命令进入。
- **Workspace 全局搜索**：顶栏「搜索」或 ⌘⇧F 呼出；文件、任务、阅读章节、文档流水线、漫画页面、字幕、数据集和
  全球市场标的共用同一索引，结果携带摘要并通过深链回到对应工作台。
- **可追溯资料集合**：全局搜索 →「资料集合」创建主题集合，在搜索结果中通过鼠标悬停或键盘选择正文，
  点击「保存当前结果」收集 Reader 正文片段、Document 原文/译文和 Media 时间段字幕；同一正文快照自动去重。
  集合支持正文/来源/笔记筛选、显式保存笔记、移除摘录和带来源链接的 Markdown 导出；所有修改在 SQLite
  写入成功后才发布，失败可重试，损坏集合不会被空数据覆盖。刷新后可恢复集合与笔记。
- **精确引用与来源核验**：Reader / Document / Media 的正文结果保留实际命中的原始 UTF-16 范围，
  兼容全角字符、组合字符与连续空白；重复出现分别列出。保存时截取命中句子或有界上下文，记录原文、
  前后文、来源身份和 BLAKE3 正文版本，同文不同位置的引用不会互相覆盖。Reader 回跳高亮命中正文，
  Document 分别定位原文/译文 block，Media 按当前字幕重新核验并选中字幕行，时间编辑后可重新定位。
- **来源状态**：集合显示可定位、内容已变化并已重新定位、多处匹配、正文变化、来源缺失或待核验。
  磁盘恢复的索引只有在所属应用重新发布后才视为当前内容；旧版摘录继续保留并明确标记未核验。
  来源变化时只接受唯一正文匹配，重复内容不能被前后文区分时不猜测位置；修改或删除原文后提示核对。
  Reader 重叠索引片段在核验时拼接，避免正文移动到片段边界造成误判。引用与版本信息随 Markdown 导出，
  导出文件不打包源文件，链接需要在保留对应本地资料的浏览器与同一站点中打开。
  本版仍使用关键词检索，尚未接入向量模型或生成式问答。引用契约见 [资料引用](docs/RESEARCH-CITATIONS.md)。
- **Artifact 安全清理**：⌘K →「清理未追踪 Artifact」先展示 dry-run 候选，只有用户显式确认才执行；
  当前项目源文件和已有血缘对象默认保留，执行前重新核对路径与字节数，竞态对象自动跳过并写入日志。
- **缓存与历史保留**：⌘K →「整理过期缓存与历史」按 30 天 / 90 天 TTL 及 200 / 500 条上限生成计划；
  只删除缓存索引和已结束任务日志，不触碰 Artifact 内容，运行中的任务与执行中的缓存 key 自动保护。
- Runtime 接线：compute.worker 提供 `hash.blake3`（流式 BLAKE3）与 `audio.waveform`（2048 桶峰值包络）两个 WASM operation，任务进度 / cache hit / 取消直接投影到 UI

截图走查脚本：`node scripts/screenshot.mjs`；持久化闭环走查：`node scripts/verify-persistence.mjs`；
存储治理走查：`node scripts/verify-storage-cleanup.mjs`
（均需先 `bun run studio` 起 dev server，Playwright 驱动真实浏览器验证）。
资料集合走查：`node scripts/verify-research.mjs`，使用隔离浏览器验证跨格式摘录、笔记、导出、刷新恢复、
命中高亮、字幕时间修改/正文改写/源项目清空后的核验、重复引用跳转和移动端布局，已纳入浏览器 CI。

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

Quant Lab 默认打开股票组合研究工作台，可在顶部切换「股票组合 / 永续趋势」。
永续趋势入口为 `/quant?strategy=trend`：直接获取 Binance 官方 USDT 永续历史档案，在 Rust/WASM 中逐分钟回放。
新回测默认「4 小时 / 仅做多 / 日线背景过滤」，使用 20 根突破与 10 根反向通道退出；保留无过滤基线，两种方案均保留当前成本门槛、成交费用和风控。背景过滤不能排除所有震荡，可能错过启动行情，也不保证收益提升。旧的未标记无过滤突破草稿只迁移一次，历史运行保持原样；之后明确选择无过滤会在刷新后保留。
结果包含费用、资金费、冻结入场信号、此前 N 根通道及按持仓分段的止损线；回测执行器 v8 与图表 `trend-chart-2` 使用独立缓存版本。详情见 [策略与数据口径](docs/BINANCE-TREND.md)及[研究架构](docs/TREND-RESEARCH-ARCHITECTURE.md)；现有十候选比较见[方法研究](research/trend/methods/REPORT.md)，早期失败假设见[历史研究](research/trend/REPORT.md)。旧证据保留，新研究使用显式计划和独立输出目录。

```text
ClickHouse / 本地研究快照 → 分块 Arrow → Rust/WASM 逐日回放 → 净值 / 成交 / 持仓 / 选股解释
                                      └────── OPFS 数据缓存 + SQLite 运行历史
```

- 浏览器直连只读 ClickHouse，或导入 `manifest.json` 与全部 Arrow 分片；首次启动提供明确标记的演示数据，回测由用户发起
- 单次回测与参数实验共用 Runtime、WorkerPool、内容寻址缓存及 Rust 计算引擎
- 参数草稿与冻结运行快照分离，支持净值/回撤图、完整成交筛选、持仓/调仓明细、选股解释、参数网格与稳健性验证
- 净值图按日标记调仓、风控、决策与拒单；点击事件或证券打开快照 K 线，买卖箭头与回测成交口径对齐，联动成交表、每日账本和信号日解释
- 数据、草稿和历史跨刷新恢复；同区间运行可添加对照，移动端通过设置抽屉操作
- Market 的行业宽度与 Quant 共用冻结研究快照，只传递内容引用和观察日期，无需重复下载

详情见 [JSG 文档](crates/quant/README.md)。走查：`node scripts/verify-quant-lab.mjs` 验证默认入口、回测与刷新恢复；
`bun run test:browser:jsg` 验证完整研究流程，数据库集成使用 `bun run test:browser:jsg:clickhouse`。
`bun run test:browser:quant:charts` 验证事件标记、价格口径、面板联动、窄屏和离线快照读取。

## Market Atlas（apps/market-board）

第四个 keep-alive 应用以实时、持续更新的 market-data workload 补充 Quant Lab 的批量计算链路：

```text
stock-sdk (CN / HK / US / Global Futures)
             ↓
@bcr/market-data canonical snapshot + landscape + daily OHLCV history
             ↓
live delayed / partial / cached / demo quality states
             ↓
Market Atlas · 行情 / K 线 / 自选 / 行业宽度
                                    └──── 冻结宽度快照 → Quant Lab
```

- `stock-sdk@2.4.2` 只存在于数据适配层；UI 不直接依赖第三方返回类型，后续可组合欧洲、日本、FX 数据源
- CN / HK / US 与全球期货独立请求、独立健康状态；整体失败优先恢复 localStorage 最后快照，再显式降级 fixture
- 行情始终展示来源、更新时间与 `DELAYED / PARTIAL / CACHED / DEMO` 质量，不把公开接口标记为撮合级实时数据
- Midnight Atlas 编辑式界面提供全球交易时区轨道、市场焦点、全 A 股方向宽度、行业热图、跨资产行情、异动和持久化 Watchlist；Watchlist 支持 Core / Macro 等自定义分组，并可整组交接到 Quant Lab
- Market Cartography 通过 `sdk.batch.cn()` 扫描 5,000+ A 股，生成上涨/下跌/平盘与涨跌停广度、全市场成交额，以及领涨、领跌、成交额三类可下钻排行；行业板块与资金流独立请求并可按层缓存/降级
- Pulse 基准集扩展为 CN / HK / US 各 5 个指数与龙头标的；顶栏搜索通过 `sdk.search()` 发现三地股票、指数与场内基金，并从本地 master 发现全球期货，内置 41 个常用标的目录（含 8 个全球期货）作为即时/离线降级，并持久化最近打开标的
- 标的焦点支持 1M / 3M / 6M / 1Y / 3Y 日线 K 线、成交量与指针读数；长周期只在显示层聚合，交接仍保留完整日线
- 主要资产卡片独立加载最近最多 20 个交易日的真实收盘价，标注区间与缓存状态；优先读取腾讯近期日线，失败后切换 SDK 东方财富日线，按可见区域、最多 3 个并发加载，缓存一小时。报价刷新不重复下载历史；无真实缓存或少于 3 个有效价格时显示「暂无走势」，不生成模拟趋势
- Income Ledger 默认聚焦贵州茅台这一有完整记录的 A 股个股，使用 `sdk.reference.dividendDetail()` 展示现金分红、股息率、除权日、登记日与实施进度；实时请求失败时按最后缓存 → 明确标注的演示参考降级，HK / US / 基金尚无同口径 provider 时仍显示覆盖边界
- 行业宽度页可独立读取 ClickHouse 冻结快照，并将相同数据引用送入 Quant Lab 研究；个股行情与自选分组在 Market 内查看和管理
- 确定性模拟曲线与 OHLCV 仅出现在明确标记的演示 fixture 中，不伪装成实时历史数据

走查：`node scripts/verify-market-atlas.mjs` 需要实时网络，也可通过 `BCR_VERIFY_LIVE_MARKETS=1 bun run test:browser` 启用。
默认 CI 使用 `verify-market-trends.mjs` 的确定性数据验证日线、缓存、缺失数据与窄屏走势。

## Manga Studio（apps/manga-studio）

以一张自有演示页验证漫画翻译的完整 Artifact/DAG 边界：

```text
图片 → Normalize → Detect → OCR → Reading Order → Translate → Clean → Typeset → PNG
```

- `/manga` 已接入 Studio Shell，支持图片 / CBZ / ZIP / PDF 导入、页面预览、文本区域选择与手动编辑；归档格式会先展开为可独立重试的页面
- `@bcr/manga-studio` 声明页面清单、OCR、翻译、清理、排版和导出的 operation 目录，默认 Graph 可直接交给 `@bcr/graph` 编译
- 默认视觉路径明确标记为 **Review / 手工审校**；导入真实图片后会创建待审校区域，并通过共享 Worker 的
  `manga.ocr.review` 将区域固化为版本化 `manga/ocr-lines` Artifact，不伪装成像素识别结果；需要时可显式切换到实验性 Local ONNX
- 多页工作队列支持批量拖入、逐页切换与页级流水线状态；“处理队列”只运行尚未完成的页面，支持暂停、恢复、失败重试与队列进度，失败页会复用已完成的阶段检查点；项目配置、审校译文、队列游标和页面队列写入 SQLite，原图 artifact 写入 OPFS，刷新后自动恢复
- 项目级 Glossary 支持原文 / 固定译法的增删改与持久化；翻译阶段整句命中优先，重叠术语按最长匹配，术语变更会让所有页面回到待处理状态
- 翻译引擎可显式切换 Fixture 或实验性 Local ONNX；Local 模式使用多语 NLLB 并按日文 / 英文 / 韩文传入对应语言码，在 Worker 内支持 Auto / WebGPU / WASM，并生成 `manga/translation-lines` 审校 Artifact
- OCR / 翻译共用能力解析器：语言不匹配时明确回退 Review，WebGPU 不可用或初始化失败时回退 WASM；阶段面板持久化请求/实际适配器、设备、模型加载阶段与 CACHE 命中事实，GPU 任务同时向 Scheduler 声明资源占用
- Manga Runtime 维护 SQLite-backed Model Registry，记录模型目录版本、loading/ready/error、最近使用和最近成功加载时间；配置面板展示懒加载状态，未知或损坏的 registry 元数据不会阻塞启动
- 模型治理：Worker 通过 `manga.model.preload` 显式预加载到 `bcr-manga-models-v1` 专属 Cache API；配置面板展示文件数与在线/离线状态，可清理并同步使 readiness 失效，避免把“元数据 ready”误当成“字节仍在缓存”；同 Worker 内按模型/设备去重 in-flight 加载，并记录真实模型构建耗时；离线任务只读专属缓存，不再发起远程模型请求
- Local NLLB 翻译 Artifact 会持久化行级 telemetry（总行数、完成行数、精确术语命中与模型批大小）；阶段面板在缓存命中或刷新恢复后仍展示 `LINES / GLOSSARY / BATCH`，便于判断模型执行是否完整以及术语表的实际影响
- 每页 OCR / 审校区域会同步投影为标准 `DocumentContentPackage` 与 `DocumentTranslationPackage`，以内容寻址的 `document/manga/*` Artifact 持久化到 Manga 存储并镜像到 Studio 宿主；页面元数据保存最新引用，刷新后可继续搜索、治理或跨工作台交接
- Manga 导入入口接受带 `sourceRef` 的视觉 Export Bundle（`.json`）：先校验 canonical 契约，再从共享 Artifact 恢复原图与区域/译文，避免重复 OCR；Document → Manga handoff 也会从 contentRef/translationRef 回填区域；缺失源 Artifact 时明确失败，不生成伪页面。
- OCR manifest 同时提供 Latin TrOCR 与日文 Manga OCR（`onnx-community/manga-ocr-base-ONNX`）；模型按区域懒加载，
  在 Worker 内支持 Auto / WebGPU / WASM，结果统一标为 `needs-review`；识别出的文本、方向、几何和置信度会按原 block ID 回写审校区域；不匹配的语言会显式告警而不会伪装成已验证能力
- 当前 MVP 支持原图 / 清理页 / 译文页切换、置信度审阅、CJK 排版参数和 PNG 导出；清理阶段会输出可追溯区域掩码，Inpainting 请求在适配器就绪前明确回退 Fill；CBZ/PDF 会先展开为页面队列
- 操作契约与 DAG 回归位于 `apps/manga-studio/tests/operations.test.ts`

## Document Studio（packages/document-studio）

Document Studio 是跨内容工作台的入口层，先把“文件已经进入哪一个阶段、下一步应该交给谁”做成可观测状态，
再逐步替换本地适配器与真实模型：

```text
File → Ingest → Normalize → Extract → OCR → Translate → Typeset → Export
                                      ↘ Reader / Manga handoff
```

- `packages/document-core` 定义 `DocumentJob`、七阶段状态机、格式识别、能力边界，以及版本化的
  `DocumentContentPackage`（Block / Metadata / Provenance）契约；未接入的模型阶段显示为
  `PLANNED / BLOCKED`，不会把演示结果伪装成生产结果。
- Content Package 在创建与恢复边界会重新编号重复 block ID，保持确定性主键，避免翻译、审校和全局搜索因异常适配器输出互相覆盖。
- Document Inbox 支持 TXT / Markdown / HTML / DOCX / FB2 / EPUB / PDF / CBZ / 图片导入，元数据保存在本地浏览器；
  文本提供安全的轻量预览，图片只在当前标签页创建临时预览 URL。
- Text / Markdown / HTML / FB2 已可通过共享 Scheduler + WorkerPool 运行 Extract、fixture Translate 与 Typeset
  preview；Extract 产出可校验、可迁移的 `document/content-package` JSON Artifact，每一步都支持缓存、进度、取消和重试。
- 图片任务现在可在 Document Inspector 中选择 Latin TrOCR 或日文 Manga OCR，直接运行 `document.ocr.onnx`：模型在共享 Worker 内懒加载，整页结果投影为带 geometry / writingMode / confidence 的 canonical Content Package，并可继续进入 Translate；复杂多区域版面仍建议交给 Manga。文本格式会明确跳过 OCR，避免把视觉能力误套到纯文本上。
- 图片 OCR 结果提供轻量 source-text review：修订只替换 block 文本、不破坏区域几何，保存为新的 `document.ocr.review` Content Package，并自动使下游翻译、排版和导出失效。
- OCR 设置支持显式预热模型：通过共享 `manga.model.preload` Worker Task 写入同一浏览器模型缓存，重复点击按模型/语言/设备去重；离线缺失模型或语言不匹配会在预热阶段直接报告。
- 每个阶段会持久化 operation、runtime（JS/WASM/WebGPU）和 cache hit/miss，Inspector 与刷新后的任务详情都能解释一次执行是计算、缓存还是失败重试。
- 阶段依赖按 DAG 失效：重新 Extract / OCR 会清理下游 Translation、Typeset、Export 的投影引用，人工修订译文也会让 Typeset / Export 回到待运行；旧 Artifact 仍保留在本地，可审计或重新命中缓存。
- Translate 会把每个 source block 映射为同 ID 的 `document/translation-package`，同时保存目标语言、审校状态和
  Provenance；Typeset 只消费该契约，因此后续接入真实模型时无需改动 UI / 排版输入。
- Inspector 提供前 5 个 block 的快速审校；人工修改会生成新的不可变 Translation Package Artifact，保留原始产物并让
  Typeset 自动接续最新版本。
- Content Package 可从 Document Inspector 导出为保留完整契约的 JSON，或导出带来源/译文视图的 Markdown；导出结果先写入本地 `document/export/*` Artifact，再触发浏览器下载，便于追踪、重放与跨工作台消费。`decodeDocumentExportBundle` 会校验版本、Content/Translation provenance 与 block ID 归属。
- Document Inbox 同样接受 JSON Export Bundle：严格校验后从 bundle 的 `sourceRef` 恢复源文件与 Content/Translation 状态；Bundle 只在原始 source Artifact 仍可用时可恢复，跨浏览器缺失源文件会明确报错。
- EPUB / PDF / CBZ / DOCX 等二进制出版物在 Document Extract 阶段明确保持 `BLOCKED`，直接交给目标适配器解析，避免把压缩或版式数据误当作纯文本。
- Reader handoff 会优先把同一标签页内的 `File` 与已完成的 Content Package 作为零拷贝 fast path 交给 Reader；同时把源文件、规范化内容和审校译文的 `ArtifactRef` 写入轻量 marker，刷新后由宿主 ArtifactStore 重建 Blob，再由 Reader 写入自己的 OPFS 并建立 Worker 索引。若已有 Translation Package，则以同一 block ID 渲染审校后的译文，未完成 Extract 时自动回退到原文件解析；图片 handoff 交给 Manga，由 Manga 的 Artifact / SQLite 项目接管。Reader 也可以把已解析的章节、导航和安全 HTML 投影回 `DocumentContentPackage`，Manga 则把 OCR 区域、译文和几何信息投影回同一契约；两者镜像源文件与内容 Artifact 后返回 Document，Extract / Translate 直接标记完成，Manga 的视觉 provenance 还会将 OCR 阶段标记为已由适配器完成，形成可刷新恢复的双向闭环。
- URL 只携带短期 handoff ID，不携带文件内容；marker 只保存可验证的元数据和 Artifact 引用。旧版仅含 File 的 marker 仍可识别，但会明确提示重新导入；新的 durable handoff 可跨刷新恢复。
- Document Inbox 以源 Artifact 的 BLAKE3 hash 做幂等键；Reader / Manga 重复交接会复用已有任务并只合并新的 DONE 阶段，避免重复任务和状态回退。
- Workspace Search 的 Reader section、Document block 与 Manga region 结果都携带稳定深链（`section` / `block` / `region`）；打开结果后会直接恢复对应上下文，减少在长文档或页面列表中二次定位。

走查：`node scripts/verify-document-studio.mjs`（由 `bun run test:browser` 自动执行）。

## Reader Studio（packages/reader-studio）

Reader Studio 是一个离线优先的多格式阅读垂直切片：

```text
TXT / Markdown / HTML / DOCX / EPUB / PDF / CBZ
              ↓ Adapter / Content Package
Publication → Section → Locator / SearchHit
              ↓
       OPFS 源文件 + SQLite 元数据 / FTS5
```

- `packages/reader-core` 定义格式无关的 `ReaderBook`、章节、Locator、进度和搜索契约；Locator v2 在兼容旧版章节百分比的同时支持受限的 TextQuote/TextPosition 锚点，解析差异留在 Adapter 边界。
- 章节正文的规范化索引通过 `reader-index.worker` 运行在可复用 `WorkerPool` 中，主线程只保留轻量 Locator/UI 状态；Worker 不可用时自动回退 SQLite/内存搜索。
- 文本类（含 FB2）、DOCX（WordprocessingML）、EPUB、PDF（PDF.js）和 CBZ（zip.js）均可直接导入；未知格式会明确提示，不把损坏内容伪装成可读文本。
- Reader Format Catalog 统一维护扩展名、MIME、能力标签和文件选择器 accept；DOCX 首版按正文、标题与表格进入统一 Section 模型，绘图仍保持明确的文本优先边界。
- HTML / EPUB / FB2 正文保留字体、颜色、间距和对齐等常用内联排版；脚本、外链、资源 URL 与定位类 CSS 在 Adapter 边界统一剥离。
- 书库、主题、字号、布局和每本书的阅读位置写入 SQLite；源文件按 BLAKE3 内容地址写入 OPFS，刷新后重建 PDF/图片 URL。
- 搜索优先使用 Worker 规范化索引，索引尚未完成时使用 SQLite FTS5 trigram，短查询或旧环境再回退到内存索引；搜索结果携带章节、原文 UTF-16 偏移和上下文，点击后精确滚动到首个高亮命中，兼容全角字符与空白差异。
- 连续阅读布局利用浏览器原生 `content-visibility` 与 intrinsic size 跳过远端章节的布局和绘制，同时保留章节锚点与滚动几何；PDF 页面继续按视口懒渲染，长文档不会一次性触发全部可视化开销。
- 阅读态采用宽内容列、纸张/松石/夜间主题、连续/分页布局和响应式书库侧栏，支持拖拽批量导入与 `⌘/Ctrl+F`。
- 工具栏支持将当前出版物交回 Document Studio；交接只携带短期 ID，源文件按 BLAKE3 地址镜像到宿主 ArtifactStore，章节 ID、HTML、页码和元数据保持不变。
- Reader 文件入口同时接受经过校验的 Document Export Bundle（`.json`）；文本包会直接重建 Section 与译文，不重复运行格式解析器，视觉包则明确引导回 Manga Studio。

走查：`node scripts/verify-reader-studio.mjs`（由 `bun run test:browser` 自动执行）。

## Data Studio（packages/data-studio）

Data Studio 是面向本地数据文件的轻量表格工作台：解析和预览都在共享 Runtime 的 Worker 中完成，UI
只消费版本化的 Canonical Table Artifact，不把大文件解析或状态堆在主线程。

```text
CSV / JSON array / NDJSON
            ↓
   OPFS source Artifact
            ↓
  data.parse.table · Worker
            ↓
Canonical Table Package → Schema / search / sort / export
```

- `packages/data-core` 定义格式无关的 `DataTablePackage`、列类型（TEXT / NUMBER / BOOL / DATE / EMPTY）、空值统计和严格恢复解码；重复列名、缺失字段与混合值在契约边界确定性归一化。
- Data Studio 通过 BLAKE3 内容寻址保存源文件，解析任务共享宿主 Scheduler / WorkerPool，并以 `data/table` Artifact 保存结果；16 MiB 以上文件先展示有明确 `sampled` 标记的预览，不破坏原始源文件。
- Data Asset Catalog 将多次导入统一为内容寻址资产记录（格式、大小、行列数、采样状态、最近打开时间与源 / 表 Artifact 引用）；可在资产卡片间切换，刷新后优先恢复最近打开且仍可读的表。
- Storage / Govern 面板复用 ArtifactStore 的 inventory / plan / reclaim，只对 `data/` 命名空间显示容量和未引用候选；目录根与其它工作台对象自动保护，确认回收后才删除孤儿 Artifact。
- 表格支持跨列搜索、点击列头排序、Schema 类型与空值提示，以及 Canonical JSON / RFC 4180 CSV 导出；刷新后只从 SQLite 元数据中的 Artifact 引用恢复，不重复读取或解析源文件。
- 全局 Workspace Search 将目录中的每个资产注册为 `dataset` 结果，深链 `/data?query=…` 可直接恢复筛选上下文；从目录清除只移除资产引用，原始 Artifact 仍可由存储治理统一回收。

走查：`node scripts/verify-data-studio.mjs`（由 `bun run test:browser` 自动执行，覆盖 JSON / CSV / NDJSON、搜索、排序、导出、深链与刷新恢复）。

## 资料集合备份与搜索基准

全局搜索支持按集合查找已保存笔记与摘录，并打开卡片高亮命中；草稿不进入索引。「资料集合」支持集合管理、个人笔记草稿恢复，以及 JSON 集合备份/导入预览。可选择包含未保存草稿；冲突集合保留为副本，重复导入跳过相同内容。备份 v1 不含源文件，跨浏览器回跳仍需对应本地资料。契约与边界见 [资料引用与备份](docs/RESEARCH-CITATIONS.md)。

需要跨浏览器恢复原文时，可使用「Reader 完整资料包」：选择集合，检查原始和修订引用的源文件，再下载带哈希清单的 ZIP。导入先预览、再恢复 Reader 资料并合并集合，保留原始引用与笔记，支持重复导入及失败重试。使用方式与边界见 [Reader 资料包](docs/RESEARCH-PACKAGE.md)。

启动 `bun run studio` 后，运行 `bun run bench:search` 生成真实 Chromium 的中英文搜索基准，报告位于 `scripts/shots/search-benchmark.json`。可用 `BCR_BENCH_SIZES=100,1000,5000` 指定规模；测量方法见 [搜索性能基准](docs/SEARCH-BENCHMARK.md)。

## Cloudflare Workers 自动部署

仓库使用 Wrangler 的 Static Assets 模式把 `apps/studio/dist` 作为一个 SPA Worker 发布；`/studio`、`/reader`、`/data`
等客户端路由在边缘侧回退到 `index.html`，因此刷新深链不会返回 404。配置位于根目录的 `wrangler.jsonc`。

- 本地发布：先运行 `bun run build:cloudflare`，再运行 `bun run deploy:cloudflare`；Wrangler 版本固定在根 `package.json`，避免 CI 与本地配置漂移。
- GitHub Actions：`main` 的 push 会先通过现有 validate + Chromium 回归，随后复用已验证的 `studio-dist` Artifact 部署；PR 不会触发生产部署。
- 在仓库 Settings → Secrets and variables → Actions 中配置 `CLOUDFLARE_API_TOKEN`（仅 Workers 部署权限）和 `CLOUDFLARE_ACCOUNT_ID`。未配置时部署 job 会明确 warning 并跳过，不影响验证 job。
- API Token 不写入仓库；Cloudflare 官方建议在非交互 CI 中使用 API Token + Account ID，并通过 `wrangler deploy` 发布 Worker。

相关文档：[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[Workers Static Assets SPA](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)。

## Demo 验证路径

1. 选择文件 → 写入 OPFS（FileArtifact）。
2. 提交 `hash.blake3`（wasm runtime）→ compute.worker 分块读取、流式哈希、回报 progress。
3. 同一文件再次提交 → 缓存命中（界面标注，未重算）；换文件/换操作 → 重算。
4. 运行中可取消（级联语义见 core 测试）。
5. 刷新浏览器 → 文件列表与任务历史恢复、异常中断任务安全重放、再次提交直接缓存命中。

## 本版明确不做

WIT Component Model、插件 capability 模型、Worker 崩溃健康替换、多资产优化与跨序列 Worker
pipeline、SIMD/多线程 Quant kernel、Vitest Browser Mode、跨设备任务迁移。
对应架构文档 Phase 1 后续与 Phase 2/3。
