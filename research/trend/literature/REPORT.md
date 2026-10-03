# 30 分钟趋势策略的文献启发实验

引擎：`trend-continuation-14`。事前固定主候选：`m30-n40-x20`。基线：`m30-n40-x20`。

本报告审计已有运行并重新汇总账本，主候选由计划事前指定；开发期只评价资格，样本不足或失败都不替换候选，后续继续预定的历史诊断。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03; four contrasts declared before any v8 research outcome was inspected. All market windows are previously viewed historical diagnostics.。

开发期资格：未通过。原因：too-few-profitable-symbols。资格不构成统计显著性或样本外认证。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：The existing 30m N40/exit20 rule is the fixed reference, never a newly selected winner. Development only checks the existing descriptive sample/return qualification. Keep all four variants through all six windows regardless of qualification or results. No rule or parameter is selected for deployment.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |
|---|---|---|---|---:|
| development | development | 2022-09-01 | 2024-01-01 | 487 |
| known-2024 | diagnostic-known | 2024-01-01 | 2024-08-01 | 213 |
| known-2025 | diagnostic-known | 2025-01-01 | 2026-01-01 | 365 |
| known-2026 | diagnostic-known | 2026-01-01 | 2026-09-01 | 243 |
| historical-stress | diagnostic-stress | 2022-01-01 | 2022-07-01 | 181 |
| fresh-september | diagnostic-check | 2026-09-01 | 2026-10-01 | 30 |

## 全部声明候选的净收益

