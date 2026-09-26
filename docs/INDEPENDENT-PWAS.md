# 独立 PWA 安装

BCR 在同一 origin 上提供多个可分别安装的应用。应用共享 OPFS / localStorage，
但具有独立的 manifest 身份、启动页面、文档 scope 和离线外壳缓存。
这不是存储或权限隔离；清除此站点数据仍会影响全部应用。现有共享工作区的
单写者租约仍然有效：独立安装不解除同一项目的多窗口写入限制，避免损坏本地数据库。

## 入口

| 应用       | 安装 / 启动入口     | 稳定 manifest id          | scope             |
| ---------- | ------------------- | ------------------------- | ----------------- |
| 工作区     | `/pwa/workspace/`   | `/pwa/workspace/`         | `/pwa/workspace/` |
| 计算工作台 | `/pwa/studio/`      | `/pwa/studio/`            | `/pwa/studio/`    |
| Reader     | `/pwa/reader/`      | `/reader`（保留历史身份） | `/pwa/reader/`    |
| 笔记       | `/notes/knowledge/` | `/notes/`（保留历史身份） | `/notes/`         |
| 市场       | `/pwa/markets/`     | `/pwa/markets/`           | `/pwa/markets/`   |
| 媒体       | `/pwa/media/`       | `/pwa/media/`             | `/pwa/media/`     |
| 量化       | `/pwa/quant/`       | `/pwa/quant/`             | `/pwa/quant/`     |
| 漫画       | `/pwa/manga/`       | `/pwa/manga/`             | `/pwa/manga/`     |
| 文档       | `/pwa/documents/`   | `/pwa/documents/`         | `/pwa/documents/` |
| 数据       | `/pwa/data/`        | `/pwa/data/`              | `/pwa/data/`      |
| 文档生成   | `/pwa/docgen/`      | `/pwa/docgen/`            | `/pwa/docgen/`    |

宿主应用在「工作区选项」中提供当前应用的安装入口，先完整导航至独立页面，
再使用该页面收到的 `beforeinstallprompt`。不支持此事件的浏览器显示菜单安装说明。
Reader 保留原有安装控件；笔记的独立浏览器页面有安装按钮，独立窗口中隐藏该栏。
首页不再静态引用 Reader 清单。宿主直接访问 `/knowledge` 或 SPA 切换到知识库时，
关联的是 `/notes/manifest.webmanifest`，避免把笔记安装操作识别为 Reader。

## 组合与导航

`src/pwa/apps.ts` 是安装配置来源；`bun run generate:pwa` 生成 HTML、manifest
和 PNG 安装图标（Reader / 笔记沿用现有 SVG 图形）。生成物入库，开发服务器与
静态部署看到相同文件。新增应用还需在 shell registry 中注册功能组件。

`src/pwa/main.ts` 按入口选择 Reader 轻量组合根或共享 Studio 运行时。
TanStack Router 的 input/output rewrite 在应用内部保留 `/markets` 等既有领域
路径，对外暴露 `/pwa/markets/`，查询参数和 fragment 保持不变。
专属应用切往另一个领域时完整导航至宿主；工作区 PWA 则允许在自己的 scope 内
使用全部工作区路由。域组件不需要复制，也不会把别的应用清单替换进当前 PWA。

## Service Worker 与离线

- 各新入口注册 `/pwa/sw.js?app=<key>`，显式 scope 为对应 `/pwa/<key>/`。
  脚本实现共用，注册和 `bcr-pwa-<key>-shell-<buildId>` 缓存独立。
- 笔记继续使用 `/notes/sw.js` 与 `bcr-knowledge-shell-*`。
- 离线图按构建 manifest 预缓存当前应用。Rolldown 会合并使用相同脚本的 HTML
  入口；`pwa-build.ts` 为这些文档补齐 bootstrap 映射，防止漏缓存共享入口脚本。
- Worker 的 URL 在 `/assets/`，不属于文档 scope，因此增加 **仅用于资源** 的
  `/assets/sw.js` 注册。它不处理页面导航或安装身份；为 Worker 的嵌套 JS/WASM
  请求读取已缓存资源，并缓存运行时获取的不可变依赖。
- Cloudflare 部署的 DuckDB 模块超过单文件上限，仍从既有固定版本 CDN 获取。
  资源 Worker 缓存首次成功下载的模块；首次下载引擎及远程模型需要网络，
  独立安装不意味着所有未下载功能或实时行情都可离线使用。
- 应用外壳更新沿用用户确认、保存屏障与失败回滚；上一版本缓存保留给旧标签页。
  纯资源 Worker 可以立即接管，因为它不替换页面、路由或已有文档版本。

## 旧 Reader 迁移

`/manifest.webmanifest` 保留原地址及 `id: "/reader"`，但将 `start_url` 与 `scope`
收敛至 `/pwa/reader/`。旧 `/reader` 启动路径仍可用，浏览器更新 manifest 后使用新入口。
不要通过改 ID 强制“重新安装”，否则会生成另一个 Reader 身份。

根 `/sw.js` 继续服务旧客户端和浏览器宿主，但对 `/notes/` 与 `/pwa/` 导航放行，
由更具体的注册接管；没有 unregister 全站 Worker、清空本地存储或删除笔记。
已缓存旧版本的用户需先接受一次应用更新，随后浏览器还需要刷新已安装的 manifest；
无法由网页强制立即修改操作系统中旧安装的元数据。

## 验证

```sh
bun run check
vp test run apps/studio/tests/pwa-routing.test.ts
VITE_BCR_CLOUDFLARE=1 vp -C apps/studio build
bun run test:pwa:apps
bun run test:pwa
bun run test:pwa:knowledge
```

独立 PWA 检查读取 Chromium 解析后的 manifest，逐个冷启动与断网启动；使用
Chrome DevTools Protocol 的真实 PWA install / launch / uninstall 验证 Reader
与笔记两个安装顺序，不以“清单文件不同”代替并存安装测试。安装发生在测试
浏览器的临时配置中，结束时清理。CI 使用完整 Chromium（`channel: chromium`）。
同时验证根 Worker 向新作用域交接、同源数据保留及宿主知识库清单归属。
iOS / Safari 的系统安装菜单仍需设备验收，Chromium 测试不替代它。
