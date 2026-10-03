# KDJ、慢均线与分阶段退出：有限历史诊断研究

引擎：`trend-continuation-12`。冻结选择：`kdj-5m-be0`。基线：`breakout20-5m-be1`。

本报告审计已有运行并重新汇总账本，保留当时的开发期选择，不重新挑选历史赢家。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03; protocol fixed before any result from this KDJ study was generated or inspected. Every historical window was already used in earlier research.。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Development-2025 only: among the three selectionCandidates with at least ten completed trades in every symbol and a defined finite aggregate daily Sharpe, select the highest Sharpe; ties follow declaration order. Keep qualification separate: at least four profitable symbols and positive median symbol mean net R. If none satisfies the sample gate, stop without substituting a comparator. Freeze the choice before later windows; later failure never causes reselection.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |
|---|---|---|---|---:|
| development-2025 | development | 2025-01-01 | 2026-01-01 | 365 |
| validation-2026-h1 | diagnostic-validation | 2026-01-01 | 2026-07-01 | 181 |
| historical-holdout-2026-q3 | diagnostic-holdout | 2026-07-01 | 2026-10-01 | 92 |

## 全部声明候选的净收益

| 规则 | 开发期 · 已查看历史 | 验证期 · 已查看历史 | 最终历史留出 · 已查看历史 |
|---|---:|---:|---:|
| kdj-5m-be0 | -33.34% | -17.47% | -6.31% |
| kdj-5m-be1 | -37.77% | -20.62% | -9.06% |
| kdj-5m-be2 | -33.40% | -17.46% | -6.30% |
| breakout20-5m-be1 | -93.15% | -82.53% | -65.51% |
| kdj-15m-be1 | -16.35% | -0.70% | -1.64% |
| default-4h-background-long-channel | 1.09% | -1.67% | 0.62% |

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development-2025 | -33.34% | -3.820 | -34.94% | 3011 | 0/6 | 19114.40 | 113.75 |
| validation-2026-h1 | -17.47% | -4.287 | -18.45% | 1417 | 0/6 | 10352.46 | 72.74 |
| historical-holdout-2026-q3 | -6.31% | -2.965 | -6.91% | 747 | 2/6 | 6225.53 | 22.90 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| development-2025 | -33.34% | 10.47% | -5.605 | -0.954 | -1.22% | 350.000 | 350.000 |
| validation-2026-h1 | -32.10% | 8.93% | -5.840 | -1.740 | -1.17% | 179.000 | 179.000 |
| historical-holdout-2026-q3 | -22.80% | 8.60% | -4.491 | -3.302 | -0.80% | 90.000 | 90.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| development-2025 | 19114.40 | 113.75 | 8018.35 | 27246.49 | 7240.27 | -20006.22 |
| validation-2026-h1 | 10352.46 | 72.74 | 4385.80 | 14811.01 | 4329.50 | -10481.51 |
| historical-holdout-2026-q3 | 6225.53 | 22.90 | 2735.15 | 8983.58 | 5194.82 | -3788.76 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development-2025 / BTCUSDT | -41.33% | -4.464 | -5.926 | -0.990 | -41.74% | 338.688 | 4931.81 |
| development-2025 / ETHUSDT | -39.47% | -3.024 | -4.447 | -0.969 | -40.76% | 233.215 | 4469.25 |
| development-2025 / BNBUSDT | -46.42% | -4.590 | -6.195 | -0.930 | -49.92% | 293.822 | 4953.99 |
| development-2025 / SOLUSDT | -35.38% | -2.331 | -3.783 | -0.842 | -42.00% | 351.588 | 3946.36 |
| development-2025 / XRPUSDT | -24.91% | -1.674 | -2.636 | -0.762 | -32.71% | 287.444 | 4657.26 |
| development-2025 / DOGEUSDT | -12.55% | -0.425 | -1.016 | -0.493 | -25.47% | 184.825 | 4287.82 |
| validation-2026-h1 / BTCUSDT | -52.48% | -6.094 | -7.179 | -1.671 | -31.40% | 179.572 | 2632.27 |
| validation-2026-h1 / ETHUSDT | -39.47% | -3.929 | -5.559 | -1.677 | -23.54% | 179.721 | 2320.24 |
| validation-2026-h1 / BNBUSDT | -30.45% | -2.842 | -4.243 | -1.672 | -18.21% | 180.358 | 2738.28 |
| validation-2026-h1 / SOLUSDT | -13.80% | -0.693 | -1.261 | -0.827 | -16.68% | 121.885 | 2346.81 |
| validation-2026-h1 / XRPUSDT | -22.99% | -1.613 | -2.712 | -1.374 | -16.74% | 104.457 | 2568.89 |
| validation-2026-h1 / DOGEUSDT | -29.97% | -2.047 | -3.204 | -1.241 | -24.15% | 179.047 | 2204.52 |
| historical-holdout-2026-q3 / BTCUSDT | -23.64% | -1.490 | -3.028 | -2.402 | -9.84% | 56.463 | 1738.85 |
| historical-holdout-2026-q3 / ETHUSDT | 18.16% | 1.135 | 2.481 | 2.316 | -7.84% | 38.514 | 1547.70 |
| historical-holdout-2026-q3 / BNBUSDT | -51.13% | -6.575 | -8.266 | -2.922 | -17.50% | 84.575 | 1764.30 |
| historical-holdout-2026-q3 / SOLUSDT | -50.67% | -5.070 | -7.175 | -2.880 | -17.59% | 80.978 | 1359.70 |
| historical-holdout-2026-q3 / XRPUSDT | -17.95% | -1.287 | -1.995 | -1.509 | -11.89% | 89.196 | 1374.24 |
| historical-holdout-2026-q3 / DOGEUSDT | 8.50% | 0.558 | 1.102 | 0.780 | -10.91% | 64.171 | 1198.80 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development-2025 | -93.15% | -33.34% | — | [50.320, 72.179] |
| validation-2026-h1 | -82.53% | -17.47% | -34.29% | [71.710, 97.954] |
| historical-holdout-2026-q3 | -65.51% | -6.31% | -18.23% | [91.627, 121.791] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 证据与复核

