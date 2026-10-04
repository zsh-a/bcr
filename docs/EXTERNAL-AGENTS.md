# 外部 Agent 接入

[文档](README.md) → 外部 Agent

按数据所在的位置选择 MCP 入口。两种入口可以同时配置，工具名称各自独立。

| 要操作的数据                                  | 入口                               | 工具                       | 是否需要 BCR 页面在线 |
| --------------------------------------------- | ---------------------------------- | -------------------------- | --------------------- |
| 文件系统中的代码作品、参数、批注与渲染产物    | 独立 Runner，STDIO MCP             | `runner_*`                 | 否                    |
| 浏览器作品、知识库、Reader 等已授权工作区能力 | 浏览器 Bridge，Streamable HTTP MCP | `work_*`、`knowledge_*` 等 | 是                    |

## 本地代码作品与渲染

安装 [Works Runner](../apps/work-runner/README.md#安装与启动)，选择作品目录并启动服务：

```sh
bcr-runner start --root ~/bcr-projects --origin http://localhost:5199
bcr-runner mcp
```

在 Agent 的 MCP 设置中，将 `command` 指向已安装的 `bcr-runner` 绝对路径，`args` 设为 `["mcp"]`；使用独立配置时追加 `--config /path/to/connection.json`。MCP、CLI 和 Works 页面共享同一服务的任务与产物。

推荐调用顺序：`runner_catalog` → `runner_list` → `runner_read` → 修改返回目录中的工程文件 → `runner_render` → `runner_job` → `runner_output`。图片反馈使用 `runner_output(image: true)`；批注通过 `runner_reviews` / `runner_review` 读写。修改和渲染使用源码 revision，批注编辑使用自己的 revision；重试写入保留 requestId 和原参数。

源码可以由任意 Coding Agent 编辑。Works 页面连接同一个 Runner 后提供预览、参数和时间点批注；关闭页面不会取消已经提交的任务。完整命令、快照规则及 Docker 部署见 [Runner 使用说明](../apps/work-runner/README.md)。

## 浏览器工作区

Bridge 按浏览器会话授权，适合读写笔记、资料和存储在工作区中的作品。启动、配对、客户端配置、文件传输和权限边界统一见 [浏览器 Bridge](AGENT-BRIDGE.md)。

浏览器助手仍可通过 `work_*` 操作已连接的本地 Runner，并控制页面播放器；这条路径需要页面在线。直接 Runner MCP 可以独立检查工程、读取批注和导出产物。浏览器中的知识库数据需要显式导出为工程文件后，才能作为 Runner 的输入快照。
