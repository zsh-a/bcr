# 通用作品工作区

[文档](README.md) → 作品

打开 `/works`，或在应用菜单选择「作品」。浏览器作品和本地代码工程共用一个工作区；每个本地工程可以包含 HTML、Remotion 等多个输出目标。页面结构、计算与视觉表达由作品代码定义。内置助手与浏览器 Bridge 使用 `workspace.works` 能力；独立 Runner MCP 通过 `runner_*` 处理文件系统中的工程。

- **浏览器作品**：文件存储于 IndexedDB / OPFS，通过 `work_commit` 编辑，支持隔离 HTML 预览和独立页面导出。
- **本地工程**：文件系统是源码的唯一存储，通过 Runner 连接。Agent 在工程目录编辑代码，Works 提供参数、播放器、按帧批注、任务和导出。参见 [Runner 使用说明](../apps/work-runner/README.md)。

共享契约位于 `@bcr/work-core`；`WorkService` 汇合来源，`LocalRunner` 只负责 HTTP/预览连接。Remotion 构建、依赖安装、视频编码均留在 `apps/work-runner`，不进入浏览器包。浏览器作品使用 `bcr-work-1` 文件与版本清单；本地工程使用 `bcr-project-1` 目标声明。

作品可以是交互页面、资料浏览器、时间线、计算工具或自定义可视化。通过 `links: [{rel, uri, revision?}]` 记录来源及版本；链接不会自动读入宿主数据。把需要的数据快照显式写入作品文件，才能重现和离线运行。

## 统一的作品入口

`work_list` 默认返回所有已连接来源，并包含 `ref: {provider, id}`、targets 和 capabilities。使用作品时同时保留 provider 与 id，避免浏览器和本地 ID 相撞。`work_read`、`work_preview`、`work_export` 的 provider 省略时仍是 browser；本地作品传 `"local"`。`work_commit` / `work_import` / `work_history` 保持浏览器语义。

本地新增工具：`work_render`、`work_jobs`、`work_cancel`、`work_parameters`、`work_reviews`、`work_review`、`work_output`。图片、视频、网页是目标和任务产物，批注依赖源码 revision，但拥有独立的编辑 revision。渲染任务保存于 Runner，浏览器关闭不会取消任务。

独立 Agent 可以通过 `bcr-runner mcp` 的 `runner_*` 工具直接访问同一个本地服务，页面关闭后仍可渲染、读写批注和检查关键帧；浏览器内数据继续使用 Bridge。

工作台通过「连接本地工程」进行配对；连接后在同一作品列表中选择本地工程，再选择页面或动画目标。没有单独的 Motion 应用，也没有第二套作品数据库。

## 浏览器作品的 Agent 创作流程

外部 Agent 面板勾选「作品与文件」以及「允许编辑与导入」。仅授权这一项即可完成文件传输与作品创作。

| 工具                      | 作用                                                    |
| ------------------------- | ------------------------------------------------------- |
| `work_catalog`            | 读取文件、提交和运行契约                                |
| `work_list` / `work_read` | 查找作品；读取版本清单或分页读取文件                    |
| `work_commit`             | 原子更新文件、标题、入口、资源链接；或恢复历史版本      |
| `work_history`            | 分页读取版本链                                          |
| `work_preview`            | 启动指定版本、检查 DOM 文字、输入、点击、读取日志、停止 |
| `work_export`             | 导出独立 HTML 或完整文件归档                            |
| `work_import`             | 验证归档并恢复为新作品                                  |

新建例子：

```json
{
  "requestId": "create-my-page-1",
  "revision": null,
  "title": "我的交互页面",
  "entry": "index.html",
  "put": [
    {
      "path": "index.html",
      "text": "<h1>计数器</h1><button id=counter>0</button><script type=module src=./app.js></script>"
    },
    {
      "path": "app.js",
      "text": "const button = document.querySelector('#counter'); button.onclick = () => button.textContent = Number(button.textContent) + 1;"
    }
  ]
}
```

修改需要 `id`、当前 `revision` 和新 `requestId`，`put` 仅替换列出的文件，`remove` 仅删除列出的路径。断线后保留原参数和 `requestId` 重试，返回原提交；复用同一 ID 提交不同参数会被拒绝。历史版本不会因后续提交而变化。恢复用当前 revision 加 `restoreRevision`，产生一个新版本，保留完整历史。

