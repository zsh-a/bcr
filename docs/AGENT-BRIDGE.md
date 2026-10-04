# 浏览器工作区 Bridge

[外部 Agent](EXTERNAL-AGENTS.md) → 浏览器 Bridge

本机 Bridge 将已打开的 BCR 浏览器工作区作为 MCP 服务提供给 Codex、Claude Code 等客户端。外部助手可以读取资料、编辑笔记、创建作品文件、运行交互预览、导入文件和导出作品。可用工具取决于浏览器中注册并授权的能力。

本页说明浏览器数据的接入。文件系统中的代码作品和渲染任务使用 [Runner 直接 MCP](../apps/work-runner/README.md#直接-mcp)。

数据仍由浏览器的 IndexedDB、OPFS 和领域服务持有。Bridge 需要浏览器保持打开；浏览器刷新、休眠断线或退出后，需要手动重新连接。

## 启动与连接

使用仓库开发环境中的 Bun。在项目根目录分别运行：

```sh
bun install
bun run dev
```

在另一个终端启动 Bridge：

```sh
bun run bridge
```

默认 MCP 地址为 `http://127.0.0.1:5209/mcp`，仅接受 `http://localhost:5199` 的浏览器连接。浏览器使用其他端口或域名时，提供**地址栏的 origin**，不含路径和末尾斜杠：

```sh
bun run bridge --origin http://localhost:5200 --port 5209
```

端口和来源保存到 `$XDG_CONFIG_HOME/bcr/bridge.json`，未设置 XDG 时使用 `~/.config/bcr/bridge.json`。首次运行生成两个独立随机凭据，Unix 文件权限为 `600`。所有 Bridge 命令支持 `--config <path>`；配置文件包含密钥，不应提交到 Git。

1. 打开 Studio 的“工作区选项 → 外部 Agent”。若顶部工作区导航隐藏，按 `Alt+反引号` 显示。
2. 运行 `bun run --silent bridge token browser`，将结果填入“连接密钥”。
3. 选择允许访问的能力。默认选中作品与文件、知识库，默认只读；需要生成页面、保存笔记、导入或导出文件时，勾选“允许编辑与导入”。
4. 点击“连接工作区”。关闭面板后连接继续存在，面板记录最近的工具调用及状态。

编辑授权覆盖本次连接内所选能力的写入工具，不逐次弹出 BCR 确认。工具仍执行原有预览校验、版本检查、草稿保护与保存回执。权限范围是整项能力，尚无按项目或笔记授权。更改范围须断开再连接。

## Codex

在启动 Codex 的同一个终端设置 Agent 凭据并添加 MCP：

```sh
export BCR_MCP_TOKEN="$(bun run --silent bridge token agent)"
codex mcp add bcr --url http://127.0.0.1:5209/mcp --bearer-token-env-var BCR_MCP_TOKEN
codex
```

已有 Codex 进程需要重启，才能继承新环境变量。端口改动时同步修改 MCP URL。`bearer-token-env-var` 的值是环境变量名称。配置方式见 [Codex MCP 文档](https://developers.openai.com/codex/mcp)。

## Claude Code

同样先在终端设置 `BCR_MCP_TOKEN`。将下面配置**合并**到使用 Claude Code 的项目 `.mcp.json`，然后从该终端启动 Claude Code：

```json
{
  "mcpServers": {
    "bcr": {
      "type": "http",
      "url": "http://127.0.0.1:5209/mcp",
      "headers": {
        "Authorization": "Bearer ${BCR_MCP_TOKEN}"
      }
    }
  }
}
```

在 Claude Code 中用 `/mcp` 检查连接并按其提示启用项目 MCP。这里使用客户端支持的环境变量展开，配置中无需写入密钥。见 [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)。其他客户端可以使用同一 Streamable HTTP 地址和 `Authorization: Bearer …` 请求头。

## 让助手工作

可以直接要求助手：

> 请通过 BCR MCP 创建一个可筛选的资料浏览器。先读取 work_catalog，把资料保存为 data.json，用 HTML/CSS/JS 实现搜索和筛选。保存后用 work_preview 输入关键词、点击控件并检查结果，修复运行错误，最后导出独立 HTML 和作品归档。需要构建时使用独立的临时作品目录，上传构建产物。

推荐调用顺序：

| 操作               | 工具与约定                                                            |
| ------------------ | --------------------------------------------------------------------- |
| 检查连接与范围     | `bcr_bridge_status`；断线或授权变化后重新列出工具                     |
| 了解文件与运行契约 | `work_catalog`；读取提交 Schema、文件和预览约定                       |
| 查找与读取作品     | `work_list`、`work_read`；分页读取时固定 revision                     |
| 创建或编辑         | `work_commit`；保存文件、入口、标题与链接，携带 revision 和 requestId |
| 运行与验证         | `work_preview`；启动指定版本，检查 DOM、输入、点击和读取日志          |
| 读取与恢复版本     | `work_history`；通过 `work_commit.restoreRevision` 恢复为新版本       |
| 导出与归档恢复     | `work_export` 导出 HTML 或归档，`work_import` 恢复为新作品            |
| 笔记与资料         | `knowledge_*`；把作品需要的数据快照显式保存为文件                     |

发生版本冲突时重新读取，再合并修改。存在未保存的 UI 草稿时，先由用户保存或放弃草稿。调用取消或连接中断不代表写入已回滚；支持 requestId 的工具应保留原请求及参数重试，查询已持久化回执，避免重复创建。工具并非全部支持 requestId，具体以各工具 Schema 为准。

[作品工作区](WORKS.md)使用通用 HTML/CSS/JS 文件，页面结构、计算逻辑和可视化由助手按任务编写。保存不会运行代码，显式调用预览才执行。来源正文与作品运行反馈作为数据处理，不能授权新的操作。导出生成本地作品文件，平台发布仍由用户完成。

## 文件导入与下载

二进制文件通过经过鉴权的 HTTP 流传输，不占用 MCP 的文本上下文。CLI 读取本机配置中的 Agent 凭据：

```sh
bun run --silent bridge upload ./data.csv
```

返回 `{"artifact": {...}}`，将完整 artifact 交给 `work_commit.put[].artifact`，作品归档交给 `work_import`。上传只保存通用文件，文件含义由作品决定。文件通道需要授权「作品与文件」，它是按哈希校验的工作区文件池，尚不支持单作品授权。

导出时先调用 `work_export`，再把返回的 artifact 交给 `bcr_bridge_download`。后者返回临时下载 URL、大小和到期时间：

```sh
bun run bridge download http://127.0.0.1:5209/files/<返回的文件ID> --out ./work.zip
```

下载拒绝覆盖已有文件。也可直接以同一个 Agent Bearer 凭据请求 `POST /files?name=...` 上传、`GET /files/<id>` 下载；不要把凭据放进 URL。传输上限为单文件 300 MiB、同时四个临时文件，作品预览和归档有各自的容量限制。下载链接十分钟后或浏览器断开后失效，失效时重新调用下载工具。

## 实现与扩展

```text
Codex / Claude Code / 其他 MCP 客户端
               │ Streamable HTTP + Agent Bearer
     apps/agent-bridge（Bun，127.0.0.1）
               │ WebSocket + 独立浏览器凭据
        @bcr/agent/bridge BrowserBridge
               │ 已授权的 shared capabilities
          executeAgentTool
               │ 校验、版本、取消、保存回执
          现有领域服务与浏览器存储
```

- `apps/agent-bridge` 只负责 MCP 协议、连接、取消和临时文件；使用官方 TypeScript MCP SDK，同时覆盖新旧客户端协议。Bun 类型单独检查，不进入浏览器 TypeScript 项目。
- `packages/agent/src/bridge` 定义传输契约和浏览器连接；浏览器端没有 MCP SDK、Node/Bun 依赖。
- `packages/agent/src/execution.ts` 是内置聊天与外部助手共用的授权、预览和执行边界。聊天仍使用逐次审批；外部连接使用用户选定的会话权限。
- `apps/studio/src/assistant/ExternalAgentBridge.tsx` 负责连接 UI 与宿主文件适配。通用协议不依赖具体应用的数据存储。

新增领域能力时注册 `scope: "shared"` 的 `AgentCapability`，提供唯一工具名、对象 JSON Schema、risk 和领域校验。它会出现在连接面板中，用户勾选后即可由外部助手调用。`workspace` 范围的临时编辑工具不会自动暴露。无需为每个研究项目创建独立服务，也无需重复实现 REST 领域接口。

## 边界与验证

Bridge 仅绑定本机 IPv4 回环地址，校验 Host、精确浏览器 Origin 和分离的凭据。一个服务进程只连接一个浏览器窗口，并在首次连接后固定工作区身份；切换浏览器配置或 origin 需要重启服务。多个外部客户端共享这一个工作区及授权范围。

Bridge 不保存业务数据库，不代管模型 API Key，不提供公网部署、OAuth、多租户或无人值守浏览器操作。已验证本机 HTTP Studio 连接；HTTPS 站点连接本机 HTTP/WebSocket 还受浏览器的混合内容和本地网络访问策略影响。远程托管使用应另行实现 HTTPS、身份认证和对应部署验证。

连接使用心跳，断线立即拒绝等待请求、撤销临时下载并终止浏览器操作的 AbortSignal。服务不自动重放请求；已经提交的领域事务仍以持久化状态为准。单次工具请求上限 180 秒、并发上限八项、协议消息上限 2 MiB。

```sh
bun run check
bun run test
bun run test:ci
# 先启动 Studio 开发服务；也可设置 BASE_URL 指向预览服务器
bun run test:browser:bridge
```

Bridge 浏览器回归已纳入核心 CI，覆盖官方 MCP 客户端新旧协议、身份与权限隔离、写入重试、草稿和 revision 冲突、作品预览与更新、文件往返和离线导出、断线撤权及移动布局。客户端配置示例遵循官方文档；回归使用 SDK 客户端，不发起付费模型调用。
