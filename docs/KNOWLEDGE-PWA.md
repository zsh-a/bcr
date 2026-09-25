# 个人知识库独立 PWA（/notes/）

个人知识库除了作为 Studio 壳内的 `/knowledge` 嵌入路由，还提供一个可独立安装的
PWA：manifest `id "/notes/"`、`scope "/notes/"`、`display standalone`，图标与
Reader 同族（青底 + 纸页 + 铅笔）。两个入口共享同源 OPFS / localStorage，笔记、
草稿、凭据与同步状态完全互通，不产生数据分叉。

## URL 结构

| URL                           | 产物                                           | 作用                                            |
| ----------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| `/notes/`                     | `dist/notes/index.html`（public 静态页）       | meta-refresh 跳板，指向真正入口                 |
| `/notes/knowledge/`           | `dist/notes/knowledge/index.html`（Vite 入口） | 独立应用，可离线、可安装                        |
| `/notes/sw.js`                | `dist/notes/sw.js`                             | Notes 专属 service worker，scope 默认 `/notes/` |
| `/notes/manifest.webmanifest` | public 静态清单                                | `start_url "/notes/knowledge/"`                 |

刻意不复用 `/knowledge` 路径：Workers 静态资产的 `auto-trailing-slash` 会把存在
目录索引的 `/knowledge` 308 到 `/knowledge/`，与宿主嵌入路由冲突。`/notes` 与
`/notes/knowledge` 的无斜杠变体由同样的规则 308 到带斜杠形式，因此 `notes/sw.js`
里对两种变体都做了归一。

## 入口与组合根

`src/knowledge/standalone.tsx` 是独立组合根，只保留 KnowledgeApp 依赖的最小
Provider 链：`AppUpdateProvider` → `AgentProvider`（凭据）→ `useRuntimeSession`
（scheduler / worker pool / OPFS）→ `RuntimeProvider` + 常开 `RuntimeActivity`。
不挂 Shell、命令面板、搜索面板与助手。

TanStack 路由以 `basepath: "/notes"` 建一棵只有 `/knowledge` 的路由树：
KnowledgeApp 内部把笔记选择硬编码导航到 `/knowledge`，路由树必须保留该 path，
basepath 使它与宿主的 `/knowledge` 在 URL 上互不相扰。样式基座在
`knowledge-entry.css`（theme / ui / base 三件套，对齐 `reader-entry.css` 的职责）。

## Service Worker

`src/knowledge/service-worker.js` 与 Reader SW 同一套协议与策略：

- 安装时按 `build-manifest.json` 的 `notes/knowledge/index.html` 条目递归预缓存
  入口模块图；**sqlite wasm 及其 OPFS 代理不排除**——Notes 的 runtime 启动即加载
  sqlite，属于关键路径（Reader 把它留给运行时缓存，因为阅读器启动不需要）。
  仅 PDF worker、onnxruntime / transformers、duckdb 留给运行时。
- 导航请求优先命中版本化外壳，未命中回退 `/notes/knowledge/`，绝不把新部署的
  index 写进旧缓存；激活保留上一个时间戳版本供已打开的旧标签页取旧 chunk。
- 更新走 `SKIP_WAITING` 用户确认协议，与 Reader 共用
  `__bcrUpdateReady` / `bcr-update-ready` / `bcr-apply-update` 事件名，
  `AppUpdateProvider` 原样复用。

宿主 Reader 的 `src/service-worker.js` 对 `/notes/*` 导航直接放行网络：Reader SW
scope 更宽（`/`），在 Notes SW 注册前不得把 Studio SPA 塞进 notes 地址；Notes SW
激活并以更具体 scope 接管后，导航由它控制（浏览器按最长 scope 匹配）。

## 构建接线

`apps/studio/vite.config.ts` 新增两个输入：`notes`（`notes/knowledge/index.html`）
与 `notes-service-worker`（输出到 `notes/sw.js`）；`globalThis.__BCR_NOTES_BUILD_ID__`
与 Reader 共用同一构建时间戳，保证部署后 SW 字节必变。部署无需改 `wrangler.jsonc`：
新产物都在同一 `apps/studio/dist` 内。

## 验证

```bash
vp -C apps/studio build && bun run test:pwa:knowledge
```

生产产物校验覆盖：Reader SW 先装时 Notes SW 按 scope 接管、`/notes/` 跳板、
manifest 与图标可达、离线冷启动恢复共享知识库、不完整版本无法替换外壳缓存、
宿主 `/knowledge` 嵌入路由不受影响。
