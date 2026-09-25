# 当前 Runtime 架构

本文描述已实现的运行边界。`ARCHITECTURE.md` 保留产品方向和路线图；具体接入以本文及包导出的类型为准。

## 所有权

```text
Studio Shell
  └─ RuntimeHost：共享资源预算、会话注册、容量汇总、整体关闭
       ├─ Studio Session：Document / Data / Manga / 通用 kernel
       ├─ Media Session：媒体解码、ASR、字幕
       └─ Quant Session：信号、回测

每个 Session
  ├─ Scheduler → 共享 ResourceManager
  ├─ ArtifactStore → 独立命名空间
  ├─ Metadata / Cache / Lineage / Journal
  └─ ExecutionModule → WorkerPool 或主线程执行器
```

`@bcr/core` 定义框架无关的 `RuntimeServices`、`RuntimeSession` 和 `RuntimeHost`。`@bcr/runtime-browser` 提供唯一的浏览器计算会话组装入口 `createBrowserRuntime`，负责构造服务、初始化失败回收和幂等关闭。

领域会话的存储隔离与宿主的全局调度预算是两个独立维度。Media、Quant 嵌入 Studio 时继承宿主资源管理器；独立启动时创建自己的 Host。顶栏状态点浮层（运行时/存储明细）的容量汇总覆盖当前 Host 注册的计算会话，而不是只观察 Studio 的 ArtifactStore。

Reader 保留面向阅读首屏的延迟解析、索引和 SQLite 初始化流程，其专用解析／索引 Worker 尚不经过计算 Scheduler。它的独立阅读存储不属于上述 Host 的容量汇总；现在通过同一 `acquireProjectLease` 契约持有 `reader` 命名空间的独占写锁。第二个页面在恢复书库和发布可编辑界面之前失败，关闭原页面后可重试。卸载时串行完成保存队列、关闭元数据、阻止过期存储调用并排空已接受的操作，最后释放锁。浏览器缺少 Web Locks 时显示明确错误，不启用不安全的多页写入降级。

阅读界面的分页、按需恢复和 PDF 资源生命周期见 [Reader 架构](./READER-ARCHITECTURE.md)。

## 执行模块与数据接口

执行器显式声明支持的 operation。Registry 按 `(runtime, operation)` 解析，重复路由在组装时失败。同一 WASM 后端可以有多个领域执行器。

`runtime` 表达计算后端，不表达线程位置。普通文档提取、表格解析、人工 OCR 结果固化、清理预览标记为 `js`，但仍可由 Worker 执行。Studio 的路由清单位于 `compute-contract.ts`，Worker handler 表通过该联合类型检查完整性。

计算实现由领域应用的 `./compute` 导出。Studio Worker 只创建数据接口、组装领域模块并注册 handlers。领域模块接收 `ArtifactIO`，不硬编码 OPFS 命名空间；同一实现可以注入 MemoryStore 进行测试。

`@bcr/runtime-worker` 负责协议、WorkerPool 和通用 Artifact IO，不包含字幕、漫画、文档等领域规则。Worker 收到命令后进行 Schema 解码。正常完成的 Worker 回池复用；未收到终态就被取消的 Worker 会终止并替换，防止仍在执行的模型任务与下一任务重叠。

Media 的主线程解码独立为 `decode-executor.ts`，通过有作用域的异步迭代器接入 Effect；退出时关闭输入和未完成的流写入。

## 任务状态与完成语义

`TaskHandle.state` 提供稳定的 `getSnapshot()` 和 `subscribe()`：

```text
queued → running → completed
             └──→ failed / cancelled
queued ─────────→ cancelled
```

任务排队、进度及终态由 Scheduler 维护。React 的 `useTask` 使用 `useSyncExternalStore`，组件晚挂载也能读取已经完成的任务。

Executor 的 completed 只代表计算产出。Scheduler 按顺序完成产物血缘、缓存、TaskJournal 提交后，才更新完成快照和发布完成事件。提交异常转为 failed，不能先向 UI 宣告成功。事件流用于进度和增量 chunk；它不是可重放的状态存储。需要等待结果的业务代码使用 `handle.await`。

