# 既有四小时只做多通道策略：固定 40 根与 20 根基线复核

引擎：`trend-continuation-13`。事前固定主候选：`slow-40-long`。基线：`baseline-20-long`。

本报告审计已有运行并重新汇总账本，主候选由计划事前指定；开发期只评价资格，样本不足或失败都不替换候选，后续继续预定的历史诊断。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03; fixed for this recheck before any new replay result is generated. All historical windows and both candidates were inspected in prior research; this is not a new untouched test.。

开发期资格：通过描述性门槛。原因：无。资格不构成统计显著性或样本外认证。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Always keep slow-40-long as the primary. Development qualification is insufficient-sample if any symbol has fewer than ten completed trades or there are fewer than thirty complete UTC days. Otherwise require defined finite aggregate daily Sharpe, at least four profitable symbols and positive finite median symbol mean net R; failure is descriptive and never changes the primary. Do not compare candidate scores to choose a winner. Run all remaining declared diagnostics regardless of qualification.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID                | 声明身份          | 开始日期   | 结束日期（不含） | 日样本数 |
| ----------------- | ----------------- | ---------- | ---------------- | -------: |
| development       | development       | 2022-09-01 | 2024-01-01       |      487 |
| known-2024        | diagnostic-known  | 2024-01-01 | 2024-08-01       |      213 |
| known-2025        | diagnostic-known  | 2025-01-01 | 2026-01-01       |      365 |
| known-2026        | diagnostic-known  | 2026-01-01 | 2026-09-01       |      243 |
| historical-stress | diagnostic-stress | 2022-01-01 | 2022-07-01       |      181 |
| fresh-september   | diagnostic-check  | 2026-09-01 | 2026-10-01       |       30 |

## 全部声明候选的净收益

| 规则             | 开发资格复核 · 已查看历史 | 2024 年 1—7 月 · 已查看历史 | 2025 全年 · 已查看历史 | 2026 年 1—8 月 · 已查看历史 | 2022 年上半年压力 · 已查看历史 | 2026 年 9 月复核 · 已查看历史 |
| ---------------- | ------------------------: | --------------------------: | ---------------------: | --------------------------: | -----------------------------: | ----------------------------: |
| baseline-20-long |                     9.81% |                       3.45% |                  1.52% |                       2.78% |                         -1.86% |                        -0.35% |
| slow-40-long     |                    12.33% |                       5.40% |                  3.17% |                       2.09% |                         -0.23% |                        -0.21% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间              | 方案                    | 成本情景 | 净收益 | 笔数 |  净 PF | 单笔净期望 USDT | 平均净 R |
| ----------------- | ----------------------- | -------- | -----: | ---: | -----: | --------------: | -------: |
| development       | baseline-20-long        | base     |  9.81% |  244 |  1.744 |          24.118 |    0.519 |
| development       | slow-40-long            | base     | 12.33% |  149 |  2.384 |          49.634 |    1.045 |
| known-2024        | baseline-20-long        | base     |  3.45% |  119 |  1.618 |          17.370 |    0.381 |
| known-2024        | slow-40-long            | base     |  5.40% |   68 |  2.301 |          47.632 |    1.030 |
| known-2024        | slow-40-long-stress     | stress   |  4.80% |   68 |  2.162 |          42.368 |    0.959 |
| known-2024        | baseline-20-long-stress | stress   |  2.77% |  119 |  1.491 |          13.963 |    0.322 |
| known-2025        | baseline-20-long        | base     |  1.52% |  208 |  1.155 |           4.373 |    0.101 |
| known-2025        | slow-40-long            | base     |  3.17% |  107 |  1.589 |          17.751 |    0.397 |
| known-2025        | slow-40-long-stress     | stress   |  2.67% |  107 |  1.495 |          14.948 |    0.356 |
| known-2025        | baseline-20-long-stress | stress   |  0.76% |  208 |  1.078 |           2.198 |    0.062 |
| known-2026        | baseline-20-long        | base     |  2.78% |  139 |  1.406 |          11.991 |    0.290 |
| known-2026        | slow-40-long            | base     |  2.09% |   78 |  1.487 |          16.043 |    0.375 |
| known-2026        | slow-40-long-stress     | stress   |  1.65% |   78 |  1.385 |          12.713 |    0.328 |
| known-2026        | baseline-20-long-stress | stress   |  1.92% |  140 |  1.276 |           8.209 |    0.231 |
| historical-stress | baseline-20-long        | base     | -1.86% |   84 | 0.5618 |         -13.310 |   -0.275 |
| historical-stress | slow-40-long            | base     | -0.23% |   41 | 0.8889 |          -3.423 |   -0.072 |
| historical-stress | slow-40-long-stress     | stress   | -0.35% |   41 | 0.8318 |          -5.187 |   -0.098 |
| historical-stress | baseline-20-long-stress | stress   | -1.99% |   84 | 0.5356 |         -14.184 |   -0.301 |
| fresh-september   | baseline-20-long        | base     | -0.35% |   20 |  0.641 |         -10.461 |   -0.217 |
| fresh-september   | slow-40-long            | base     | -0.21% |   12 | 0.6458 |         -10.369 |   -0.215 |
| fresh-september   | slow-40-long-stress     | stress   | -0.24% |   12 |  0.583 |         -12.192 |   -0.255 |
| fresh-september   | baseline-20-long-stress | stress   | -0.40% |   20 | 0.5906 |         -12.086 |   -0.256 |

