# 30 分钟趋势策略：机制拆分与冻结选择的历史转移验证

引擎：`trend-continuation-14`。冻结选择：`m30-n320-x160`。基线：`m30-n320-x20`。

本报告审计已有运行并重新汇总账本，保留当时的开发期选择，不重新挑选历史赢家。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03; declared after inspecting prior literature study, before running any new candidate or reading any new transfer-window prices/results. Archive availability checked only via CHECKSUM text and cache metadata.。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Select exactly once on development base-cost daily portfolio Sharpe from the declared six-candidate pool, subject to >=30 completed trades per symbol and finite Sharpe. Ties follow candidate declaration order (baseline first). Stop without inspecting transfer outcomes if none qualify. Do not re-rank after the separate >=4 profitable symbols and positive median-symbol-mean-R qualification; still test the frozen choice, report any qualification failure. N160/N640 are diagnostic only and permanently excluded from selection.

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
| transfer-2021 | historical-transfer | 2021-01-01 | 2022-01-01 | 365 |
| transfer-2024-oct-nov | historical-transfer | 2024-10-01 | 2024-12-01 | 61 |

声明 selected-and-baseline 的窗口仅运行冻结选择与基准；未运行的其他候选明确标记，不视为零收益，也不用于该窗口的比较或重新选择。

## 全部声明候选的净收益