关闭时停止接收任务，等待正在提交的请求退出，再取消所属流水线和任务，释放资源预算，关闭执行模块和元数据库，最后释放项目写锁与 Effect Scope。

## 持久化

计算会话通过 Web Locks 持有命名空间级单写者租约，第二个标签页打开同一计算项目会显示错误，关闭前一个会话后可重开。此策略不提供多标签页协同编辑。

SQLite 当前仍使用内存数据库与整库快照。并发 persist 在导出开始前合并；导出过程中发生的新写入安排下一次快照，避免遗漏。`PRAGMA user_version` 显式记录 schema 版本并拒绝未知版本。未来添加结构变更时需要显式迁移。

浏览器计算入口要求 OPFS；不再声明宿主使用 MemoryStore 后 Worker 就能自动降级。测试和无 OPFS 的自定义执行模块可以显式注入 BinaryStore。元数据初始化失败可通过回调报告并使用内存缓存／日志；二进制数据与元数据的可用性分别处理。

## React 与应用集成

`useRuntimeSession` 负责会话创建、初始化错误、继承宿主与卸载释放。Shell 和内嵌应用共用 `RuntimeProvider`，没有第二套 ServicesContext。

Media、Quant 在自身数据初始化完成后发布搜索文档；宿主不导入它们的内部 store，也不解释字幕或回测对象结构。领域应用通过共享的 SearchIndex 契约贡献内容。

顶栏和启动台读取通用运行数量投影。Media、Quant、Manga 通过 `usePublishRunningCount` 主动上报，宿主不依赖其 store 或领域状态结构。

`RuntimeActivity` 单独表达当前应用是否激活。隐藏应用仍可保留组件状态和后台计算，Market 自动轮询则在应用隐藏时暂停。活动状态不会隐式取消计算任务。

## 验证与扩展

### 宿主插件、导航和全局助手

`AppManifest` 只声明工作区页面；全局工具使用 `PanelManifest`。AI 助手由 Shell 的唯一浮动面板承载，启动台、命令面板和快捷键不会切换当前领域；旧 `/assistant` 地址只作为兼容入口，打开面板后替换为首页地址。

领域服务通过 `WorkspacePlugin.activate({ runtime, agent, reportError })` 注册，返回幂等释放函数。宿主启动时统一激活 manifest 声明的插件，拒绝重复 ID，初始化同步失败时逆序回收已经激活的插件。知识库搜索投影与 Agent 能力不依赖知识库页面是否打开；异步初始化错误通过宿主报告，不再静默吞掉。

Shell 持有独立的 AgentHost，通过 `AgentProvider` 注入能力、编辑目标和会话管理器，不使用模块级执行单例。编辑目标替换后，旧实例的清理不能注销新实例。框架无关的 `createAgentSession` 负责上下文、工具授权、审批和版本校验；自建 `@bcr/agent-ui` 只订阅宿主会话，不拥有执行生命周期。工具定义具有类型约束，执行上下文携带调用 ID 和取消信号；长任务需要主动响应信号。工具回执与文本按发生顺序保存在同一记录中，下一轮转换为原生工具调用/结果消息；WASM 序列化使用 assistant `tool_use` 与 user `tool_result` 内容块。插件可以声明独立的结果渲染器，详见 [Agent 对话与扩展](./AGENT-UI.md)。

领域导航通过 `NavigationService` 读取一致的位置快照；嵌入时由 Router 的完成事件驱动，独立运行时由浏览器 History 驱动。调用方不再手工广播导航事件。同一引用再次打开也有独立的导航修订号。

公共主题由 `@bcr/react/theme.css` 提供（含统一令牌与控件原语），`base.css` 仅由独立启动入口加载。领域视图不修改 `body` 的布局与背景；Media、DocGen 的通用控件选择器限制在领域根节点，领域容器建立独立层叠上下文。所有领域 chrome 共用同一套令牌与控件；领域只允许保留数据语义色（涨跌、图表系列）与阅读/画布内容主题。

