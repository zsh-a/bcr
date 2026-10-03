# 趋势研究架构与扩展约定

系统由一套 Rust 交易内核、浏览器工作台和 Python 研究流程组成。策略计算、账户执行、机会诊断、统计验收和报告展示各自有明确边界；新增实验主要改变声明的数据与规则，不复制成交引擎。全部研究结论及证据身份见[实验总索引](../research/trend/README.md)，具体交易定义见[策略说明](BINANCE-TREND.md)与[结构回调](STRUCTURED-PULLBACK.md)。

当前配置为 v10、执行器为 `trend-continuation-16`、逐币评价为 v2、图表为 `trend-chart-4`。四者分别版本化；本次维护重构不改变交易规则，原生构建由二进制 SHA 另行区分。

## 模块职责

| 层             | 主要位置                                                             | 输入与输出                                                     |
| -------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| 配置与历史契约 | `packages/quant-core/src/trend/`                                     | 当前规则取值、类型、默认值与校验；历史结构与草稿迁移           |
| 行情来源       | `packages/market-data/src/binance/`、Python `download.py`            | 官方档案、校验、完整分钟、资金费与不可变来源清单               |
| 指标与信号     | Rust `indicators.rs`、`signals.rs`、各形态状态机                     | 完整 K 线与市场方向，产生冻结时间依据的入场候选                |
| 账户执行       | Rust `engine.rs`、`execution.rs`、`position.rs`                      | 订单时序、实际数量、成交、现金与持仓；每笔只有一条账本路径     |
| 保护与风控     | Rust `management.rs`、`risk.rs`                                      | 返回止损提案、开仓许可和退出意图，由账户统一执行               |
| 机会观察       | Rust `opportunity.rs`                                                | 同一指标和识别算法的独立状态，输出候选机会、并行门槛与失效原因 |
| 回放输入校验   | Rust `input.rs`                                                      | 共用窗口、连续分钟与 OHLC 检查；校验失败不推进账户或观察状态   |
| 原生适配       | Rust `replay.rs`、`bin/trend.rs`                                     | CSV 分片、候选各自预热、账户及观察结果；每候选状态集中持有     |
| 浏览器适配     | `apps/quant-lab/src/trend/execution/`、`session/`                    | 固定输入、Worker、取消、产物发布、历史恢复与串行持久化         |
| 设置展示       | 浏览器 `workbench/`                                                  | 应用层标签与显式表单；父组件管理草稿、跨字段转换和应用         |
| 实验声明       | Python `protocol.py`、`study.py`、`warmup.py`                        | 规则、标的、日期与来源编译为回放单元，验收凭证控制下一阶段     |
| 证据与回放     | Python `artifacts.py`、`research.py`                                 | 原子写入、SHA、只读边界、缓存、分片校验和原生进程              |
| 账户统计       | Rust `evaluation.rs`；Python `daily.py`、`evaluation.py`、`account_statistics.py` | 逐币及合计账户评价、完整日历和配对分块抽样             |
| 实验验收       | Python `transfer_evaluation.py`、`mechanism_evaluation.py`、`search_evaluation.py` | 各实验的预声明比较、接受标准及多重检验                 |
| 报告与图表     | Python `report.py`、`plot.py`；浏览器 `results/`                     | 消费已经确定的选择、账本和评价，不反向决定规则或阶段资格       |

## 必须保持的边界

**数据与实验分开。** `catalog.json` 只保存来源、覆盖、资金费和曝光；`experiment.json` 声明主假设、有限对照、标的组、时间组、费用及门槛。`study.py` 编译为既有 plan/manifest；阶段凭证从账本重新核对，开发失败不能解锁验证。目录后继仅补充已声明未来数据，保留父 SHA 和旧来源。

**策略只提出意图，账户负责成交。** 信号保存当时的时间、价格、边界与 ATR。`MinuteClose` 与 `TradingClose` 区分更新频率；持仓冻结入场 ATR 和初始风险距离。管理模块返回保护提案；`ExitIntent` 绑定持仓与最早执行时点。已生效止损先检查，新线此后生效，避免用同根高点上调后再在此前低点成交。过滤、止损和研究标签都不直接修改现金。

