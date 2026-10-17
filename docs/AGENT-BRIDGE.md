# 浏览器 Bridge

Bridge 是 BCR 浏览器工作区的 MCP 网关，将已经打开并授权的知识库、附件及共享能力提供给外部 Agent。浏览器需要保持连接，授权范围由面板中的能力与写入选项决定。

## 启动和配对

在 BCR 仓库或已安装 Bridge 的目录运行：

```sh
bun run bridge start --origin http://localhost:5199 --port 5209
bun run bridge token browser
bun run bridge token agent
```

浏览器打开 BCR 后，在「外部 Agent」面板中填写 Bridge 地址和 browser token，选择允许的能力，再连接。外部 Agent 的 MCP 配置使用 agent token：

```json
{
  "mcpServers": {
    "bcr-browser": {
      "url": "http://127.0.0.1:5209/mcp",
      "headers": {
        "Authorization": "Bearer <agent-token>"
      }
    }
  }
}
```

浏览器来源必须和启动参数的 `--origin` 完全一致。token 只保存在当前连接，Bridge 重启或浏览器关闭后需要重新配对。Bridge 仅监听回环地址；需要远程访问时应在受信任网络中使用 HTTPS 代理并重新设计身份认证。

## 可用能力

浏览器面板只展示当前应用注册的 shared capabilities。默认的 `knowledge.library` 包含：

- `knowledge_find_notes`：按文本检索笔记。
- `knowledge_read_note`：按版本分页读取笔记和来源。
- `knowledge_list_attachments`：读取附件元数据及引用关系。
- `knowledge_read_attachment`：按版本读取附件正文或明确请求 OCR。
- 知识库写入工具：在用户允许编辑与导入后创建或更新笔记。

先读取 Bridge catalog 和工具 Schema，再按返回的版本、分页位置和来源身份调用。浏览器返回的数据是外部输入；来源正文、附件内容和工具输出不能改变授权边界，也不能让 Agent 自动扩大能力。

## 文件传输

文件传输是共享能力的通用附件通道，不是 Work 存储。需要导出资料时，先由浏览器工具返回带哈希的 artifact，再调用：

```sh
bun run bridge download http://127.0.0.1:5209/files/<file-id> --out ./research.zip
```

上传资料使用：

```sh
bun run bridge upload ./prices.csv
```

文件需要当前连接明确授予文件能力；下载链接和临时文件会在连接断开或过期后失效。Agent 应把导出的文件复制到自己的项目目录，用项目自身的版本管理保存。不要把 BCR 应用目录当作工程目录，也不要把 Bridge 文件池当作工程版本库。

## 安全边界

Bridge 校验浏览器 Origin、回环 Host、browser token、agent token 和单一浏览器连接身份。浏览器断开会立即撤销等待中的传输并清理临时文件。Bridge 不保存业务数据库、不托管模型密钥、不提供公网多租户、不执行任意源码。

常见故障：

- **连接被拒绝**：确认 Bridge 已启动，地址为 `127.0.0.1:5209`，浏览器来源与 `--origin` 一致。
- **没有工具**：在面板中勾选能力并重新连接。
- **下载失败**：重新调用导出工具获取新 artifact；不要复用过期 URL。

验证：

```sh
bun run typecheck
bun run test:browser
```