| 规则 | 开发资格复核 · 已查看历史 | 2024 年 1—7 月 · 已查看历史 | 2025 全年 · 已查看历史 | 2026 年 1—8 月 · 已查看历史 | 2022 年上半年压力 · 已查看历史 | 2026 年 9 月复核 · 已查看历史 |
|---|---:|---:|---:|---:|---:|---:|
| m30-n40-x20 | -0.57% | -0.93% | 1.44% | 11.23% | -9.13% | 1.31% |
| m30-n320-x20 | 3.30% | 0.94% | 8.37% | 11.22% | -1.72% | 0.03% |
| m30-n40-x20-episode | -6.55% | -1.32% | -0.47% | 10.75% | -4.76% | 2.43% |
| m30-n40-x40 | 7.04% | 3.33% | 3.75% | 7.29% | -10.41% | 0.65% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | m30-n40-x20 | base | -0.57% | 1219 | 0.9918 | -0.279 | -0.010 |
| development | m30-n320-x20 | base | 3.30% | 343 | 1.169 | 5.766 | 0.124 |
| development | m30-n40-x20-episode | base | -6.55% | 233 | 0.4953 | -16.855 | -0.393 |
| development | m30-n40-x40 | base | 7.04% | 1057 | 1.103 | 3.995 | 0.090 |
| known-2024 | m30-n40-x20 | base | -0.93% | 575 | 0.9703 | -0.971 | -0.021 |
| known-2024 | m30-n320-x20 | base | 0.94% | 202 | 1.087 | 2.804 | 0.056 |
| known-2024 | m30-n40-x20-episode | base | -1.32% | 97 | 0.7547 | -8.149 | -0.191 |
| known-2024 | m30-n40-x40 | base | 3.33% | 491 | 1.108 | 4.074 | 0.137 |
| known-2024 | m30-n40-x20-stress | stress | -5.25% | 575 | 0.8307 | -5.482 | -0.135 |
| known-2024 | m30-n320-x20-stress | stress | -0.60% | 202 | 0.9449 | -1.782 | -0.035 |
| known-2024 | m30-n40-x20-episode-stress | stress | -1.93% | 97 | 0.6434 | -11.951 | -0.317 |
| known-2024 | m30-n40-x40-stress | stress | -0.69% | 491 | 0.9771 | -0.848 | 0.020 |
| known-2025 | m30-n40-x20 | base | 1.44% | 1007 | 1.026 | 0.858 | 0.017 |
| known-2025 | m30-n320-x20 | base | 8.37% | 261 | 1.629 | 19.231 | 0.421 |
| known-2025 | m30-n40-x20-episode | base | -0.47% | 220 | 0.9585 | -1.276 | -0.024 |
| known-2025 | m30-n40-x40 | base | 3.75% | 863 | 1.07 | 2.609 | 0.060 |
| known-2025 | m30-n40-x20-stress | stress | -6.33% | 1011 | 0.8816 | -3.759 | -0.113 |
| known-2025 | m30-n320-x20-stress | stress | 5.30% | 263 | 1.391 | 12.085 | 0.291 |
| known-2025 | m30-n40-x20-episode-stress | stress | -1.83% | 220 | 0.8387 | -4.998 | -0.120 |
| known-2025 | m30-n40-x40-stress | stress | -2.96% | 868 | 0.9434 | -2.047 | -0.043 |
| known-2026 | m30-n40-x20 | base | 11.23% | 604 | 1.326 | 11.157 | 0.309 |
| known-2026 | m30-n320-x20 | base | 11.22% | 152 | 2.362 | 44.293 | 1.046 |
| known-2026 | m30-n40-x20-episode | base | 10.75% | 346 | 1.57 | 18.636 | 0.437 |
| known-2026 | m30-n40-x40 | base | 7.29% | 545 | 1.216 | 8.021 | 0.258 |
| known-2026 | m30-n40-x20-stress | stress | 2.77% | 607 | 1.081 | 2.739 | 0.146 |
| known-2026 | m30-n320-x20-stress | stress | 8.31% | 152 | 1.998 | 32.803 | 0.904 |
| known-2026 | m30-n40-x20-episode-stress | stress | 5.57% | 348 | 1.294 | 9.598 | 0.292 |
| known-2026 | m30-n40-x40-stress | stress | 0.34% | 548 | 1.01 | 0.368 | 0.100 |
| historical-stress | m30-n40-x20 | base | -9.13% | 443 | 0.5993 | -12.366 | -0.278 |
| historical-stress | m30-n320-x20 | base | -1.72% | 101 | 0.6588 | -10.232 | -0.228 |
| historical-stress | m30-n40-x20-episode | base | -4.76% | 255 | 0.6366 | -11.200 | -0.244 |
| historical-stress | m30-n40-x40 | base | -10.41% | 411 | 0.5839 | -15.203 | -0.342 |
| historical-stress | m30-n40-x20-stress | stress | -11.12% | 445 | 0.5185 | -14.999 | -0.367 |
| historical-stress | m30-n320-x20-stress | stress | -2.14% | 101 | 0.5809 | -12.701 | -0.305 |
| historical-stress | m30-n40-x20-episode-stress | stress | -6.12% | 257 | 0.5455 | -14.284 | -0.334 |
| historical-stress | m30-n40-x40-stress | stress | -11.94% | 413 | 0.5241 | -17.350 | -0.426 |
| fresh-september | m30-n40-x20 | base | 1.31% | 83 | 1.297 | 9.438 | 0.203 |
| fresh-september | m30-n320-x20 | base | 0.03% | 28 | 1.018 | 0.590 | 0.035 |
| fresh-september | m30-n40-x20-episode | base | 2.43% | 25 | 4.249 | 58.243 | 1.293 |
| fresh-september | m30-n40-x40 | base | 0.65% | 75 | 1.165 | 5.232 | 0.118 |
| fresh-september | m30-n40-x20-stress | stress | 0.18% | 85 | 1.038 | 1.269 | 0.009 |
| fresh-september | m30-n320-x20-stress | stress | -0.20% | 28 | 0.8697 | -4.312 | -0.061 |
| fresh-september | m30-n40-x20-episode-stress | stress | 1.67% | 27 | 2.657 | 37.087 | 0.886 |
| fresh-september | m30-n40-x40-stress | stress | -0.39% | 77 | 0.9094 | -3.019 | -0.081 |