领域页面目前仍采用 keep-alive，避免清理时丢失草稿、媒体资源和后台任务；自动回收页面需要先给领域状态增加明确的保存/恢复契约。Agent 会话已独立持久化；恢复只展示记录和草稿，不重放任务或待审批操作。

### 领域服务与代码职责

Studio 的 `workspace.ts` 是领域服务组合入口，按元数据会话共享 KnowledgeStore 和 ResearchStore；领域自身不再维护各自的 WeakMap。Runtime 持有组合入口返回的服务，正常关闭及初始化失败均按领域服务、搜索、底层 Runtime 的顺序释放。插件只负责注册能力与搜索投影，不拥有数据库或领域服务的关闭权。组合入口的关闭是幂等的。

知识库同步的唯一运行状态由 `KnowledgeStore.runSync` 维护，并通过独立快照订阅发布。同步开始前的编辑器保存也在同一个同步互斥区内。关闭时先停止接受新同步，允许已经开始的同步提交远端发布回执，然后关闭并排空本地写入队列。ResearchStore 同时排空资料写入队列和资料包记录队列。

知识库职责分为：`actions.ts` 编排创建、导入、导出并经过草稿保存屏障；`useKnowledgeSync.ts` 负责浏览器自动同步调度；`draft.ts` 负责单篇草稿、恢复副本和保存状态；`useNoteDraft.ts` 负责自动保存与卸载监听；`editorAgent.ts` 和 `useNoteAgent.ts` 适配编辑目标与工具；`search.ts` 发布搜索投影。页面保留导航与提示，编辑器保留输入和预览。标题、选区变化更新目标摘要，但不重新注册工具实例；切换笔记仍创建新的草稿与目标身份。

Agent 的 `session.ts` 只编排单次任务和会话快照，`toolExecution.ts` 统一授权、审批、权限复核、执行及结果转换，`surfaceEdit.ts` 维护编辑建议与真实保存回执。模型配置由 AgentHost 的 `settings` 实例持有；默认无存储的 Host 仍相互隔离。Studio 注入独立的连接配置与凭据存储适配器：地址、模型自动保存，凭据默认内存，用户可选择标签页或设备记忆。凭据服务不使用会话或工作区数据库，不进入业务导出。浏览器共享存储的隔离边界是 origin，而不是 React Host。

Research 实现统一位于 `apps/studio/src/research/`，其中 `model.ts` 是类型与规则、`store.ts` 是持久化、`components/` 是领域界面。`@bcr/react` 的入口只导出 API，Runtime、任务和产物 hooks 分别在 `runtime.ts`、`tasks.ts`、`artifacts.ts`；旧 `useServices` 别名已移除，调用方统一使用 `useRuntime`。

### 回归检查

Agent 编辑目标的 `write()` 是异步持久化契约，返回资源 ID 和版本回执。会话只在回执成功后报告保存；资料构造由 `buildAgentMessages` 统一处理，系统消息只包含固定规则，不拼接领域文本。循环结果显式携带 `finishReason` 与轮次数，耗尽预算不再等同正常完成。

知识库恢复以现有状态为基准进行预览，确认时重新验证基准与同步状态，通过现有串行持久化队列整次应用。尚未进行分记录存储迁移；多会话持久化、可恢复任务及细粒度数据外发权限仍是后续工作。

新增计算应用时：提供执行模块和独立存储命名空间，通过 `createBrowserRuntime` 组装，在 React 中用 `useRuntimeSession` 挂载，在领域内发布搜索贡献。

`bun run check` 包含格式、lint、所有 workspace 的自动发现类型检查和 Runtime 依赖边界检查。测试覆盖提交顺序、晚订阅、提交失败、关闭释放、跨会话预算、重复 operation 路由、项目租约和持久化写入合并；浏览器回归负责验证真实 Worker、OPFS 和页面恢复链路。