**共用判断，不共用有不同含义的状态。** 账户与机会观察共用无状态的方向过滤和同一识别代码，但分别持有检测器。账户在持仓、冷却及退出时会重置可识别起点；独立观察持续运行，因此同次突破可有不同 setup ID。不能把观察机会数量减去成交数，当作被风控拒绝的交易数。

**输入校验先于状态推进。** `input.rs` 统一分钟对齐、窗口与预热上限、连续性和 OHLC 合法性。账户额外校验标记价与资金费；观察器仅消费交易价格，保留独立生命周期。独立调用观察器也必须通过相同研究输入检查，不能依赖 CLI 先执行账户来间接保证正确性。拒绝坏分钟后可重试该分钟，结果应与从未输入错误的回放一致。

**三类诊断分开。** `setup_diagnostics.py` 解释实际账户路径与信号快照；`trade_diagnostics.py` 解释已完成交易、退出和成本；`opportunity_diagnostics.py` 评价独立机会在预声明期限内的完整价格路径。旧通道事件工具 `breakout_study.py` 保留它自己的冻结标签协议。收益、净胜率、先达率和固定期限单位 R 的分母与约束不同。

**证据身份属于证据层。** `artifacts.evaluation_identity` 统一绑定 plan、manifest、冻结选择、原始账本及评价版本，保留历史序列化和摘要计算。统计验收、阶段门禁、诊断与报告共同消费它；统计工具不再依赖 `report.py`。报告排版指纹与评价源码指纹分开，排版变化不重选策略或改变阶段资格。

**公共统计不依赖某次实验的验收规则。** `account_statistics.py` 提供完整账户日序列、汇总与配对循环块抽样；转移、机制和搜索评价器直接使用它。转移评价保留剔除单币诊断，机制评价定义比较方向，搜索评价负责候选族多重检验。共用随机抽样顺序与日历约束，不把场景特有标签或接受标准变成通用规则。新共享源码进入各评价器的依赖指纹；旧统计接口兼容历史审计，旧凭证不改写。

**当前规则、界面文字与历史契约分开。** 当前结构回调的合法取值、类型与默认值集中在核心 `structured-policy.ts`；中文标签由应用层完整映射。无状态 `StructuredPullbackSettings` 只编辑该策略字段，父组件负责草稿、验证、跨字段转换及应用。`recorded.ts` 冻结旧版本校验，`archive.ts` 按已校验字段进行展示投影；历史规则版本映射和迁移语义保持显式。旧草稿的迁移默认值不引用随新版本变化的预设，已发布结果不被迁移或补造新字段。

## 统一研究入口

`bun run research:trend --help` 展示全部操作，分组的 `--help` 展示子命令；叶子命令的参数仍由原工具校验。入口只做分发，原脚本和已有 npm 别名继续可用。

| 命令                                                   | 职责                                                 |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `data`                                                 | 下载、校验并冻结显式计划的数据来源                   |
| `study catalog / preflight / compile / seal / extend`  | 数据目录、单元编译、可用性及阶段凭证                 |
| `run`                                                  | 使用显式 `--binary` 回放；构建与执行分开             |
| `audit`                                                | 校验冻结快照或回放收据                               |
| `evaluate transfer / mechanism / search`               | 分别执行冻结转移验收、描述性机制比较、有界候选族检验 |
| `diagnose trades / setups / opportunities / breakouts` | 各自定义下的交易或机会诊断                           |
| `report / plot`                                        | 汇总已审计账户及生成图表                             |

所有写入命令使用新目录。`run` 必须给出 `--binary`，不再隐式构建或默认使用某个历史构建。研究者为新构建选择独立 target；继承旧研究选择时必须使用来源凭证要求的原二进制。