| 规则 | 开发资格复核 · 已查看历史 | 2024 年 1—7 月 · 已查看历史 | 2025 全年 · 已查看历史 | 2026 年 1—8 月 · 已查看历史 | 2022 年上半年压力 · 已查看历史 | 2026 年 9 月复核 · 已查看历史 | 2021 全年 · 新历史反向转移 | 2024 年 10—11 月 · 新历史转移 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| m30-n320-x20 | 3.30% | 0.94% | 8.37% | 11.22% | -1.72% | 0.03% | 12.95% | 2.73% |
| m30-n160-x20 | 1.86% | 1.21% | 4.22% | 12.73% | -3.46% | 1.57% | 未运行 | 未运行 |
| m30-n640-x20 | 3.44% | 1.00% | 3.61% | 6.07% | -0.53% | 0.05% | 未运行 | 未运行 |
| m30-n320-both | 1.08% | 0.63% | 7.55% | 10.12% | -0.03% | -0.83% | 未运行 | 未运行 |
| m30-n320-stop3 | 2.54% | 0.75% | 5.77% | 8.50% | -0.43% | 0.28% | 未运行 | 未运行 |
| m30-n320-x160 | 16.29% | 7.08% | 11.29% | 7.19% | -1.66% | -0.31% | 36.94% | 7.69% |
| m30-n320-background | 0.83% | -0.71% | 5.93% | 4.78% | -2.06% | -1.19% | 未运行 | 未运行 |
| m30-n320-cost02 | -1.22% | -2.91% | 3.75% | 2.70% | -0.79% | -0.34% | 未运行 | 未运行 |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | m30-n320-x20 | base | 3.30% | 343 | 1.169 | 5.766 | 0.124 |
| development | m30-n160-x20 | base | 1.86% | 511 | 1.064 | 2.184 | 0.023 |
| development | m30-n640-x20 | base | 3.44% | 241 | 1.245 | 8.555 | 0.206 |
| development | m30-n320-both | base | 1.08% | 589 | 1.034 | 1.100 | 0.026 |
| development | m30-n320-stop3 | base | 2.54% | 312 | 1.175 | 4.875 | 0.103 |
| development | m30-n320-x160 | base | 16.29% | 247 | 1.88 | 39.569 | 0.895 |
| development | m30-n320-background | base | 0.83% | 189 | 1.078 | 2.628 | 0.051 |
| development | m30-n320-cost02 | base | -1.22% | 208 | 0.8992 | -3.512 | -0.079 |
| known-2024 | m30-n320-x20 | base | 0.94% | 202 | 1.087 | 2.804 | 0.056 |
| known-2024 | m30-n160-x20 | base | 1.21% | 281 | 1.08 | 2.594 | 0.064 |
| known-2024 | m30-n640-x20 | base | 1.00% | 126 | 1.145 | 4.780 | 0.110 |
| known-2024 | m30-n320-both | base | 0.63% | 315 | 1.039 | 1.209 | 0.030 |
| known-2024 | m30-n320-stop3 | base | 0.75% | 180 | 1.096 | 2.505 | 0.049 |
| known-2024 | m30-n320-x160 | base | 7.08% | 138 | 1.686 | 30.776 | 0.720 |
| known-2024 | m30-n320-background | base | -0.71% | 121 | 0.8933 | -3.508 | -0.077 |
| known-2024 | m30-n320-cost02 | base | -2.91% | 129 | 0.5904 | -13.536 | -0.305 |
| known-2024 | m30-n320-x20-stress | stress | -0.60% | 202 | 0.9449 | -1.782 | -0.035 |
| known-2024 | m30-n160-x20-stress | stress | -0.98% | 281 | 0.9352 | -2.100 | -0.037 |
| known-2024 | m30-n640-x20-stress | stress | 0.06% | 126 | 1.009 | 0.286 | 0.025 |
| known-2024 | m30-n320-both-stress | stress | -1.59% | 315 | 0.9038 | -3.021 | -0.056 |
| known-2024 | m30-n320-stop3-stress | stress | -0.21% | 180 | 0.9731 | -0.711 | -0.016 |
| known-2024 | m30-n320-x160-stress | stress | 5.16% | 138 | 1.505 | 22.442 | 0.602 |
| known-2024 | m30-n320-background-stress | stress | -1.55% | 121 | 0.7695 | -7.670 | -0.168 |
| known-2024 | m30-n320-cost02-stress | stress | -1.32% | 28 | 0.2352 | -28.343 | -0.631 |
| known-2025 | m30-n320-x20 | base | 8.37% | 261 | 1.629 | 19.231 | 0.421 |
| known-2025 | m30-n160-x20 | base | 4.22% | 444 | 1.174 | 5.705 | 0.136 |
| known-2025 | m30-n640-x20 | base | 3.61% | 177 | 1.373 | 12.223 | 0.287 |
| known-2025 | m30-n320-both | base | 7.55% | 533 | 1.274 | 8.501 | 0.191 |
| known-2025 | m30-n320-stop3 | base | 5.77% | 238 | 1.593 | 14.547 | 0.314 |
| known-2025 | m30-n320-x160 | base | 11.29% | 173 | 1.985 | 39.169 | 0.903 |
| known-2025 | m30-n320-background | base | 5.93% | 183 | 1.626 | 19.449 | 0.425 |
| known-2025 | m30-n320-cost02 | base | 3.75% | 156 | 1.448 | 14.431 | 0.303 |
| known-2025 | m30-n320-x20-stress | stress | 5.30% | 263 | 1.391 | 12.085 | 0.291 |
| known-2025 | m30-n160-x20-stress | stress | 0.27% | 445 | 1.011 | 0.363 | 0.018 |
| known-2025 | m30-n640-x20-stress | stress | 1.71% | 179 | 1.172 | 5.720 | 0.155 |
| known-2025 | m30-n320-both-stress | stress | 3.00% | 535 | 1.109 | 3.367 | 0.086 |
| known-2025 | m30-n320-stop3-stress | stress | 4.13% | 238 | 1.419 | 10.423 | 0.235 |
| known-2025 | m30-n320-x160-stress | stress | 8.11% | 175 | 1.704 | 27.806 | 0.732 |
| known-2025 | m30-n320-background-stress | stress | 3.92% | 184 | 1.405 | 12.778 | 0.302 |
| known-2025 | m30-n320-cost02-stress | stress | -0.97% | 20 | 0.2259 | -29.223 | -0.629 |
| known-2026 | m30-n320-x20 | base | 11.22% | 152 | 2.362 | 44.293 | 1.046 |
| known-2026 | m30-n160-x20 | base | 12.73% | 253 | 1.908 | 30.193 | 0.755 |
| known-2026 | m30-n640-x20 | base | 6.07% | 102 | 2.093 | 35.717 | 0.837 |
| known-2026 | m30-n320-both | base | 10.12% | 326 | 1.547 | 18.632 | 0.444 |
| known-2026 | m30-n320-stop3 | base | 8.50% | 139 | 2.358 | 36.710 | 0.826 |
| known-2026 | m30-n320-x160 | base | 7.19% | 125 | 1.831 | 34.500 | 0.885 |
| known-2026 | m30-n320-background | base | 4.78% | 81 | 2.072 | 35.440 | 0.779 |
| known-2026 | m30-n320-cost02 | base | 2.70% | 68 | 1.755 | 23.799 | 0.512 |
| known-2026 | m30-n320-x20-stress | stress | 8.31% | 152 | 1.998 | 32.803 | 0.904 |
| known-2026 | m30-n160-x20-stress | stress | 8.00% | 255 | 1.559 | 18.833 | 0.594 |
| known-2026 | m30-n640-x20-stress | stress | 4.62% | 102 | 1.821 | 27.149 | 0.721 |
| known-2026 | m30-n320-both-stress | stress | 5.95% | 327 | 1.32 | 10.922 | 0.314 |
| known-2026 | m30-n320-stop3-stress | stress | 6.71% | 140 | 2.038 | 28.755 | 0.727 |
| known-2026 | m30-n320-x160-stress | stress | 4.96% | 125 | 1.574 | 23.792 | 0.740 |
| known-2026 | m30-n320-background-stress | stress | 3.73% | 81 | 1.828 | 27.651 | 0.667 |
| known-2026 | m30-n320-cost02-stress | stress | -0.65% | 10 | 0.1289 | -38.883 | -0.844 |
| historical-stress | m30-n320-x20 | base | -1.72% | 101 | 0.6588 | -10.232 | -0.228 |
| historical-stress | m30-n160-x20 | base | -3.46% | 168 | 0.5943 | -12.367 | -0.272 |
| historical-stress | m30-n640-x20 | base | -0.53% | 60 | 0.8141 | -5.285 | -0.115 |
| historical-stress | m30-n320-both | base | -0.03% | 277 | 0.9982 | -0.058 | 0.003 |
| historical-stress | m30-n320-stop3 | base | -0.43% | 85 | 0.8592 | -3.010 | -0.066 |
| historical-stress | m30-n320-x160 | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n320-background | base | -2.06% | 66 | 0.3979 | -18.749 | -0.415 |
| historical-stress | m30-n320-cost02 | base | -0.79% | 69 | 0.7418 | -6.859 | -0.148 |
| historical-stress | m30-n320-x20-stress | stress | -2.14% | 101 | 0.5809 | -12.701 | -0.305 |
| historical-stress | m30-n160-x20-stress | stress | -4.16% | 168 | 0.5181 | -14.859 | -0.350 |
| historical-stress | m30-n640-x20-stress | stress | -0.81% | 60 | 0.7177 | -8.110 | -0.192 |
| historical-stress | m30-n320-both-stress | stress | -1.74% | 279 | 0.8815 | -3.743 | -0.081 |
| historical-stress | m30-n320-stop3-stress | stress | -0.74% | 85 | 0.7614 | -5.222 | -0.120 |
| historical-stress | m30-n320-x160-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n320-background-stress | stress | -2.30% | 66 | 0.3394 | -20.888 | -0.489 |
| historical-stress | m30-n320-cost02-stress | stress | -0.86% | 20 | 0.1135 | -25.855 | -0.562 |
| fresh-september | m30-n320-x20 | base | 0.03% | 28 | 1.018 | 0.590 | 0.035 |
| fresh-september | m30-n160-x20 | base | 1.57% | 29 | 2.393 | 32.498 | 0.742 |
| fresh-september | m30-n640-x20 | base | 0.05% | 21 | 1.05 | 1.544 | 0.056 |
| fresh-september | m30-n320-both | base | -0.83% | 39 | 0.6485 | -12.777 | -0.264 |
| fresh-september | m30-n320-stop3 | base | 0.28% | 23 | 1.287 | 7.353 | 0.169 |
| fresh-september | m30-n320-x160 | base | -0.31% | 21 | 0.7795 | -8.940 | -0.179 |
| fresh-september | m30-n320-background | base | -1.19% | 20 | 0.08899 | -35.716 | -0.770 |
| fresh-september | m30-n320-cost02 | base | -0.34% | 17 | 0.644 | -11.911 | -0.254 |
| fresh-september | m30-n320-x20-stress | stress | -0.20% | 28 | 0.8697 | -4.312 | -0.061 |
| fresh-september | m30-n160-x20-stress | stress | 1.18% | 29 | 2.021 | 24.344 | 0.631 |
| fresh-september | m30-n640-x20-stress | stress | -0.11% | 21 | 0.8988 | -3.181 | -0.038 |
| fresh-september | m30-n320-both-stress | stress | -1.07% | 39 | 0.5536 | -16.495 | -0.367 |
| fresh-september | m30-n320-stop3-stress | stress | 0.13% | 23 | 1.128 | 3.318 | 0.100 |
| fresh-september | m30-n320-x160-stress | stress | -0.44% | 21 | 0.6908 | -12.519 | -0.268 |
| fresh-september | m30-n320-background-stress | stress | -1.23% | 20 | 0.06738 | -37.032 | -0.853 |
| fresh-september | m30-n320-cost02-stress | stress | 0.01% | 1 | — | 3.925 | 0.084 |
| transfer-2021 | m30-n320-x20 | base | 12.95% | 363 | 1.614 | 21.405 | 0.418 |
| transfer-2021 | m30-n320-x160 | base | 36.94% | 237 | 2.857 | 93.523 | 1.686 |
| transfer-2021 | m30-n320-x20-stress | stress | 10.80% | 363 | 1.515 | 17.858 | 0.360 |
| transfer-2021 | m30-n320-x160-stress | stress | 35.46% | 236 | 2.791 | 90.153 | 1.700 |
| transfer-2024-oct-nov | m30-n320-x20 | base | 2.73% | 73 | 1.755 | 22.443 | 0.439 |
| transfer-2024-oct-nov | m30-n320-x160 | base | 7.69% | 38 | 4.612 | 121.454 | 2.489 |
| transfer-2024-oct-nov | m30-n320-x20-stress | stress | 2.20% | 73 | 1.601 | 18.063 | 0.347 |
| transfer-2024-oct-nov | m30-n320-x160-stress | stress | 7.17% | 38 | 4.368 | 113.160 | 2.381 |

