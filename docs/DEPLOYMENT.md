# 构建与部署

[文档](README.md) → 部署

Studio 构建输出到 `apps/studio/dist`，包含宿主、独立 PWA、Service Worker、同源字体与静态资源。构建入口见 [vite.config.ts](../apps/studio/vite.config.ts)。

## 本地构建

完成[环境准备](DEVELOPMENT.md#首次启动)后：

```sh
bun run build:cloudflare
bunx vp -C apps/studio preview --host 127.0.0.1
```

使用终端打印的预览地址。开发模式不注册生产 Service Worker，安装、离线启动和升级需要用生产产物验证。

## Cloudflare

[wrangler.jsonc](../wrangler.jsonc) 使用 Workers Static Assets 发布 `apps/studio/dist`，SPA 路由回退由 `not_found_handling` 配置。

```sh
bun run build:cloudflare
bun run deploy:cloudflare -- --dry-run
bun run deploy:cloudflare
```

本地部署需要可用的 Wrangler 身份。自动部署在仓库 Actions Secrets 中使用：

| Secret                  | 用途     |
| ----------------------- | -------- |
| `CLOUDFLARE_API_TOKEN`  | 部署凭据 |
| `CLOUDFLARE_ACCOUNT_ID` | 目标账户 |

`main` 的 push 在验证和浏览器回归成功后部署，并复用已验证的 `studio-dist` 产物。PR 不发布；凭据缺失时部署 job 提示并跳过。完整流程见 [CI](../.github/workflows/ci.yml)。

部署后运行：

```sh
node scripts/verify-deploy.mjs https://your-domain.example
```

该检查确认资源 URL 返回实际资源，而非 SPA 回退页面。

## 其他静态托管

发布整个 `apps/studio/dist`，保留目录结构，并检查以下条件：

- HTTPS 与正确的跨源隔离响应头。仓库生成的头规则见 [public/_headers](../apps/studio/public/_headers)。
- JS、WASM、字体和 Worker 文件按真实类型返回；缺失资源不能伪装成 HTML 成功响应。
- SPA 路由与 `/pwa/`、`/notes/` 目录入口均能直接刷新；不能把所有独立入口重写到宿主 HTML。
- `sw.js` 和 `build-manifest.json` 能及时获取新版本；安装作用域和清单身份保持稳定。

安装入口与缓存策略见[独立 PWA](INDEPENDENT-PWAS.md)，更新的保存屏障见[应用更新](APP-UPDATES.md)。

## 本地作品执行服务

Works Runner 与 Studio 静态站点分别部署。Runner 可以安装在用户电脑上，也可以使用独立发布目录构建 Docker 镜像；工程与任务数据放在安装目录之外。Web、控制 API 和作品预览使用不同 origin。安装包、端口、数据卷和反向代理设置见 [Runner 部署说明](../apps/work-runner/README.md#docker-与远程部署)。

浏览器 Bridge 用于访问已经打开并授权的浏览器工作区，其连接和部署边界见 [Bridge](AGENT-BRIDGE.md#边界与验证)。

## 常见问题

| 现象                            | 检查方向                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| 缺少 WASM 或 Agent 模块         | 初始化 Git 子模块，重新运行 `bun run build:wasm`                                            |
| Worker、字体或模块请求拿到 HTML | 检查资源路径和托管端 SPA 重写；运行部署自检                                                 |
| 页面提示本地持久化不可用        | 检查安全上下文、站点存储权限、剩余容量及启动错误；不要用清除内容数据代替诊断                |
| 手机仍显示旧版                  | 保持联网，返回应用等待更新提示；确认保存后更新。详见[更新与恢复](APP-UPDATES.md#更新与恢复) |
| 已安装应用与网页数据不同        | 确认协议、域名、端口和浏览器配置相同                                                        |

应用代码缓存与用户数据是不同的存储内容。清除整个站点的数据会移除笔记、书库和图表，处理前先使用对应应用的导出功能。