```sh
bun run research:trend audit --frozen
bun run research:trend study --help
bun run research:trend diagnose --help

# 新研究先保存 experiment.json，并引用已核对的数据目录。
bun run research:trend study preflight --catalog research/trend/structured/catalog.json --experiment research/trend/next/experiment.json
bun run research:trend study compile --catalog research/trend/structured/catalog.json --experiment research/trend/next/experiment.json --cell development --output tmp/trend-next/input

# 为本次新构建选择独立路径，保存二进制及其 SHA。
CARGO_TARGET_DIR=tmp/quant-next-build cargo build --release --manifest-path crates/quant/Cargo.toml --bin trend
bun run research:trend run --plan tmp/trend-next/input/plan.json --manifest tmp/trend-next/input/manifest.json --binary tmp/quant-next-build/release/trend --output tmp/trend-next/run
bun run research:trend report --plan tmp/trend-next/input/plan.json --manifest tmp/trend-next/input/manifest.json --input tmp/trend-next/run --output tmp/trend-next/report
bun run research:trend study seal --compilation tmp/trend-next/input/compilation.json --run tmp/trend-next/run --output tmp/trend-next/development-seal.json
```

此示例假定新实验文件已经创建、所需来源已经可用。后续单元通过 `--receipt` 提供前置凭证；开发失败仍保存失败凭证，停止后续阶段。事件诊断需要 NumPy，绘图需要 Matplotlib，可在独立 Python 环境中运行同一个 CLI。统计命令保留各自明确的接受标准，不用统一命令名抹平差异。

## 怎样扩展

| 新需求       | 最小修改面                                     | 必要验证                                                   |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| 新入场机制   | 策略契约、独立识别器、Signals 路由与信号快照   | 只用已完成信息、首次触发消费、双向镜像、预热及分片一致性   |
| 新退出机制   | `management.rs` 的保护提案或退出意图；相应配置 | 初始 R 不变、单调保护、跳空成交、收盘更新与下一分钟时序    |
| 新市场过滤   | 显式策略字段及共用的纯方向判断                 | EMA 未就绪及所有方向组合；原规则交易与观察结果不变         |
| 新研究对照   | 新实验文件、有限候选和事前比较；复用数据目录   | 成本／资金口径一致、来源与曝光、完整失败结果、阶段门禁     |
| 新统计或诊断 | 消费证据层与规范日权益，输出独立评价产物       | 输入身份、样本分母、时间相关性、缺失／未运行状态、成本归因 |
| 新 UI 选项   | 当前契约与选项定义、显式设置、快照展示         | 合法值、旧版读取、草稿迁移、导出恢复，不重算旧信号         |

真正改变规则时更新相应配置或引擎契约；纯整理用全结果回归证明行为不变。当前规模使用显式分支和小型数据结构，避免额外注册器、自动生成表单或第二套模拟账户。多标的共享保证金、资金配置和交易所强平属于新账户模型，不能由统计汇总冒充实现。

原生研究每批最多 16 个候选，研究协议最多 64 个基础候选、128 个展开候选；分片按声明顺序合并，身份及日历全部校验后才发布。每候选保留自己的预热，批处理方式不改变结果。浏览器和 CLI 共用执行内核，但窗口上限分别为 730 与 1096 天。

单批与分片共用 `research.replay_requests` 的缓存、执行与发布流程。配置和原生结果先写临时目录，完成账本、预热、来源及输入身份检查后才发布，收据最后写入。原生失败、结果非法或执行期间输入变化，都不会改写已有配置、结果和收据。缓存命中也核对存储配置，不通过重写配置掩盖损坏。单批保持原生结果字节和既有收据格式；分片额外保留每次原生调用的不可变来源。

## 历史证据与维护

`research/trend/` 的既有计划、账本摘要、分析、图表、专用审计和 `scripts/trend/legacy/` 快照是历史证据。它们可能描述旧规则或旧命令，继续按原字节读取；当前使用方法放在本页，结论总览放在研究索引。冻结构建与原始回放由明确路径及 SHA 关联，不能通过原地重跑更新旧结论。

`scripts/trend/frozen.json` 负责文件哈希和只读路径。当前主配置、历史配置、native/WASM 身份、原始回放、评价与报告来源各自有契约。清理过时说明时更新活跃文档与入口，保留被凭证引用的文件；如果以后归档原始大文件，应记录无损压缩前后哈希及恢复方法。

```sh
bun run research:trend:test
bun run research:trend audit --frozen
bun run typecheck
```

测试涵盖因果执行、账户／观察器、旧结果读取、候选分片、门禁与统计口径。行为不变重构还用冻结输入重放新旧二进制，并比较完整结果。测试与审计通过只说明实现满足所列契约，策略有效性仍以各实验的正式判定为准。
