# 外部 Agent 接入

按数据所在的位置选择 MCP 入口。代码作品和浏览器工作区是两个边界，不能用一个服务替代另一个。

| 任务                                                        | 入口                                  | BCR 页面   |
| ----------------------------------------------------------- | ------------------------------------- | ---------- |
| 读取/修改 Work 工程、运行检查、渲染视频、读取反馈、固定交付 | Runner STDIO MCP                      | 不需要     |
| 检索知识库、读取 Reader 资料、保存知识笔记                  | Browser Bridge                        | 需要       |
| 将浏览器资料变成工程输入                                    | Bridge 文件传输，然后复制到 Work 工程 | 导出时需要 |

## 用 Runner 创作代码作品

先启动 Runner：

```sh
bcr-runner create ~/bcr-projects/my-work --id my-work --title "我的作品"
bcr-runner start --root ~/bcr-projects --origin http://localhost:5199
bcr-runner mcp --config ~/.config/bcr/work-runner.json
```

在 Codex、Claude Code 或其他 MCP 客户端中把已安装 Runner 的绝对路径作为 STDIO command：

```json
{
  "mcpServers": {
    "bcr-runner": {
      "command": "/absolute/path/to/bcr-runner",
      "args": ["mcp", "--config", "/home/user/.config/bcr/work-runner.json"]
    }
  }
}
```

Agent 的标准创作链路：

1. 调用 `runner_catalog`、`runner_list`、`runner_read`，确认 sourceId、作品 ID、target 和源码 revision。
2. 读取工程的 `brief.md`、`AGENTS.md`、`work.json`、模型和数据文件。
3. 在 Runner 返回的工程目录中修改源码；不要修改 BCR 仓库，也不要把源码复制到浏览器存储。
4. 调用 `runner_validate`、`runner_capture`，检查代表帧、字体和素材。
5. 生成短视频并实际播放检查节奏、字幕和音画同步。
6. 在 Works 中提交审阅稿，用户可以按帧或页面留下反馈。
7. 调用 `runner_review_read` 读取反馈，修改对应场景，用 `runner_review_edit` 的 `addresses` 提交新稿。
8. 用户确认反馈并固定交付清单，Agent 再下载最终文件。

Runner MCP 不要求 Works 页面在线；Works 连接同一个 Runner 后可以实时查看相同的任务和产物。完整工程契约见 [Works](WORKS.md)，渲染和视觉检查见 [视频创作](VIDEO-AUTHORING.md)。

## 用 Bridge 访问浏览器资料

Bridge 只暴露浏览器中明确授权的 shared capabilities，默认是知识库：

```sh
bun run bridge start --origin http://localhost:5199
bun run bridge token browser
bun run bridge token agent
```

把 agent token 配置到 MCP 客户端的 Streamable HTTP 地址 `http://127.0.0.1:5209/mcp`。浏览器的外部 Agent 面板负责输入 browser token、选择能力和允许写入。详细的连接、文件传输和安全边界见 [浏览器 Bridge](AGENT-BRIDGE.md)。

Bridge 工具返回的笔记、附件和来源是输入数据。若 Agent 需要使用其中的价格或资料，先通过授权工具导出 artifact，再把文件放入 Work 工程，由 Runner 生成固定 revision。Bridge 不创建 Work、不保存源码、不执行 HTML/Remotion、不管理审阅和交付。