</details>

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | -0.57% | 0.023 | -9.91% | 1219 | 3/6 | 5188.65 | 411.73 |
| known-2024 | -0.93% | -0.138 | -7.49% | 575 | 3/6 | 2233.08 | 499.84 |
| known-2025 | 1.44% | 0.196 | -7.28% | 1007 | 3/6 | 4120.13 | 362.24 |
| known-2026 | 11.23% | 1.080 | -8.96% | 604 | 4/6 | 2911.66 | 271.33 |
| historical-stress | -9.13% | -2.532 | -9.92% | 443 | 0/6 | 1216.29 | 46.19 |
| fresh-september | 1.31% | 1.282 | -2.42% | 83 | 5/6 | 365.55 | 48.00 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | -0.43% | 12.04% | 0.058 | -0.043 | -1.37% | 345.000 | 345.000 |
| known-2024 | -1.59% | 8.81% | -0.256 | -0.212 | -1.18% | 154.000 | 154.000 |
| known-2025 | 1.44% | 9.69% | 0.390 | 0.198 | -1.14% | 111.000 | 89.000 |
| known-2026 | 17.34% | 15.95% | 3.511 | 1.935 | -1.17% | 227.000 | 10.000 |
| historical-stress | -17.56% | 7.51% | -4.097 | -1.769 | -1.10% | 180.000 | 180.000 |
| fresh-september | 17.10% | 12.95% | 2.921 | 7.073 | -1.03% | 12.000 | 9.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| development | 5188.65 | 411.73 | 2380.17 | 7980.55 | 7640.35 | -340.20 |
| known-2024 | 2233.08 | 499.84 | 1017.09 | 3750.01 | 3191.48 | -558.53 |
| known-2025 | 4120.13 | 362.24 | 1715.12 | 6197.48 | 7061.52 | 864.04 |
| known-2026 | 2911.66 | 271.33 | 1248.32 | 4431.31 | 11169.87 | 6738.57 |
| historical-stress | 1216.29 | 46.19 | 535.22 | 1797.71 | -3680.44 | -5478.15 |
| fresh-september | 365.55 | 48.00 | 152.48 | 566.04 | 1349.43 | 783.39 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development / BTCUSDT | 23.79% | 1.404 | 3.459 | 1.381 | -17.23% | 249.460 | 2114.27 |
| development / ETHUSDT | -12.35% | -1.008 | -1.900 | -0.533 | -23.19% | 340.078 | 1368.09 |
| development / BNBUSDT | -12.27% | -0.939 | -1.748 | -0.449 | -27.30% | 356.278 | 1356.68 |
| development / SOLUSDT | 13.71% | 0.893 | 1.970 | 1.011 | -13.56% | 271.754 | 805.92 |
| development / XRPUSDT | 7.70% | 0.341 | 1.742 | 0.369 | -20.86% | 293.426 | 1228.44 |
| development / DOGEUSDT | -26.17% | -2.332 | -3.882 | -0.737 | -35.49% | 428.256 | 1107.16 |
| known-2024 / BTCUSDT | -1.44% | -0.024 | -0.047 | -0.097 | -14.91% | 154.281 | 851.18 |
| known-2024 / ETHUSDT | 8.36% | 0.690 | 1.374 | 1.027 | -8.14% | 153.516 | 710.40 |
| known-2024 / BNBUSDT | 20.55% | 1.170 | 2.849 | 2.196 | -9.36% | 83.017 | 638.46 |
| known-2024 / SOLUSDT | -7.58% | -0.680 | -1.058 | -0.974 | -7.79% | 211.599 | 407.94 |
| known-2024 / XRPUSDT | -32.52% | -3.007 | -4.178 | -1.398 | -23.27% | 211.585 | 666.01 |
| known-2024 / DOGEUSDT | 6.86% | 0.530 | 1.002 | 0.972 | -7.06% | 148.912 | 476.02 |
| known-2025 / BTCUSDT | -21.80% | -1.980 | -3.252 | -0.941 | -23.17% | 363.149 | 1493.51 |
| known-2025 / ETHUSDT | -6.21% | -0.409 | -0.792 | -0.451 | -13.75% | 197.881 | 910.49 |
| known-2025 / BNBUSDT | -1.90% | -0.067 | -0.133 | -0.102 | -18.61% | 231.992 | 1304.44 |
| known-2025 / SOLUSDT | 1.32% | 0.165 | 0.327 | 0.130 | -10.17% | 346.531 | 794.54 |
| known-2025 / XRPUSDT | 24.52% | 1.525 | 3.623 | 2.966 | -8.26% | 62.562 | 910.35 |
| known-2025 / DOGEUSDT | 12.70% | 0.849 | 1.827 | 1.056 | -12.03% | 120.125 | 784.15 |
| known-2026 / BTCUSDT | 10.41% | 0.678 | 1.734 | 0.834 | -12.48% | 227.156 | 862.40 |
| known-2026 / ETHUSDT | 14.94% | 0.786 | 2.126 | 1.088 | -13.73% | 225.274 | 675.24 |
| known-2026 / BNBUSDT | -1.81% | -0.040 | -0.090 | -0.126 | -14.33% | 228.260 | 961.34 |
| known-2026 / SOLUSDT | 21.73% | 1.318 | 3.211 | 2.637 | -8.24% | 61.240 | 589.32 |
| known-2026 / XRPUSDT | 77.05% | 2.206 | 8.458 | 5.952 | -12.94% | 156.237 | 748.36 |
| known-2026 / DOGEUSDT | -12.05% | -0.651 | -1.304 | -0.580 | -20.76% | 197.824 | 594.64 |
| historical-stress / BTCUSDT | -10.54% | -0.983 | -1.875 | -1.304 | -8.09% | 180.243 | 324.82 |
| historical-stress / ETHUSDT | -13.52% | -1.437 | -2.408 | -1.475 | -9.17% | 89.472 | 306.68 |
| historical-stress / BNBUSDT | -19.02% | -2.033 | -3.236 | -1.521 | -12.51% | 145.748 | 314.31 |
| historical-stress / SOLUSDT | -23.18% | -2.574 | -3.767 | -1.602 | -14.47% | 179.973 | 224.57 |
| historical-stress / XRPUSDT | -16.58% | -1.556 | -2.715 | -1.276 | -13.00% | 142.729 | 351.98 |
| historical-stress / DOGEUSDT | -22.13% | -2.320 | -3.446 | -1.500 | -14.75% | 143.149 | 275.35 |
| fresh-september / BTCUSDT | 9.68% | 0.674 | 1.458 | 2.686 | -3.60% | 17.477 | 126.05 |
| fresh-september / ETHUSDT | -15.29% | -1.110 | -1.718 | -3.537 | -4.32% | 23.889 | 91.07 |
| fresh-september / BNBUSDT | 13.46% | 0.816 | 1.801 | 2.892 | -4.65% | 25.269 | 135.42 |
| fresh-september / SOLUSDT | 31.22% | 1.574 | 3.414 | 11.515 | -2.71% | 12.047 | 71.03 |
| fresh-september / XRPUSDT | 41.75% | 2.521 | 5.336 | 14.672 | -2.85% | 10.928 | 66.34 |
| fresh-september / DOGEUSDT | 30.55% | 1.753 | 4.079 | 6.737 | -4.54% | 16.420 | 76.13 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development | -0.57% | -0.57% | — | [0.000, 0.000] |
| known-2024 | -0.93% | -0.93% | -5.25% | [0.000, 0.000] |
| known-2025 | 1.44% | 1.44% | -6.33% | [0.000, 0.000] |
| known-2026 | 11.23% | 11.23% | 2.77% | [0.000, 0.000] |
| historical-stress | -9.13% | -9.13% | -11.12% | [0.000, 0.000] |
| fresh-september | 1.31% | 1.31% | 0.18% | [0.000, 0.000] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | m30-n320-x20 − m30-n40-x20 | +3.86 | +5.79 | [-3.525, 4.411] |
| development | m30-n40-x20-episode − m30-n40-x20 | -5.98 | +3.15 | [-6.220, 2.926] |
| development | m30-n40-x40 − m30-n40-x20 | +7.61 | -0.60 | [-0.153, 3.495] |
| known-2024 | m30-n320-x20 − m30-n40-x20 | +1.87 | +5.06 | [-3.474, 4.829] |
| known-2024 | m30-n40-x20-episode − m30-n40-x20 | -0.39 | +4.89 | [-5.871, 4.599] |
| known-2024 | m30-n40-x40 − m30-n40-x20 | +4.27 | +0.10 | [-1.227, 6.463] |
| known-2025 | m30-n320-x20 − m30-n40-x20 | +6.93 | +3.93 | [-1.886, 5.023] |
| known-2025 | m30-n40-x20-episode − m30-n40-x20 | -1.91 | +2.79 | [-5.445, 3.614] |
| known-2025 | m30-n40-x40 − m30-n40-x20 | +2.31 | -0.99 | [-1.711, 3.482] |
| known-2026 | m30-n320-x20 − m30-n40-x20 | -0.01 | +4.80 | [-5.956, 5.122] |
| known-2026 | m30-n40-x20-episode − m30-n40-x20 | -0.48 | +3.69 | [-6.816, 4.512] |
| known-2026 | m30-n40-x40 − m30-n40-x20 | -3.95 | -4.13 | [-3.599, 0.937] |
| historical-stress | m30-n320-x20 − m30-n40-x20 | +7.41 | +7.23 | [-0.322, 8.296] |
| historical-stress | m30-n40-x20-episode − m30-n40-x20 | +4.37 | +4.21 | [0.064, 5.255] |
| historical-stress | m30-n40-x40 − m30-n40-x20 | -1.28 | -2.16 | [-2.893, 1.901] |
| fresh-september | m30-n320-x20 − m30-n40-x20 | -1.28 | +1.35 | [-20.508, 11.207] |
| fresh-september | m30-n40-x20-episode − m30-n40-x20 | +1.12 | +1.18 | [-6.286, 14.711] |
| fresh-september | m30-n40-x40 − m30-n40-x20 | -0.65 | -0.19 | [-6.087, 1.523] |