</details>

## 冻结选择的账户表现

| 区间              | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
| ----------------- | -----: | ------------: | ---------: | ---: | -------: | ----------: | ----------------: |
| development       | 12.33% |         1.785 |     -2.27% |  149 |      5/6 |      242.33 |            292.86 |
| known-2024        |  5.40% |         1.852 |     -2.89% |   68 |      5/6 |       96.71 |            340.62 |
| known-2025        |  3.17% |         0.812 |     -2.69% |  107 |      5/6 |      160.42 |            148.43 |
| known-2026        |  2.09% |         0.644 |     -4.55% |   78 |      5/6 |      132.16 |             77.70 |
| historical-stress | -0.23% |        -0.192 |     -1.70% |   41 |      4/6 |       40.48 |             16.04 |
| fresh-september   | -0.21% |        -0.608 |     -0.67% |   12 |      2/6 |       17.85 |             15.71 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间              | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
| ----------------- | --------: | -------: | ------: | ----------: | -----: | ---------------: | -------------: |
| development       |     9.10% |    4.95% |   3.384 |       4.006 | -0.86% |          190.000 |         23.000 |
| known-2024        |     9.43% |    4.93% |   3.267 |       3.262 | -1.48% |          140.000 |        140.000 |
| known-2025        |     3.17% |    3.93% |   1.311 |       1.179 | -0.85% |          111.000 |         86.000 |
| known-2026        |     3.15% |    5.00% |   1.390 |       0.692 | -0.75% |          227.000 |          4.000 |
| historical-stress |    -0.47% |    2.32% |  -0.291 |      -0.277 | -0.46% |           92.000 |         92.000 |
| fresh-september   |    -2.49% |    4.02% |  -1.025 |      -3.741 | -0.55% |           19.000 |          9.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间              | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 |  净盈亏 |
| ----------------- | -----: | -----------: | ---------: | -----: | ---------: | ------: |
| development       | 242.33 |       292.86 |     112.28 | 647.47 |    8043.01 | 7395.54 |
| known-2024        |  96.71 |       340.62 |      45.04 | 482.37 |    3721.33 | 3238.96 |
| known-2025        | 160.42 |       148.43 |      66.68 | 375.53 |    2274.88 | 1899.35 |
| known-2026        | 132.16 |        77.70 |      56.82 | 266.69 |    1518.08 | 1251.39 |
| historical-stress |  40.48 |        16.04 |      17.71 |  74.22 |     -66.11 | -140.33 |
| fresh-september   |  17.85 |        15.71 |       7.47 |  41.03 |     -83.40 | -124.43 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种                  |    CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
| ---------------------------- | ------: | --------: | ------: | -----: | -----------: | -----------: | ----------: |
| development / BTCUSDT        |  17.11% |     2.071 |   4.565 |  5.396 |       -3.17% |      142.824 |      198.55 |
| development / ETHUSDT        |   1.27% |     0.247 |   0.429 |  0.167 |       -7.57% |      344.569 |      145.98 |
| development / BNBUSDT        |   6.07% |     1.062 |   1.753 |  0.949 |       -6.40% |      259.272 |      -13.54 |
| development / SOLUSDT        |  21.54% |     1.795 |   3.846 |  3.094 |       -6.96% |      277.086 |       90.17 |
| development / XRPUSDT        |  -1.26% |    -0.196 |  -0.314 | -0.205 |       -6.12% |      306.486 |       99.57 |
| development / DOGEUSDT       |   9.27% |     0.847 |   2.003 |  0.833 |      -11.13% |      425.599 |      126.75 |
| known-2024 / BTCUSDT         |  12.39% |     1.800 |   3.148 |  3.345 |       -3.70% |      139.704 |      128.18 |
| known-2024 / ETHUSDT         |  19.21% |     2.339 |   4.880 |  4.156 |       -4.62% |      141.987 |      135.36 |
| known-2024 / BNBUSDT         |   8.84% |     1.039 |   1.557 |  1.730 |       -5.11% |      137.998 |       -3.39 |
| known-2024 / SOLUSDT         |   2.09% |     0.454 |   0.672 |  0.577 |       -3.62% |      148.342 |       53.71 |
| known-2024 / XRPUSDT         |  -2.80% |    -0.436 |  -0.619 | -0.370 |       -7.57% |      154.288 |       79.39 |
| known-2024 / DOGEUSDT        |  17.57% |     1.332 |   2.706 |  2.230 |       -7.88% |      151.632 |       89.12 |
| known-2025 / BTCUSDT         |  -0.25% |    -0.039 |  -0.056 | -0.078 |       -3.20% |      145.903 |       88.56 |
| known-2025 / ETHUSDT         |   4.19% |     0.760 |   1.348 |  1.001 |       -4.18% |      139.820 |       67.61 |
| known-2025 / BNBUSDT         |   9.75% |     1.263 |   2.129 |  2.272 |       -4.29% |      125.551 |       68.08 |
| known-2025 / SOLUSDT         |   2.97% |     0.665 |   1.048 |  0.976 |       -3.04% |      182.849 |       40.04 |
| known-2025 / XRPUSDT         |   1.83% |     0.363 |   0.641 |  0.393 |       -4.65% |      181.070 |       62.09 |
| known-2025 / DOGEUSDT        |   0.51% |     0.114 |   0.183 |  0.124 |       -4.13% |      125.194 |       49.14 |
| known-2026 / BTCUSDT         |   5.70% |     0.913 |   1.874 |  1.421 |       -4.01% |      226.526 |       47.47 |
| known-2026 / ETHUSDT         |   2.09% |     0.435 |   0.747 |  0.579 |       -3.60% |      219.230 |       35.79 |
| known-2026 / BNBUSDT         |  -4.76% |    -0.990 |  -1.537 | -0.596 |       -7.98% |      237.381 |       72.97 |
| known-2026 / SOLUSDT         |   9.85% |     1.368 |   2.706 |  2.388 |       -4.12% |      217.683 |       35.91 |
| known-2026 / XRPUSDT         |   3.26% |     0.442 |   0.987 |  0.393 |       -8.30% |      228.003 |       41.56 |
| known-2026 / DOGEUSDT        |   2.95% |     0.515 |   1.035 |  0.606 |       -4.86% |      187.725 |       32.99 |
| historical-stress / BTCUSDT  |   0.23% |     0.087 |   0.118 |  0.114 |       -1.98% |       94.185 |       19.70 |
| historical-stress / ETHUSDT  |   1.19% |     0.527 |   0.760 |  0.841 |       -1.42% |       93.485 |       12.68 |
| historical-stress / BNBUSDT  |  -4.74% |    -1.777 |  -2.189 | -1.439 |       -3.30% |      142.737 |       -4.88 |
| historical-stress / SOLUSDT  |   3.17% |     0.877 |   1.526 |  1.205 |       -2.63% |       89.433 |       12.97 |
| historical-stress / XRPUSDT  |   1.10% |     0.248 |   0.453 |  0.268 |       -4.10% |      142.729 |       16.79 |
| historical-stress / DOGEUSDT |  -3.65% |    -0.983 |  -1.337 | -0.990 |       -3.69% |      143.149 |       16.97 |
| fresh-september / BTCUSDT    |  -0.34% |    -0.043 |  -0.092 | -0.322 |       -1.07% |       17.461 |        7.64 |
| fresh-september / ETHUSDT    |  -5.52% |    -1.718 |  -2.666 | -5.677 |       -0.97% |        9.918 |        6.52 |
| fresh-september / BNBUSDT    |  -9.79% |    -1.707 |  -2.260 | -5.891 |       -1.66% |       25.269 |       11.84 |
| fresh-september / SOLUSDT    |   9.16% |     2.088 |   4.441 | 10.096 |       -0.91% |        3.655 |        3.83 |
| fresh-september / XRPUSDT    | -11.54% |    -5.000 |  -5.205 | -8.856 |       -1.30% |        8.319 |        3.86 |
| fresh-september / DOGEUSDT   |   4.63% |     0.593 |   1.081 |  2.354 |       -1.97% |       15.104 |        7.32 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间              | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
| ----------------- | ---------: | ---------: | -----------: | --------------------------- |
| development       |      9.81% |     12.33% |            — | [-0.580, 1.603]             |
| known-2024        |      3.45% |      5.40% |        4.80% | [-0.498, 2.440]             |
| known-2025        |      1.52% |      3.17% |        2.67% | [-0.499, 1.400]             |
| known-2026        |      2.78% |      2.09% |        1.65% | [-1.815, 1.092]             |
| historical-stress |     -1.86% |     -0.23% |       -0.35% | [-0.023, 1.858]             |
| fresh-september   |     -0.35% |     -0.21% |       -0.24% | [-2.091, 2.999]             |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 证据与复核

