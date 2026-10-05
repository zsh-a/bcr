# 架构概览

[文档](README.md) → 架构

BCR 由 Studio 宿主、领域应用、浏览器计算 Runtime 与独立作品 Runner 组成。本文说明当前分层；具体类型、提交顺序与关闭契约见 [Runtime 架构](RUNTIME-ARCHITECTURE.md)。

## 分层

| 层         | 职责                                          | 主要实现                                                          |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------- |
| 宿主       | 路由、应用注册、导航、全局搜索、主题、AI 面板 | `apps/studio`、`@bcr/shell-contract`                              |
| 领域应用   | 阅读、写作、绘图、媒体、市场与研究工作流      | `apps/*`、`packages/*-studio`                                     |
| 共享交互   | 控件、模态、运行时订阅与更新协调              | `@bcr/react`、`@bcr/agent-ui`                                     |
| 计算与会话 | 任务、资源预算、产物、缓存、生命周期          | `@bcr/core`、`@bcr/runtime-browser`                               |
| 执行与存储 | Worker 协议、文件 IO、元数据持久化            | `@bcr/runtime-worker`、`@bcr/storage-opfs`、`@bcr/storage-sqlite` |
| 内核       | 哈希、音频、回测与 Agent 执行                 | `crates/kernels`、`crates/quant`、`crates/agent-runtime`          |

TypeScript 定义契约与界面，Effect 管理任务生命周期，Rust/WASM 提供计算内核。GPU 模型由领域执行器接入，并声明资源需求。`runtime` 表示计算后端，不等同于主线程或 Worker。

## 浏览器计算流程

输入先保存为本地产物引用，任务通过 `(runtime, operation)` 找到执行器。Scheduler 申请线程、内存或 GPU 预算后执行任务，支持排队、进度、取消、超时和重试。

产物使用 BLAKE3 内容身份。缓存键包含有序输入、操作、配置与运行时信息；命中缓存后复用结果。计算完成后，还必须提交血缘、缓存和任务日志，才能向界面发布成功。依赖关系用于流水线编排、取消传播和下游失效。

关键实现：[Scheduler](../packages/core/src/scheduler.ts)、[产物](../packages/core/src/artifact.ts)、[缓存键](../packages/core/src/cache-key.ts)、[Worker 协议](../packages/runtime-worker/src/protocol.ts)。

## 所有权与存储

`RuntimeHost` 共享资源预算并管理会话；每个 `RuntimeSession` 拥有自己的调度器、存储命名空间和执行模块。浏览器会话由 `createBrowserRuntime` 统一组装，初始化失败与正常关闭都回收已创建资源。

- **计算项目**：二进制数据落 OPFS，SQLite 保存元数据、缓存、血缘和任务日志。SQLite 当前以整库快照持久化。
- **知识库与资料集合**：由工作区服务持有，领域插件只注册搜索、工具和视图。知识库采用[分记录存储](KNOWLEDGE-STORAGE.md)。
- **Reader**：使用专用书库、延迟解析和索引流程，解析 Worker 不经过计算 Scheduler；恢复与位置契约见 [Reader](READER-ARCHITECTURE.md)。
- **绘图**：原生 Excalidraw scene 保存到独立 IndexedDB，文档与索引原子提交，并用 revision 拒绝过期写入。
- **通用作品**：源码、数据、素材和 Git 版本都属于独立 Work 工程；Runner 读取工程、保存不可变快照并生成产物，Works 只保存连接、审阅和交付状态。详见[作品工作区](WORKS.md)。

计算项目和 Reader 使用命名空间级 Web Locks。不同 PWA 可以拥有独立入口，但同源数据与项目写入锁仍共享；这不构成多窗口协同编辑。各独立入口是否创建 Studio 会话，见 [Runtime 所有权](RUNTIME-ARCHITECTURE.md#所有权)。

## 作品执行

`packages/work-core` 定义工程目标、参数、任务、批注的纯契约。`apps/studio/src/works/service.ts` 是唯一的 Works 控制面，使用 `sourceId + workId` 定位 Runner 工程，不再提供浏览器文件存储或浏览器作品编辑器。`apps/work-runner` 限定授权根目录，保存源码快照与任务，按 HTML/Remotion 目标执行。控制端口与预览端口分离，凭据不传给作品。构建/编码依赖只属于 Runner，Runner 的 service 与 schema 被 HTTP、CLI、直接 STDIO MCP 共用；浏览器 Bridge 只负责资料和浏览器能力。独立发布包编译 work-core 并记录构建与依赖身份，子进程只依赖安装包资源；Docker 使用同一发布目录。详细边界与命令见 [Works Runner](../apps/work-runner/README.md)。

## 应用与 Agent 接入

`app-definition.ts` 定义应用身份、路由、分组与安装配置；`AppManifest` 添加视图、插件和计算声明。宿主注册与 PWA 生成均使用同一[应用目录](../apps/studio/src/shell/app-definitions.ts)。

领域通过公开包入口暴露计算模块与数据契约，通过插件发布搜索和 Agent 能力。宿主不读取领域 Store 的内部结构。跨应用交接使用稳定 ID、内容引用和经过校验的领域包，而不是依赖临时 Blob URL。

AgentHost 负责会话、能力、凭据和审批；UI 订阅状态，不拥有执行生命周期。写入工具先生成可审阅变更，再验证版本并等待真实保存回执。恢复会话不自动重放任务或待审批操作。详见 [Agent 接入](AGENT-UI.md)。

外部助手通过 Runner 的 STDIO MCP 直接操作代码工程；浏览器中的资料和笔记通过可选的本机 `apps/agent-bridge` MCP 服务连接已打开的浏览器工作区。Runner MCP 与 Bridge 是两条独立链路：Runner 面向源码、渲染和审阅，Bridge 面向浏览器资料能力。浏览器按用户授权暴露 shared capabilities，Bridge 不持有业务数据库。权限、断线和客户端配置见[外部 Agent](EXTERNAL-AGENTS.md)。

## 界面与更新

应用复用共享工具栏、命令菜单、对话框、资源搜索和主题令牌。阅读纸张、画布内容与行情数据色保留领域语义，界面控件遵循[交互约定](WORKSPACE-UI.md)。

Service Worker 按入口缓存外壳与资源；更新前由全局协调器检查忙碌状态并保存已注册的草稿。保存失败时保留当前页面和版本，见[应用更新](APP-UPDATES.md)。

## 当前边界

- 浏览器内容按 origin 隔离，跨设备迁移依赖应用备份或显式同步。
- 已实现的宿主插件是应用组合与能力注册机制，不是通用第三方插件沙箱或 WIT 插件 ABI。
- 长任务恢复、数据清理和多窗口写入依赖各领域的明确契约，不能仅由 UI 卸载或缓存命中推断。
- 模型、实时行情和同步服务有各自的网络及数据来源要求，离线安装不保证所有功能离线运行。

扩展和回归要求见[开发指南](DEVELOPMENT.md)；领域级存储、研究规则与已知限制从[文档索引](README.md)进入。