`work_read` 返回文件时每页最多 32000 字符；后续分页必须携带返回的 revision，不能拿不完整文本替换原文件。二进制或大文件使用 [Bridge 上传与下载](AGENT-BRIDGE.md#文件导入与下载)，把上传所得 `artifact` 放入 `put`。路径是作品内相对路径，拒绝目录穿越、绝对路径与重复修改。

可直接给外部助手的任务：

> 请只通过 BCR MCP 工具创建作品，不修改 BCR 仓库。先读取 work_catalog，创建一个可筛选的资料浏览器，把示例资料保存为 data.json，通过普通 HTML/CSS/JS 实现搜索。保存后用 work_preview 启动指定 revision，模拟搜索并核对结果，根据运行日志修复。最后导出独立 HTML 和作品归档。需要框架构建时使用独立的临时作品目录，再上传构建产物。

## 浏览器运行契约

支持普通 HTML、CSS、JavaScript、原生 ES modules、相对模块导入和字符串字面量动态导入。文件路径区分大小写。模块解析使用 [es-module-lexer](https://github.com/guybedford/es-module-lexer)，编译器将本地模块、样式和资源封装为 data URL 与 import map；预览和导出复用同一份编译逻辑。

HTML 使用 [parse5](https://parse5.js.org/) 解析为语法树，保留 html/body 属性；编译过程不创建活动 DOM、不请求资源或执行脚本。应用声明 `installation.precacheDynamicImports` 即可预缓存离线运行所需的延迟模块，无需在 Service Worker 增加作品专属分支。

```js
const rows = JSON.parse(await bcr.readText("data/rows.json"));
document.querySelector("img").src = bcr.asset("images/cover.png");
console.log("加载条数", rows.length);
```

`bcr.files` 列出当前版本内文件；此 API 不连接宿主工具、数据库或凭据。读取资料使用 `bcr.readText`，而不是网络 `fetch`。没有 npm 安装、TSX 编译或后端进程；React、Vue 等可以在外部构建成浏览器 JS/CSS 后上传。外部依赖、URL、CSS `@import`、自定义 import map、非字面量动态 import 需要预先打包；`import.meta.url` 指向封装后的 data URL，资源定位应使用 `bcr.asset`。

保存和读取不运行脚本。用户点击运行，或授权 Agent 调用 `work_preview` 后才创建 iframe。使用 `sandbox="allow-scripts"`，不开放同源、顶层导航、弹窗、表单、下载和宿主权限；CSP 限制子资源为内嵌资源，并禁用连接、Worker、嵌套 frame、object 与 eval。隔离依据见 [iframe sandbox 文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。

预览通过私有 MessagePort 接收有长度限制的日志、DOM 文字与控件操作结果，不接收任意宿主命令。作品代码和反馈均是不可信内容；作品可以伪造自己的 DOM 或日志，不能把反馈视为可信证明。iframe 也不提供 CPU/内存硬限额，恶意无限循环仍可能卡住页面；它不是任意不可信程序的执行服务。CSP 对资源请求的限制不等于拦截所有自身导航。独立导出的 HTML 会运行其中代码，部署时应放在与 BCR 不同的来源。

## 浏览器作品的存储与版本

```text
UI / 内置助手 / MCP
        │
   WorkStore ───── WorkPreview（浏览器运行适配）
        │                 │
  bcr-works IDB      workDocument（离线封装）
        │
  WorkspaceFiles ── OPFS workspace/files/<hash>
```

- `workspace/files.ts` 是通用、不可变的文件存储。文件统一保存和读取于 `workspace/files/<hash>`，不依赖领域应用的导出目录。
- `workspace/storage.ts` 复用 IndexedDB 事务实现，各应用保留独立数据库与关闭契约。
- `works/store.ts` 只维护版本清单、当前版本指针和幂等回执。文件先按哈希保存；版本、指针、回执在一个事务中提交。Web Locks 串行化同源窗口的版本检查，旧 revision 无法覆盖新版本。
- 未保存 UI 草稿阻止同窗口 Agent 写入，编辑器自身保存携带内部所有者身份。跨窗口按 revision 拒绝过期保存，非实时协同编辑。
- `works/agent.ts` 是薄工具适配器，能力登记使用现有插件系统。MCP Bridge 不认识作品格式、不参与构建、不保存业务数据。
- 作品归档保存选定版本的清单和完整文件闭包，恢复校验大小和哈希，再创建新作品。归档不包含所有历史版本，也不自动抓取 `links` 指向的外部资源。

每个作品最多 200 个文件、合计 256 MiB；预览与单 HTML 导出限制为 10 MiB，单次文本提交为 1.5 MB。未引用的上传文件和旧版本当前不自动回收，避免破坏回溯；后续可基于版本引用增加明确的保留与清理策略。

验证入口：`apps/studio/tests/works.test.ts` 验证版本、冲突、幂等、归档和文件完整性；`bun run test:browser:bridge` 用实际 MCP 和 Chromium 完成成本计算器、资料筛选器、交互时间线的创作、交互、离线导出和恢复，并验证沙箱隔离和桌面/移动界面。