计划 SHA-256：`bac6961b16f63adeac1af32e65e88105e8a46e9c355991ca3fbfa2ad0cc6599f`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`bc80b3d4878ec5f32d6011c024fb035fd731c9cdd170ae5c7298bbe0bd0b2026`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

Report the fixed primary qualification and both full account outcomes in all six windows. In every non-development window also report both primary and baseline with doubled fees/slippage (actual funding unchanged). Retain the source-study checks as descriptive historical checks: positive primary normal and stress returns in known-2024, known-2025 and known-2026, higher primary daily Sharpe than baseline in at least two of those three windows, and no worse daily drawdown in at least two. Disclose 2022 stress and September results separately, including any failure. Report net profit factor, dollar expectancy, mean net R, account return/drawdown, sample size, costs and paired daily-return uncertainty. No check can establish a positive future expectation from these reused observations, and no failure permits reselection or additional parameter search.

- Both candidate definitions and all six historical windows were examined before this plan. Fixing an earlier winner for recheck is conditional on prior selection and does not reset multiple-testing risk.
- The inherited dates omit July-August 2022 and August-December 2024. Some underlying data gaps caused the original boundaries, but entire omitted ranges have not been established as unavailable. No continuous full-history claim is permitted.
- The fresh-september id is an old alignment identifier only. September 2026 is now previously viewed historical data.
- Only two fixed candidates are included. No alternative horizon, direction, filter, breakeven, stop sensitivity, shape condition or post-result fallback is tested.
- Channel length changes both entry and exit horizons and all subsequent positions/risk state. Paired complete-account differences cannot isolate entry timing, transaction costs or an individual trade-level causal effect.
- Both rules are long-only. No buy-and-hold or market-neutral benchmark is simulated in this run; market exposure diagnostics do not establish causal alpha.
- Six surviving liquid crypto perpetuals are not a point-in-time universe and are not six independent asset classes.
- Each of six fixed 10000-USDT sleeves has independent positions/risk state. No shared collateral, netting, cross-margin, rebalancing or dynamic capital transfers.
- Static conservative precision and 5/2 bps per-side fee/slippage assumptions are not historical order-book fills. One-minute OHLC does not model queue priority, liquidation or market impact.
- Costs embedded in equity are never deducted again. Gross-before-cost values are executed-ledger attribution, not a rerun with zero costs; changed costs alter future trading paths.
- The shared v2 evaluation uses minute/fill drawdown per sleeve and daily-close drawdown for the aggregate account. Undefined metrics remain null, and thirty complete days is a display gate rather than proof of sufficient economic evidence.
- All windows start with independent capital and warmup. The six curves must not be joined into one live-equity history. This replay does not validate crude-oil market calendars, contract rollover or live-order execution.