计划 SHA-256：`4ee928922f190142814bbc863898a20ed6a3ca2db56b01f245ee3160d806513c`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`8de4a144c5158652a42eeb64e2f2df6a33b3b0c8bbe50005ae8179f47358ff62`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

No strategy is established by this reused historical sample. Report development qualification; both later diagnostic windows must have positive selected net returns and positive doubled-cost selected returns before describing historical robustness. Report net-return and daily-drawdown differences against the same-risk breakout baseline and paired daily-return uncertainty regardless of sign. Report the 15-minute and product-reference comparators without reselection. Failure is recorded; no parameter expansion or date changes after results.

- Every date range was inspected in earlier research. The final historical holdout is only a frozen split for this comparison, not untouched OOS or prospective evidence.
- Selection among three thresholds remains another disclosed research trial; block-bootstrap intervals do not correct selection bias or prior research reuse.
- Six surviving liquid USDT perpetuals are not a point-in-time universe and are not six independent asset classes.
- The 15-minute comparator changes sampling frequency; the 4-hour product reference also changes direction and management, so comparisons do not isolate one causal mechanism.
- Fixed precision and fee/slippage assumptions are not historical exchange filters or an order-book execution model.
- Minute OHLC cannot establish intraminute high/low ordering, queue priority, partial fills, liquidation or real live-stop execution.
- Six fixed 10000-USDT sleeves sum to 60000 USDT; no shared margin, netting or capital transfers.
- Per-sleeve Calmar uses minute/fill drawdown; aggregate account Calmar uses daily-close drawdown. Costs already embedded in equity are never deducted again.
