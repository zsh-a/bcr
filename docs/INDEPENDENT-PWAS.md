# 安装与离线使用

[文档](README.md) → PWA

BCR 的应用可分别安装到桌面。同源入口共享本地数据，但拥有独立的安装身份、启动路径和应用外壳缓存；安装不会复制书库或笔记。

## 入口

从工作区的安装入口进入对应页面，再使用浏览器提供的安装操作。浏览器不支持安装提示事件时，界面会展示菜单安装说明。

| 应用       | 工作区路由   | 安装与启动入口      |
| ---------- | ------------ | ------------------- |
| 工作区     | `/`          | `/pwa/workspace/`   |
| Reader     | `/reader`    | `/pwa/reader/`      |
| 个人知识库 | `/knowledge` | `/notes/knowledge/` |
| 绘图       | `/diagram`   | `/pwa/diagram/`     |
| 内容项目   | `/content`   | `/pwa/content/`     |
| Media      | `/media`     | `/pwa/media/`       |
| Documents  | `/documents` | `/pwa/documents/`   |
| Manga      | `/manga`     | `/pwa/manga/`       |
| Data       | `/data`      | `/pwa/data/`        |
| Market     | `/markets`   | `/pwa/markets/`     |
| Quant      | `/quant`     | `/pwa/quant/`       |
| DocGen     | `/docgen`    | `/pwa/docgen/`      |
| 计算工作台 | `/studio`    | `/pwa/studio/`      |

Reader 保留 `id: "/reader"` 与 `/manifest.webmanifest`；Notes 保留 `id: "/notes/"` 与 `/notes/` 作用域。其他应用的 manifest ID 与 `/pwa/<key>/` 作用域一致。发布后不要随意改变安装身份。

## 数据与运行边界

应用通过浏览器 origin 共享 OPFS、IndexedDB 和 localStorage；这不是权限隔离。清除整个站点数据会影响所有同源应用，更换域名或端口则进入另一份存储空间。

独立 Market、Quant、Media、Manga、DocGen、Diagram 使用轻量外壳，不打开 Studio 元数据库；Reader 使用专用启动流程。Workspace、Studio、Notes、Content、Data、Documents 仍使用共同的 Studio 工作区。项目写锁与 Reader 书库锁继续生效，独立安装不解除写入限制。

专属应用跳到其他领域时进入宿主工作区；Workspace PWA 可以在自己的作用域内访问完整工作区。查询参数与 fragment 在导航时保留。

## 离线与更新

- 首次联网加载后，Service Worker 预缓存当前应用外壳。未下载的模型、实时行情与外部 AI 接口仍需要网络。
- 内容项目同时预缓存图表与导出代码、WASM 和中文字体，支持首次离线创建、计算与导出图文。
- `/pwa/sw.js?app=<key>` 共用实现，按应用分别注册与缓存；Notes 使用 `/notes/sw.js`。
- `/assets/sw.js` 只管理资源作用域，为 Worker 的嵌套 JS/WASM 请求提供缓存，不接管页面导航或安装身份。
- 新版本先后台下载，用户确认后保存当前内容并更新；保存失败保留原页面。详见[更新与恢复](APP-UPDATES.md)。

根 `/sw.js` 保留宿主与旧 Reader 客户端的服务，对 `/notes/` 和 `/pwa/` 导航放行，由更具体的作用域接管。旧 Reader 安装的元数据由浏览器刷新；无需通过修改 ID 或清空内容来迁移。

## 开发与验证

应用身份来自[应用目录](../apps/studio/src/shell/app-definitions.ts)，[PWA 配置](../apps/studio/src/pwa/apps.ts)派生安装信息。新增应用后运行 `bun run generate:pwa`，生成的 HTML、manifest 和图标入库。

```sh
bun run build:cloudflare
bun run test:pwa:apps
bun run test:pwa
bun run test:pwa:knowledge
```

测试使用生产产物和临时浏览器配置，检查清单、独立启动、离线冷启动、Reader/Notes 安装顺序及旧入口交接。iOS 的安装菜单与系统行为仍需真机验收。Notes 的组合根见[独立笔记入口](KNOWLEDGE-PWA.md)。
