# 文档

[项目首页](../README.md) → 文档

第一次运行项目，从[开发指南](DEVELOPMENT.md)开始；了解模块关系，先读[架构概览](ARCHITECTURE.md)。

## 使用应用

| 主题             | 文档                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| 阅读与书库       | [Reader](READER-ARCHITECTURE.md)                                                                                   |
| 写作与知识关联   | [知识工作台](KNOWLEDGE-WORKBENCH.md) · [路径与文件夹](KNOWLEDGE-PATHS.md) · [图片与附件](KNOWLEDGE-ATTACHMENTS.md) |
| 多设备笔记       | [GitHub 同步与恢复](KNOWLEDGE-SYNC.md) · [知识库存储](KNOWLEDGE-STORAGE.md)                                        |
| 画布与图表       | [绘图工作区](DRAWING.md)                                                                                           |
| 摘录与资料迁移   | [引用与集合备份](RESEARCH-CITATIONS.md) · [Reader 资料包](RESEARCH-PACKAGE.md)                                     |
| 安装、离线与更新 | [独立 PWA](INDEPENDENT-PWAS.md) · [Notes 入口](KNOWLEDGE-PWA.md) · [更新和恢复](APP-UPDATES.md)                    |

## 开发与维护

| 主题              | 文档                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| 环境、命令与测试  | [开发指南](DEVELOPMENT.md)                                            |
| 生产构建与发布    | [部署](DEPLOYMENT.md)                                                 |
| 分层与所有权      | [架构概览](ARCHITECTURE.md) · [Runtime 契约](RUNTIME-ARCHITECTURE.md) |
| AI 会话与领域工具 | [Agent 接入](AGENT-UI.md) · [本地网关](local-agent-gateway.md)        |
| 界面与主题        | [工作区交互](WORKSPACE-UI.md) · [外观主题](THEMING.md)                |
| 性能测量          | [搜索基准](SEARCH-BENCHMARK.md)                                       |

## 研究与设计依据

| 主题     | 文档                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 量化研究 | [趋势研究总索引](../research/trend/README.md) · [研究架构](TREND-RESEARCH-ARCHITECTURE.md) |
| 策略定义 | [Binance 趋势](BINANCE-TREND.md) · [结构化回调](STRUCTURED-PULLBACK.md)                    |
| TXT 排版 | [章节识别调研](TXT-CHAPTER-RESEARCH.md) · [分页高度调研](TXT-PAGINATION-RESEARCH.md)       |

研究报告中的日期、参数与测量结果描述对应实验；当前应用行为以使用文档和实现为准。冻结证据的维护规则见[研究架构](TREND-RESEARCH-ARCHITECTURE.md#历史证据与维护)。

## 包级文档

- [场景渲染器](../packages/scene-renderer/README.md)
- [Quant Rust 引擎](../crates/quant/README.md)、[基准](../crates/quant/BENCHMARKS.md)与[对账](../crates/quant/RECONCILIATION.md)
- [Agent Runtime](../crates/agent-runtime/README.md)（独立 Git 子模块）

维护文档时，首页保留项目定位和入口，开发命令集中到开发指南，数据契约留在领域文档。避免重复列出版本号、测试总数和逐次变更记录；链接到配置、测试清单或 Git 历史。
