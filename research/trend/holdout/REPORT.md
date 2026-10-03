# 30分钟冻结通道策略：未回测品种的历史留出验证

引擎：`trend-continuation-14`。继承的冻结选择：`m30-n320-no-day-guard`。基线：`m30-n320-x160`。

本报告审计已有运行并重新汇总账本，选择与资格继承已校验的来源研究；目标品种没有开发期，不重新排名，也不依据目标结果替换候选。新币验证本身不构成时间样本外。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03T09:06:12.739175+00:00。

来源开发域资格：通过描述性门槛。原因：无。资格不构成统计显著性或样本外认证。

来源品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT；来源开发窗口：2022-09-01 至 2024-01-01（结束日不含）。新币的交易数与收益只进入预先声明的目标验证，不重算来源开发资格。

来源计划 SHA-256：`f6db2c3a71c08fbed0a7a6c2b6f7f1538fbf40d29180aafab216e766f2b62594`；来源选择 SHA-256：`d48ac1c7cac700650f00936e606d049546b0168e52c7c686c8d4411a98a75994`；来源开发汇总 SHA-256：`1d56ce09f1e8d860785c73bf584bf383e1241c76523255f62cec32b075c495b2`。完整来源清单保留于 results.json。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：LTCUSDT, LINKUSDT, ADAUSDT, BCHUSDT, ETCUSDT, TRXUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Inherit the original source choice m30-n320-no-day-guard and its source-domain qualification exactly. No target development window, ranking, qualification fit, coin selection, threshold adjustment or fallback winner. Baseline m30-n320-x160 is diagnostic only. The target result cannot revise the frozen source study.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |
|---|---|---|---|---:|
| heldout-symbols | cross-symbol-holdout-known-time | 2024-09-01 | 2026-10-01 | 760 |

## 候选风险覆盖

riskOverrides 仅允许覆盖 dailyLossPct；0 表示关闭日亏损保护。其余风控继承计划，成本压力与策略敏感性派生继承该候选的覆盖值。

日亏损保护按每个独立子账户的 UTC 日开盘 mark 权益建立日锚，分钟 mark 收盘触发后在下一开盘退出并阻止当日再入。它不是日内峰值回撤或整个组合的损失上限；跨日持仓可能在仍盈利时触发，已确认的退出意图不因午夜重置而撤销。

| 候选 | dailyLossPct 生效值 | 来源 |
|---|---:|---|
| m30-n320-no-day-guard | 关闭（0） | 候选覆盖 |
| m30-n320-x160 | 3.00% | 继承计划 |

results.json 每个基础、压力及敏感性结果均记录完整生效 risk 与 riskOverrides；native 配置使用同一份合并规则。

## 全部声明候选的净收益

| 规则 | 新六币留出 · 连续760天 · 同期市场已知 |
|---|---:|
| m30-n320-no-day-guard | 6.25% |
| m30-n320-x160 | 1.83% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| heldout-symbols | m30-n320-no-day-guard | base | 6.25% | 483 | 1.181 | 7.762 | 0.194 |
| heldout-symbols | m30-n320-x160 | base | 1.83% | 490 | 1.053 | 2.238 | 0.078 |
| heldout-symbols | m30-n320-no-day-guard-stress | stress | 1.92% | 485 | 1.056 | 2.373 | 0.060 |
| heldout-symbols | m30-n320-x160-stress | stress | -2.15% | 492 | 0.9374 | -2.617 | -0.052 |

</details>

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| heldout-symbols | 6.25% | 0.385 | -8.77% | 483 | 3/6 | 1904.72 | 856.96 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| heldout-symbols | 2.95% | 8.49% | 0.681 | 0.337 | -2.12% | 666.000 | 666.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| heldout-symbols | 1904.72 | 856.96 | 917.81 | 3679.49 | 7428.59 | 3749.10 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| heldout-symbols / LTCUSDT | -11.43% | -1.060 | -1.749 | -0.362 | -31.61% | 737.906 | 521.23 |
| heldout-symbols / LINKUSDT | 9.69% | 0.716 | 1.295 | 0.567 | -17.09% | 404.313 | 501.69 |
| heldout-symbols / ADAUSDT | 18.77% | 1.194 | 2.548 | 1.260 | -14.90% | 676.964 | 525.07 |
| heldout-symbols / BCHUSDT | -2.09% | -0.117 | -0.228 | -0.085 | -24.63% | 676.911 | 310.91 |
| heldout-symbols / ETCUSDT | -0.84% | -0.007 | -0.013 | -0.050 | -16.75% | 438.790 | 467.68 |
| heldout-symbols / TRXUSDT | 0.75% | 0.131 | 0.277 | 0.041 | -18.55% | 665.992 | 1352.91 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| heldout-symbols | 1.83% | 6.25% | 1.92% | [-0.529, 2.092] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| heldout-symbols | m30-n320-no-day-guard − m30-n320-x160 | +4.42 | +0.45 | [-0.529, 2.092] |

## 证据与复核

计划 SHA-256：`8255384163aa20d51f9743b15dc74567194d762fdaf359ec9533269779059a8e`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`5ebe1df30ea7a46b1ac76cfa7c0ce1af47ddae4480c348a0dc254c92e9579466`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

The inherited primary alone must retain verified source-domain qualification; at least180complete target days,100closed trades and10per declared target symbol undereachcost; target account positive net return anddailyDD>=-10% underbothcosts; absolute mean daily return lower95CI>0 forboth7/28dayblocks andbothcosts. Every condition must pass. Baseline superiority is diagnostic only and cannot replace absolute profitability. No replacement on failure. Passing is cross-symbol historical evidence only, not independent-time or prospective certification; original known-history search conclusion remains unchanged.

以上为冻结计划 transferEvaluation 声明的接受条件。逐项判定由 [transfer-evaluation.json](transfer-evaluation.json) 给出，本通用报告不执行该验收。

- The same historical crypto market periods informed earlier research; held-out symbols are correlated with the development universe.
- Purposive surviving-symbol sample, not a point-in-time reconstruction of all listed or delisted contracts.
- Current static tick/lot/notional constraints differ from historical point-in-time rules and from previously studied symbols.
- The fixed bps minute execution model omits depth, queue position, latency, outages and liquidation mechanics; exposure is capped below equity.
- Evaluation is a one-shot fixed-rule transfer, not another search for the best target coin or parameter.
- True future-time protocol is separately frozen at research/trend/forward-protocol.json; no future returns or automatic monitoring are implied here.
