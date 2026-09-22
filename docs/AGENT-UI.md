# Agent 对话与扩展

助手使用自建 `@bcr/agent-ui`，不再依赖 assistant-ui。UI 是宿主会话的投影，不拥有模型请求或工具执行的生命周期。

## 职责边界

| 层              | 职责                                               | 不负责                           |
| --------------- | -------------------------------------------------- | -------------------------------- |
| `@bcr/agent`    | 会话、执行记录、原生模型历史、能力与审批、恢复校验 | React、浏览器存储、领域视图      |
| `@bcr/react`    | 注入宿主、订阅设置、IndexedDB 存储适配             | 聊天组件、领域结果解释           |
| `@bcr/agent-ui` | 输入区、时间线、工具卡、审批卡、结果渲染注册表     | 直接执行工具、绕过审批、领域业务 |
| Studio Shell    | 创建和释放宿主、活动领域、浮动/停靠/展开容器       | 模型循环、知识库检索逻辑         |
| 领域插件        | 注册工具、上下文、可选结果渲染器                   | 修改聊天主组件                   |

宿主只创建一次，通过 `<AgentProvider host={host}>` 注入。任意容器均可使用同一个 `<AgentConversation>`，也可单独组合 `AgentTimeline`、`AgentComposer`、`ToolExecutionCard`、`ApprovalCard`。宿主由嵌入方释放，卸载对话视图不会停止请求。

```tsx
const host = createAgentHost({ storage: createAgentStorage() });
const renderers = createResultRegistry(pluginRenderers);

<AgentProvider host={host}>
  <AgentConversation renderers={renderers} renderText={MarkdownText} />
</AgentProvider>;
```

上述对象应在应用生命周期内稳定创建，而非每次渲染重新创建。无浏览器的宿主可以省略 `storage`，或注入自己的 `ConversationStorage` 和 `runRound`。主题使用已有 `--color-*`、`--font-*` 变量；内置纯文本渲染器不强制 Markdown 依赖。

## 单一执行记录

一次任务保存 `input + status + parts`。`parts` 按实际顺序保存文本和工具调用，工具结果、审批决定附着到对应调用；不再从独立的“文本汇总”和“工具列表”拼接 UI。`conversationHistory` 使用同一记录产生下一轮模型消息，保留工具调用 ID、结果及文本顺序。

流式内容合并相邻文本片段，UI 更新合并至约 32 ms 一次，存储定期检查点约 350 ms 一次。工具与最终状态立即排队保存。普通浏览器关闭/崩溃无法保证最后一个未提交事务已落盘，恢复时会明确标记未完成任务，不宣称继续了后台执行。

本轮采用**每个宿主同一时刻一个任务**。可切换或新建对话、编辑其他草稿；正在执行的输出始终写回原对话。不同对话不共享模型历史，但可以使用相同的领域能力。重试仅允许最近一个失败且未发起任何工具调用的任务；已有工具回执保留，不自动重复写入。

## 接入领域结果展示

1. 在工具上声明 `presentation: { kind, version, label }`，与模型工具定义分离，不发送给模型。
2. 在 `WorkspacePlugin.agentRenderers` 声明匹配的 `{ kind, version, accepts, component }`。
3. `accepts` 校验未知结果；组件使用工具结果展示资料、图表或跳转入口。知识库的 `agentRenderers.tsx` 是实际示例。

宿主从插件列表统一收集渲染器，新增领域不需要修改浮窗或聊天组件。注册表也支持运行时 `register()`，其返回值是幂等注销函数；重复 `kind@version` 会被拒绝。

渲染器只收到工具记录，没有执行器或审批回调。未知版本、无匹配渲染器、校验失败时保留通用工具卡与技术详情；校验器或组件抛错由局部错误边界隔离。知识库跳转按已校验 ID 构造本地路由，不直接信任模型提供的 URL。

这属于**可信应用插件**，不是第三方 JavaScript 安全沙箱。错误边界防止渲染故障，不阻止恶意插件访问同源浏览器 API；需要运行不可信插件时应另加隔离环境和权限协议。

## 审批、存储与恢复

- 当前内容和允许编辑是不同开关；写入仍需逐次审批。批准时重新验证能力、活动目标和版本。
- 审批绑定运行 ID 与调用 ID，只可结算一次；切换领域不能把旧编辑转移到新目标。
- IndexedDB 保存会话、草稿和可序列化回执，不保存审批函数或接口密钥。对话内容仍可能敏感，本地存储不等于加密存储。
- 刷新只恢复记录：运行中任务转为 `interrupted`，待审批转为 `expired`。缺少回执的工具结果标记未知，不自动重放。
- 损坏/未知版本存档不覆盖；加载或写入失败显示提示，当前内存会话仍可用。
- 存储使用事务内版本检查，过期标签页不能覆盖更新的存档。当前不合并多个标签页的编辑；冲突页保持内存记录并提示。

## 交互与验证

输入支持 IME、Enter 发送、Shift+Enter 换行、自适应高度和停止；滚动跟随只在用户位于底部时启用，阅读历史时显示“回到最新消息”。浮窗支持拖动、键盘调整、缩放、停靠、展开和移动端尺寸限制。状态播报不逐字朗读模型输出；控件提供可见焦点并尊重减少动态效果的偏好。

```sh
bun run check
bun run test
bun run test:browser
# 本地模型，显式启用同源代理后执行
BCR_LOCAL_LLM=1 bun run dev --host 127.0.0.1 --port 5201
BCR_AGENT_LIVE=1 node scripts/verify-agent-live.mjs
```

`verify-agent-conversations.mjs` 覆盖 IME、流式滚动、后台会话、刷新、凭据不持久化、存储冲突及坏渲染器回退；`verify-general-agent-chat.mjs` 覆盖真实领域工具、审批、失败与窗口交互。

暂不引入分支对话、多任务队列、多 Agent 编排、消息虚拟化或自动上下文压缩。这些应在实际需求和长会话性能数据出现后，沿宿主记录与展示扩展点增量实现，不提前建立另一套状态体系。