## 证据与复核

计划 SHA-256：`693a71c9bced151ce2cd6d66098015752b81445c92ed12dad02d59358f9b4db9`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`e2cf01652ee014f046894d5e007ce186f22589e7f721a0cc41f1b136fd4244a2`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

No deployment or established positive expectation claim. A candidate only merits further forward validation if its development qualification passes and its net returns remain positive at both base and stressed costs in all five diagnostic windows; report every failure. Also publish paired daily-return means and seven-day block intervals for all three comparisons, trade count/cost reduction, net expectancy, payoff, tail contribution and daily drawdown. Relative improvement alone is not evidence of absolute positive expectation. September is only 30 known days. Do not change parameters after seeing outcomes.

- All six windows and previous strategy outcomes influenced the research proposal; these are new declared mechanisms on previously seen prices, not untouched OOS.
- Three proposed contrasts are additional research trials; seven-day block intervals are descriptive and not corrected for all project-wide attempts.
- Long-entry fixes the 30m ATR and 20-bar exit while changing entry horizon; it is not a complete reproduction of the prior 4h strategy. Its warmup starts six days earlier and Wilder ATR seeding can differ initially.
- Episode raw signal consumption while held or risk-disabled can miss profitable re-entry; lower turnover does not imply better net performance.
- The slower-exit full-account contrast changes subsequent entry opportunities as well as exit timing; it does not isolate direct exit effects on identical entries.
- The inherited dates omit July-August 2022 and August-December 2024. Some underlying data gaps caused the original boundaries, but entire omitted ranges have not been established as unavailable. No continuous full-history claim is permitted.
- The fresh-september id is an old alignment identifier only. September 2026 is now previously viewed historical data.
- Long-only surviving crypto assets, fixed separate capital sleeves, static precision and simulated minute fills have the same market and execution limits as the source study.
- Each window starts with independent capital/warmup; inherited omitted date ranges remain. Never concatenate returns or interpret daily portfolio drawdown as minute portfolio drawdown.
