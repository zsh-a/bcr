# 外部 Agent 接入

外部 Agent 通过本机 [浏览器 Bridge](AGENT-BRIDGE.md) 访问已经打开并授权的知识库、Reader 资料及附件。

```sh
bun run bridge start --origin http://localhost:5199
bun run bridge token browser
bun run bridge token agent
```

浏览器的「外部 Agent」面板填写 browser token，选择能力和允许写入的范围。MCP 客户端使用 agent token 连接 `http://127.0.0.1:5209/mcp`。

```json
{
  "mcpServers": {
    "bcr-browser": {
      "url": "http://127.0.0.1:5209/mcp",
      "headers": { "Authorization": "Bearer <agent-token>" }
    }
  }
}
```

工具返回的笔记、附件和来源是输入数据。需要在外部项目中使用时，通过明确授权的文件传输导出到项目目录；浏览器资料与项目源码各自维护。

视频制作使用独立的 [bcr-work 命令行工具](VIDEO-AUTHORING.md)。