</details>

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | 16.29% | 1.367 | -6.72% | 247 | 5/6 | 909.42 | 367.80 |
| known-2024 | 7.08% | 1.346 | -4.71% | 138 | 4/6 | 459.45 | 475.20 |
| known-2025 | 11.29% | 1.318 | -5.00% | 173 | 5/6 | 677.98 | 315.37 |
| known-2026 | 7.19% | 0.966 | -8.22% | 125 | 5/6 | 510.82 | 153.17 |
| historical-stress | -1.66% | -0.848 | -3.01% | 77 | 3/6 | 202.84 | 14.24 |
| fresh-september | -0.31% | -0.434 | -1.73% | 21 | 3/6 | 67.73 | 31.05 |
| transfer-2021 | 36.94% | 2.692 | -3.33% | 237 | 6/6 | 593.41 | 2414.24 |
| transfer-2024-oct-nov | 7.69% | 5.144 | -1.44% | 38 | 5/6 | 131.48 | 168.41 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | 11.97% | 8.54% | 2.411 | 1.783 | -2.67% | 296.000 | 23.000 |
| known-2024 | 12.43% | 9.01% | 2.526 | 2.640 | -2.46% | 137.000 | 10.000 |
| known-2025 | 11.29% | 8.38% | 2.388 | 2.260 | -1.83% | 111.000 | 86.000 |
| known-2026 | 10.99% | 11.45% | 2.485 | 1.337 | -1.65% | 227.000 | 4.000 |
| historical-stress | -3.32% | 3.90% | -1.326 | -1.105 | -0.79% | 141.000 | 141.000 |
| fresh-september | -3.74% | 8.07% | -0.696 | -2.169 | -1.13% | 16.000 | 9.000 |
| transfer-2021 | 36.94% | 11.94% | 7.034 | 11.106 | -1.46% | 100.000 | 86.000 |
| transfer-2024-oct-nov | 55.80% | 8.70% | 11.918 | 38.706 | -0.74% | 20.000 | 0.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| development | 909.42 | 367.80 | 425.00 | 1702.23 | 11475.78 | 9773.56 |
| known-2024 | 459.45 | 475.20 | 209.56 | 1144.21 | 5391.35 | 4247.14 |
| known-2025 | 677.98 | 315.37 | 280.98 | 1274.33 | 8050.51 | 6776.18 |
| known-2026 | 510.82 | 153.17 | 218.52 | 882.52 | 5195.01 | 4312.49 |
| historical-stress | 202.84 | 14.24 | 88.60 | 305.68 | -691.34 | -997.02 |
| fresh-september | 67.73 | 31.05 | 28.74 | 127.52 | -60.22 | -187.74 |
| transfer-2021 | 593.41 | 2414.24 | 271.48 | 3279.12 | 25443.97 | 22164.85 |
| transfer-2024-oct-nov | 131.48 | 168.41 | 58.40 | 358.29 | 4973.55 | 4615.26 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development / BTCUSDT | 25.73% | 1.748 | 3.520 | 3.758 | -6.85% | 122.272 | 474.95 |
| development / ETHUSDT | 11.88% | 0.895 | 1.469 | 1.212 | -9.81% | 295.034 | 364.04 |
| development / BNBUSDT | 5.78% | 0.529 | 0.866 | 0.360 | -16.06% | 351.712 | 148.76 |
| development / SOLUSDT | 28.95% | 1.583 | 3.011 | 2.494 | -11.61% | 276.922 | 170.96 |
| development / XRPUSDT | -7.22% | -0.645 | -1.100 | -0.546 | -13.23% | 293.535 | 218.69 |
| development / DOGEUSDT | 5.35% | 0.417 | 0.907 | 0.242 | -22.07% | 425.599 | 324.82 |
| known-2024 / BTCUSDT | 26.29% | 1.667 | 3.343 | 3.516 | -7.48% | 148.372 | 318.78 |
| known-2024 / ETHUSDT | 38.95% | 2.203 | 4.986 | 3.744 | -10.40% | 83.020 | 261.88 |
| known-2024 / BNBUSDT | 22.29% | 1.300 | 2.267 | 3.243 | -6.87% | 140.003 | 74.94 |
| known-2024 / SOLUSDT | -9.06% | -0.761 | -1.172 | -0.713 | -12.70% | 185.548 | 168.96 |
| known-2024 / XRPUSDT | -6.17% | -0.573 | -0.900 | -0.543 | -11.37% | 166.833 | 164.58 |
| known-2024 / DOGEUSDT | 5.72% | 0.415 | 0.792 | 0.447 | -12.80% | 151.632 | 155.07 |
| known-2025 / BTCUSDT | -2.67% | -0.251 | -0.385 | -0.361 | -7.39% | 170.681 | 312.98 |
| known-2025 / ETHUSDT | 13.56% | 1.136 | 2.127 | 1.816 | -7.47% | 139.820 | 208.79 |
| known-2025 / BNBUSDT | 22.04% | 1.458 | 2.794 | 2.787 | -7.91% | 125.554 | 258.90 |
| known-2025 / SOLUSDT | 11.41% | 0.986 | 1.659 | 1.463 | -7.80% | 183.136 | 143.53 |
| known-2025 / XRPUSDT | 14.29% | 1.019 | 2.075 | 1.555 | -9.19% | 175.925 | 200.63 |
| known-2025 / DOGEUSDT | 9.12% | 0.717 | 1.233 | 1.117 | -8.16% | 124.670 | 149.50 |
| known-2026 / BTCUSDT | 12.29% | 0.956 | 1.913 | 1.707 | -7.20% | 226.574 | 178.94 |
| known-2026 / ETHUSDT | 15.32% | 0.909 | 2.762 | 1.764 | -8.68% | 225.265 | 112.86 |
| known-2026 / BNBUSDT | -13.99% | -1.678 | -2.394 | -0.911 | -15.35% | 237.381 | 236.06 |
| known-2026 / SOLUSDT | 23.64% | 1.560 | 3.129 | 2.983 | -7.93% | 218.335 | 122.63 |
| known-2026 / XRPUSDT | 15.00% | 0.939 | 2.370 | 1.230 | -12.19% | 226.635 | 125.30 |
| known-2026 / DOGEUSDT | 15.02% | 0.926 | 1.842 | 1.444 | -10.41% | 187.143 | 106.74 |
| historical-stress / BTCUSDT | 1.95% | 0.355 | 0.539 | 0.573 | -3.40% | 94.185 | 54.39 |
| historical-stress / ETHUSDT | 1.11% | 0.258 | 0.354 | 0.345 | -3.22% | 93.485 | 49.71 |
| historical-stress / BNBUSDT | -6.07% | -0.854 | -1.106 | -0.910 | -6.67% | 91.921 | 40.67 |
| historical-stress / SOLUSDT | -2.86% | -0.335 | -0.544 | -0.457 | -6.25% | 89.433 | 53.86 |
| historical-stress / XRPUSDT | 0.60% | 0.109 | 0.229 | 0.068 | -8.90% | 142.729 | 58.54 |
| historical-stress / DOGEUSDT | -14.17% | -3.154 | -3.543 | -1.715 | -8.26% | 167.735 | 48.50 |
| fresh-september / BTCUSDT | 6.50% | 0.588 | 1.401 | 2.306 | -2.82% | 15.142 | 25.75 |
| fresh-september / ETHUSDT | -21.87% | -5.988 | -5.954 | -9.770 | -2.24% | 19.415 | 19.11 |
| fresh-september / BNBUSDT | 7.20% | 0.486 | 0.766 | 1.871 | -3.85% | 15.850 | 32.42 |
| fresh-september / SOLUSDT | 44.10% | 2.881 | 6.856 | 19.632 | -2.25% | 3.655 | 10.41 |
| fresh-september / XRPUSDT | -30.67% | -5.795 | -5.649 | -9.872 | -3.11% | 27.146 | 19.64 |
| fresh-september / DOGEUSDT | -11.98% | -1.080 | -1.538 | -3.569 | -3.36% | 13.965 | 20.18 |
| transfer-2021 / BTCUSDT | 2.76% | 0.291 | 0.445 | 0.239 | -11.55% | 285.520 | 493.58 |
| transfer-2021 / ETHUSDT | 20.24% | 1.219 | 2.239 | 1.823 | -11.10% | 121.162 | 730.63 |
| transfer-2021 / BNBUSDT | 57.68% | 1.790 | 5.303 | 5.423 | -10.64% | 263.602 | 667.14 |
| transfer-2021 / SOLUSDT | 13.76% | 0.965 | 1.600 | 1.241 | -11.09% | 121.325 | 505.55 |
| transfer-2021 / XRPUSDT | 7.43% | 0.567 | 1.001 | 0.798 | -9.32% | 138.907 | 370.41 |
| transfer-2021 / DOGEUSDT | 119.78% | 1.927 | 11.201 | 7.738 | -15.48% | 153.376 | 511.80 |
| transfer-2024-oct-nov / BTCUSDT | 55.26% | 3.624 | 7.451 | 19.048 | -2.90% | 12.131 | 71.20 |
| transfer-2024-oct-nov / ETHUSDT | 29.67% | 2.231 | 3.955 | 7.129 | -4.16% | 19.933 | 71.44 |
| transfer-2024-oct-nov / BNBUSDT | -30.42% | -7.695 | -7.430 | -5.009 | -6.07% | 53.169 | 69.21 |
| transfer-2024-oct-nov / SOLUSDT | 24.84% | 1.659 | 2.418 | 6.767 | -3.67% | 17.550 | 53.02 |
| transfer-2024-oct-nov / XRPUSDT | 253.41% | 5.984 | 15.756 | 48.974 | -5.17% | 23.058 | 57.27 |
| transfer-2024-oct-nov / DOGEUSDT | 104.49% | 3.958 | 9.075 | 19.349 | -5.40% | 18.625 | 36.14 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development | 3.30% | 16.29% | — | [-0.535, 6.208] |
| known-2024 | 0.94% | 7.08% | 5.16% | [-1.174, 8.164] |
| known-2025 | 8.37% | 11.29% | 8.11% | [-1.646, 3.955] |
| known-2026 | 11.22% | 7.19% | 4.96% | [-3.460, 0.513] |
| historical-stress | -1.72% | -1.66% | -1.92% | [-1.932, 2.488] |
| fresh-september | 0.03% | -0.31% | -0.44% | [-7.014, 5.648] |
| transfer-2021 | 12.95% | 36.94% | 35.46% | [1.562, 10.287] |
| transfer-2024-oct-nov | 2.73% | 7.69% | 7.17% | [-0.417, 16.871] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | m30-n160-x20 − m30-n320-x20 | -1.44 | -0.89 | [-1.163, 0.802] |
| development | m30-n640-x20 − m30-n320-x20 | +0.14 | +0.95 | [-0.720, 0.662] |
| development | m30-n320-both − m30-n320-x20 | -2.22 | +0.89 | [-1.941, 1.535] |
| development | m30-n320-stop3 − m30-n320-x20 | -0.76 | +0.99 | [-0.825, 0.425] |
| development | m30-n320-x160 − m30-n320-x20 | +12.99 | -2.60 | [-0.535, 6.208] |
| development | m30-n320-background − m30-n320-x20 | -2.47 | +2.15 | [-1.825, 0.616] |
| development | m30-n320-cost02 − m30-n320-x20 | -4.51 | +0.15 | [-2.187, 0.180] |
| known-2024 | m30-n160-x20 − m30-n320-x20 | +0.27 | -0.25 | [-1.283, 1.663] |
| known-2024 | m30-n640-x20 − m30-n320-x20 | +0.06 | +0.57 | [-2.535, 1.914] |
| known-2024 | m30-n320-both − m30-n320-x20 | -0.31 | -1.00 | [-2.070, 2.590] |
| known-2024 | m30-n320-stop3 − m30-n320-x20 | -0.19 | +0.66 | [-1.185, 0.886] |
| known-2024 | m30-n320-x160 − m30-n320-x20 | +6.13 | -2.28 | [-1.174, 8.164] |
| known-2024 | m30-n320-background − m30-n320-x20 | -1.65 | +0.28 | [-2.998, 1.162] |
| known-2024 | m30-n320-cost02 − m30-n320-x20 | -3.85 | -0.49 | [-4.674, 0.530] |
| known-2025 | m30-n160-x20 − m30-n320-x20 | -4.14 | -1.66 | [-2.175, 0.192] |
| known-2025 | m30-n640-x20 − m30-n320-x20 | -4.76 | +0.76 | [-2.836, 0.109] |
| known-2025 | m30-n320-both − m30-n320-x20 | -0.81 | -0.99 | [-2.297, 2.159] |
| known-2025 | m30-n320-stop3 − m30-n320-x20 | -2.60 | +0.76 | [-1.603, 0.138] |
| known-2025 | m30-n320-x160 − m30-n320-x20 | +2.93 | -1.64 | [-1.646, 3.955] |
| known-2025 | m30-n320-background − m30-n320-x20 | -2.43 | +0.72 | [-1.780, 0.330] |
| known-2025 | m30-n320-cost02 − m30-n320-x20 | -4.61 | +0.77 | [-2.765, 0.106] |
| known-2026 | m30-n160-x20 − m30-n320-x20 | +1.51 | -2.18 | [-1.836, 4.178] |
| known-2026 | m30-n640-x20 − m30-n320-x20 | -5.15 | +0.33 | [-5.335, 0.373] |
| known-2026 | m30-n320-both − m30-n320-x20 | -1.10 | -4.55 | [-3.577, 3.835] |
| known-2026 | m30-n320-stop3 − m30-n320-x20 | -2.72 | +0.96 | [-3.265, 0.467] |
| known-2026 | m30-n320-x160 − m30-n320-x20 | -4.03 | -4.06 | [-3.460, 0.513] |
| known-2026 | m30-n320-background − m30-n320-x20 | -6.44 | +1.89 | [-8.569, 1.255] |
| known-2026 | m30-n320-cost02 − m30-n320-x20 | -8.52 | +1.73 | [-10.523, 1.106] |
| historical-stress | m30-n160-x20 − m30-n320-x20 | -1.74 | -1.35 | [-2.175, 0.187] |
| historical-stress | m30-n640-x20 − m30-n320-x20 | +1.19 | +0.99 | [-0.209, 1.655] |
| historical-stress | m30-n320-both − m30-n320-x20 | +1.70 | -2.39 | [-3.003, 6.231] |
| historical-stress | m30-n320-stop3 − m30-n320-x20 | +1.30 | +1.30 | [0.126, 1.514] |
| historical-stress | m30-n320-x160 − m30-n320-x20 | +0.06 | -0.31 | [-1.932, 2.488] |
| historical-stress | m30-n320-background − m30-n320-x20 | -0.34 | +0.23 | [-1.774, 1.136] |
| historical-stress | m30-n320-cost02 − m30-n320-x20 | +0.93 | +0.92 | [-0.378, 1.492] |
| fresh-september | m30-n160-x20 − m30-n320-x20 | +1.54 | +0.36 | [-0.937, 11.658] |
| fresh-september | m30-n640-x20 − m30-n320-x20 | +0.03 | +0.08 | [-2.267, 1.973] |
| fresh-september | m30-n320-both − m30-n320-x20 | -0.86 | -0.08 | [-5.690, -0.594] |
| fresh-september | m30-n320-stop3 − m30-n320-x20 | +0.25 | +0.54 | [-1.614, 4.290] |
| fresh-september | m30-n320-x160 − m30-n320-x20 | -0.34 | -0.66 | [-7.014, 5.648] |
| fresh-september | m30-n320-background − m30-n320-x20 | -1.22 | -0.13 | [-9.776, 0.929] |
| fresh-september | m30-n320-cost02 − m30-n320-x20 | -0.37 | +0.40 | [-3.828, 1.660] |
| transfer-2021 | m30-n160-x20 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2021 | m30-n640-x20 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2021 | m30-n320-both − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2021 | m30-n320-stop3 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2021 | m30-n320-x160 − m30-n320-x20 | +23.99 | +0.42 | [1.562, 10.287] |
| transfer-2021 | m30-n320-background − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2021 | m30-n320-cost02 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2024-oct-nov | m30-n160-x20 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2024-oct-nov | m30-n640-x20 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2024-oct-nov | m30-n320-both − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2024-oct-nov | m30-n320-stop3 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2024-oct-nov | m30-n320-x160 − m30-n320-x20 | +4.96 | -0.28 | [-0.417, 16.871] |
| transfer-2024-oct-nov | m30-n320-background − m30-n320-x20 | 未运行 | 未运行 | 未运行 |
| transfer-2024-oct-nov | m30-n320-cost02 − m30-n320-x20 | 未运行 | 未运行 | 未运行 |

