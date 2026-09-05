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

领域会话的存储隔离与宿主的全局调度预算是两个独立维度。Media、Quant 嵌入 Studio 时继承宿主资源管理器；独立启动时创建自己的 Host。顶栏容量汇总覆盖当前 Host 注册的计算会话，而不是只观察 Studio 的 ArtifactStore。

Reader 保留面向阅读首屏的延迟解析、索引和 SQLite 初始化流程，其专用解析／索引 Worker 尚不经过计算 Scheduler。它的独立阅读存储不属于上述 Host 的容量汇总或项目写锁覆盖范围。

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

新增计算应用时：提供执行模块和独立存储命名空间，通过 `createBrowserRuntime` 组装，在 React 中用 `useRuntimeSession` 挂载，在领域内发布搜索贡献。

`bun run check` 包含格式、lint、所有 workspace 的自动发现类型检查和 Runtime 依赖边界检查。测试覆盖提交顺序、晚订阅、提交失败、关闭释放、跨会话预算、重复 operation 路由、项目租约和持久化写入合并；浏览器回归负责验证真实 Worker、OPFS 和页面恢复链路。
