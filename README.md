# BCR

**阅读、写作、绘图与本地计算，在一个浏览器工作区中完成。**

Browser Compute Runtime（BCR）把面向日常使用的 Studio 工作区，与可复用的浏览器计算基础设施放在同一个仓库。文件和工作状态优先保存在本机，耗时任务由 Worker、Rust/WASM 和可用的 WebGPU 执行。

[文档](docs/README.md) · [开发指南](docs/DEVELOPMENT.md) · [架构](docs/ARCHITECTURE.md) · [部署](docs/DEPLOYMENT.md)

## 工作区

| 应用       | 可以做什么                                            | 路由         |
| ---------- | ----------------------------------------------------- | ------------ |
| Reader     | 阅读 EPUB、PDF、TXT 等格式，搜索原文、管理书签与笔记  | `/reader`    |
| 个人知识库 | Markdown 写作、双向链接、附件、版本历史与 GitHub 同步 | `/knowledge` |
| 绘图       | 自由画布、Mermaid、AI 局部编辑与 SVG/PNG 导出         | `/diagram`   |
| Media      | 音视频转字幕、校对、翻译与导出                        | `/media`     |
| Documents  | 文档提取、图片 OCR 与跨应用交接                       | `/documents` |
| Manga      | 漫画 OCR、翻译、清理与排版审校                        | `/manga`     |
| Data       | CSV、JSON、NDJSON 导入、搜索、排序与导出              | `/data`      |
| Market     | 行情、自选、行业表现与历史宽度                        | `/markets`   |
| Quant      | 策略回测、参数实验与冻结数据研究                      | `/quant`     |
| DocGen     | 生成用于识别与阅读验证的虚构账单                      | `/docgen`    |
| 计算工作台 | 查看文件、任务、缓存与本地存储                        | `/studio`    |

应用共享导航、搜索、主题与 AI 助手，也可[分别安装为 PWA](docs/INDEPENDENT-PWAS.md)。阅读摘录可进入资料集合，再关联到知识库；文档与漫画处理结果可交给 Reader 继续阅读。

## 快速开始

准备 Bun、Rust 和 `wasm-pack`；版本与完整环境配置见[开发指南](docs/DEVELOPMENT.md)。

```sh
git clone --recurse-submodules https://github.com/zsh-a/bcr.git
cd bcr
bun install
bun run build:wasm
bun run dev
```

打开 **http://localhost:5199**。WASM 只需在首次启动或对应 Rust 源码变更后重新构建。

```sh
bun run check          # 格式、Lint、类型与依赖边界
bun run test           # TypeScript 单元测试
bun run test:browser   # 核心浏览器回归，自动管理开发服务器
```

浏览器回归需要安装 Playwright Chromium，并使用空闲端口。单项验证、Rust 测试和完整检查见[开发指南](docs/DEVELOPMENT.md#验证)。

## 数据与离线

- **本机优先**：源文件、笔记、图表和阅读记录保存在浏览器存储中；计算产物可通过内容寻址缓存复用。
- **显式联网**：AI 接口、GitHub 同步、行情和首次模型下载需要网络，使用对应功能时才建立连接。
- **离线可用范围**：PWA 缓存应用外壳；本地文件和已下载资源可继续使用，未下载模型与实时数据不在离线范围内。
- **备份由应用提供**：Reader 书库、知识库和图表各有导出入口。更换域名、端口或浏览器不会自动迁移数据，清除站点数据会删除本地内容。

安装不等于独立存储：同源 PWA 共享浏览器存储空间，写入锁仍按各应用的存储契约生效。详见[安装说明](docs/INDEPENDENT-PWAS.md)与[更新和恢复](docs/APP-UPDATES.md)。

## 仓库结构

| 目录             | 职责                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `apps/`          | Studio 宿主，以及可独立启动的 Media、Quant、Market、Manga、DocGen 应用 |
| `packages/`      | Runtime、存储、Agent、共享 UI、领域契约与 Reader/Document/Data 工作台  |
| `crates/`        | Rust 计算内核、Quant 引擎与 Agent Runtime 子模块                       |
| `docs/`          | 使用、开发、架构与维护文档                                             |
| `scripts/`       | 浏览器回归、构建辅助与研究工具                                         |
| `research/`      | 研究索引、冻结证据与复核材料                                           |
| `examples/demo/` | 最小计算与持久化示例                                                   |

核心路径是：**输入文件 → 本地存储 → 调度与 Worker → 可追踪产物 → 缓存与恢复**。会话所有权、任务提交语义和扩展入口见 [Runtime 契约](docs/RUNTIME-ARCHITECTURE.md)。

## 深入了解

- 使用：[Reader](docs/READER-ARCHITECTURE.md) · [知识库](docs/KNOWLEDGE-WORKBENCH.md) · [绘图](docs/DRAWING.md)
- 扩展：[Runtime](docs/RUNTIME-ARCHITECTURE.md) · [Agent](docs/AGENT-UI.md) · [交互约定](docs/WORKSPACE-UI.md)
- 研究：[趋势研究索引](research/trend/README.md) · [研究架构](docs/TREND-RESEARCH-ARCHITECTURE.md)
- 维护：[构建与部署](docs/DEPLOYMENT.md) · [应用更新](docs/APP-UPDATES.md) · [第三方声明](THIRD_PARTY_NOTICES.md)