## 证据与复核

计划 SHA-256：`c7c302e8d4acaed4b1e7222e98b8b5fd8471207105ea30b25552fb3a7e21fa38`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`8b3585a603720ee2b5217d2666112e972cd20c23618edfb419fa2b381d8a7fea`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

Apply transferEvaluation as frozen. All eight known-history contrasts and seven base paired comparisons remain descriptive and multiplicity-unadjusted. Preserve the prior study acceptance and failed verdict unchanged. The new test does not retroactively pass the old study. If transfer archive completeness is unavailable, report blocked evidence and do not claim acceptance.

- This is another adaptive research round informed by all previous project outcomes. Development data and six diagnostic windows are already known. Sharpe ranking among six mechanisms is model selection, not removal of historical selection bias.
- Eight variants are additional trials; diagnostic comparisons and percentile intervals do not correct the project-wide number of attempts. No DSR claim without complete research-trial accounting.
- The two transfer windows were not used for strategy evaluation in this project before this freeze; they remain retrospectively chosen historical periods, not newly arriving prospective/live data. 2021 is earlier than training. Fixed modern surviving symbols/static lot rules introduce survivorship and historical-execution limitations.
- Only61days in the later transfer; pooled calendar mean weights the365day earlier year more heavily and cannot be presented as a uniformly positive-regime forecast.7/28day blocks are assumptions about dependence, not a guarantee of stationarity.
- Do not chain independent window capital states. Portfolio drawdown is daily; worst-sleeve minute drawdown is different. Simulated minute stop fills cannot model order-book liquidity or guaranteed stop prices.
- Comparisons alter complete account paths and possibly funding; lower turnover, higher winrate or lower costR alone does not prove greater net expectancy. R denominator changes with stop width.
- Predeclared complete-data failure cannot be repaired by outcome-based date/asset exclusion. Report unavailable periods explicitly and preserve all errors.
