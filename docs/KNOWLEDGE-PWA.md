# Notes 独立入口

[文档](README.md) → [PWA](INDEPENDENT-PWAS.md) → Notes

独立 Notes 复用知识库组件与同源存储，不挂载 Studio 导航和全局助手。安装与数据边界统一见[PWA 说明](INDEPENDENT-PWAS.md)。

## 路由

| URL                           | 作用                             |
| ----------------------------- | -------------------------------- |
| `/knowledge`                  | Studio 内的知识库                |
| `/notes/`                     | 跳转到独立入口                   |
| `/notes/knowledge/`           | 独立页面与安装启动地址           |
| `/notes/manifest.webmanifest` | 清单，ID 和 scope 均为 `/notes/` |
| `/notes/sw.js`                | Notes Service Worker             |

使用带尾部斜杠的独立入口。独立目录与宿主路由分开，避免静态托管的目录重定向影响 `/knowledge`。

## 组合与构建

[standalone.tsx](../apps/studio/src/knowledge/standalone.tsx) 组合更新协调、Agent 凭据与 Runtime Provider；内部路由仍为 `/knowledge`，通过 `basepath: "/notes"` 映射到独立地址。知识库自己的笔记搜索与命令面板仍可使用。

[vite.config.ts](../apps/studio/vite.config.ts) 构建 Notes HTML 与 Service Worker，输出到同一 `apps/studio/dist`。更新检测使用与宿主相同的构建标识和[更新协议](APP-UPDATES.md)。

## 缓存

Notes 启动依赖 SQLite，安装时按构建清单预缓存必要模块、SQLite WASM 与 OPFS 代理。PDF 和模型依赖按使用情况缓存，Worker 嵌套资源由资源作用域处理。

导航使用版本化外壳；激活时保留上一版本资源供旧页面读取。根 Worker 不用 Studio HTML 响应 Notes 导航，Notes Worker 激活后按更具体的作用域接管。

## 验证

```sh
bun run build:cloudflare
bun run test:pwa:knowledge
```

覆盖跳板、清单、图标、离线冷启动、共享知识库恢复、不完整版本拒绝安装，以及宿主路由不受影响。
