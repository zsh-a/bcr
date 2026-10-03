# 30 分钟趋势策略：固定风控消融、尺度稳定性与历史缺口补全

引擎：`trend-continuation-14`。事前固定主候选：`m30-n320-x160`。基线：`m30-n320-x160`。

本报告审计已有运行并重新汇总账本，主候选由计划事前指定；开发期只评价资格，样本不足或失败都不替换候选，后续继续预定的历史诊断。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03T07:45:00Z; declared before new candidate replay or completion-window price/return inspection; archive availability and timestamp completeness inspected only.。

开发期资格：通过描述性门槛。原因：无。资格不构成统计显著性或样本外认证。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Primary remains m30-n320-x160 from the prior frozen study regardless of these results. Development qualification is descriptive; never reselect after failure. Other candidates isolate removal of the full daily guard and fixed half/double entry/exit lookbacks. No candidate is promoted by ranking.

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
| transfer-2021 | diagnostic-known | 2021-01-01 | 2022-01-01 | 365 |
| transfer-2024-oct-nov | diagnostic-known | 2024-10-01 | 2024-12-01 | 61 |
| completion-2022-aug | historical-completion | 2022-08-01 | 2022-09-01 | 31 |
| completion-2024-sep | historical-completion | 2024-09-01 | 2024-10-01 | 30 |
| completion-2024-dec | historical-completion | 2024-12-01 | 2025-01-01 | 31 |

## 候选风险覆盖

riskOverrides 仅允许覆盖 dailyLossPct；0 表示关闭日亏损保护。其余风控继承计划，成本压力与策略敏感性派生继承该候选的覆盖值。

日亏损保护按每个独立子账户的 UTC 日开盘 mark 权益建立日锚，分钟 mark 收盘触发后在下一开盘退出并阻止当日再入。它不是日内峰值回撤或整个组合的损失上限；跨日持仓可能在仍盈利时触发，已确认的退出意图不因午夜重置而撤销。

| 候选 | dailyLossPct 生效值 | 来源 |
|---|---:|---|
| m30-n320-x160 | 3.00% | 继承计划 |
| m30-n320-x160-no-day-guard | 关闭（0） | 候选覆盖 |
| m30-n160-x80 | 3.00% | 继承计划 |
| m30-n640-x320 | 3.00% | 继承计划 |

results.json 每个基础、压力及敏感性结果均记录完整生效 risk 与 riskOverrides；native 配置使用同一份合并规则。

## 全部声明候选的净收益

| 规则 | 开发资格复核 · 已查看历史 | 2024 年 1—7 月 · 已查看历史 | 2025 全年 · 已查看历史 | 2026 年 1—8 月 · 已查看历史 | 2022 年上半年压力 · 已查看历史 | 2026 年 9 月复核 · 已查看历史 | 2021 全年 · 已查看历史 | 2024 年 10—11 月 · 已查看历史 | 2022 年 8 月 · 历史补全 | 2024 年 9 月 · 历史补全 | 2024 年 12 月 · 历史补全 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| m30-n320-x160 | 16.29% | 7.08% | 11.29% | 7.19% | -1.66% | -0.31% | 36.94% | 7.69% | -1.15% | -0.03% | -0.54% |
| m30-n320-x160-no-day-guard | 23.90% | 10.34% | 9.72% | 7.19% | -1.66% | -0.31% | 48.47% | 18.84% | -1.15% | -0.03% | -0.75% |
| m30-n160-x80 | 11.98% | 8.71% | 10.19% | 8.67% | -4.34% | 2.13% | 29.63% | 8.71% | -1.83% | -1.13% | -1.52% |
| m30-n640-x320 | 13.44% | 6.87% | 8.63% | 3.47% | -1.15% | -0.45% | 19.37% | 6.08% | -0.57% | -0.56% | -0.14% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | m30-n320-x160 | base | 16.29% | 247 | 1.88 | 39.569 | 0.895 |
| development | m30-n320-x160-no-day-guard | base | 23.90% | 243 | 2.288 | 59.014 | 1.329 |
| development | m30-n160-x80 | base | 11.98% | 418 | 1.394 | 17.190 | 0.403 |
| development | m30-n640-x320 | base | 13.44% | 176 | 1.954 | 45.822 | 1.076 |
| known-2024 | m30-n320-x160 | base | 7.08% | 138 | 1.686 | 30.776 | 0.720 |
| known-2024 | m30-n320-x160-no-day-guard | base | 10.34% | 128 | 2.089 | 48.457 | 1.107 |
| known-2024 | m30-n160-x80 | base | 8.71% | 205 | 1.62 | 25.489 | 0.587 |
| known-2024 | m30-n640-x320 | base | 6.87% | 80 | 2.077 | 51.509 | 1.213 |
| known-2024 | m30-n320-x160-stress | stress | 5.16% | 138 | 1.505 | 22.442 | 0.602 |
| known-2024 | m30-n320-x160-no-day-guard-stress | stress | 8.49% | 128 | 1.902 | 39.784 | 1.016 |
| known-2024 | m30-n160-x80-stress | stress | 6.15% | 205 | 1.442 | 17.994 | 0.472 |
| known-2024 | m30-n640-x320-stress | stress | 5.50% | 80 | 1.873 | 41.252 | 1.104 |
| known-2025 | m30-n320-x160 | base | 11.29% | 173 | 1.985 | 39.169 | 0.903 |
| known-2025 | m30-n320-x160-no-day-guard | base | 9.72% | 173 | 1.852 | 33.721 | 0.783 |
| known-2025 | m30-n160-x80 | base | 10.19% | 338 | 1.44 | 18.097 | 0.443 |
| known-2025 | m30-n640-x320 | base | 8.63% | 112 | 2.066 | 46.223 | 1.133 |
| known-2025 | m30-n320-x160-stress | stress | 8.11% | 175 | 1.704 | 27.806 | 0.732 |
| known-2025 | m30-n320-x160-no-day-guard-stress | stress | 7.10% | 175 | 1.618 | 24.333 | 0.649 |
| known-2025 | m30-n160-x80-stress | stress | 5.98% | 338 | 1.261 | 10.618 | 0.320 |
| known-2025 | m30-n640-x320-stress | stress | 6.13% | 113 | 1.759 | 32.572 | 0.946 |
| known-2026 | m30-n320-x160 | base | 7.19% | 125 | 1.831 | 34.500 | 0.885 |
| known-2026 | m30-n320-x160-no-day-guard | base | 7.19% | 124 | 1.833 | 34.780 | 0.897 |
| known-2026 | m30-n160-x80 | base | 8.67% | 222 | 1.592 | 23.444 | 0.677 |
| known-2026 | m30-n640-x320 | base | 3.47% | 83 | 1.588 | 25.081 | 0.646 |
| known-2026 | m30-n320-x160-stress | stress | 4.96% | 125 | 1.574 | 23.792 | 0.740 |
| known-2026 | m30-n320-x160-no-day-guard-stress | stress | 5.15% | 124 | 1.598 | 24.934 | 0.778 |
| known-2026 | m30-n160-x80-stress | stress | 4.36% | 227 | 1.289 | 11.536 | 0.490 |
| known-2026 | m30-n640-x320-stress | stress | 1.93% | 86 | 1.311 | 13.458 | 0.435 |
| historical-stress | m30-n320-x160 | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n320-x160-no-day-guard | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n160-x80 | base | -4.34% | 142 | 0.5515 | -18.317 | -0.402 |
| historical-stress | m30-n640-x320 | base | -1.15% | 42 | 0.6106 | -16.401 | -0.352 |
| historical-stress | m30-n320-x160-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n320-x160-no-day-guard-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n160-x80-stress | stress | -4.82% | 142 | 0.5024 | -20.360 | -0.477 |
| historical-stress | m30-n640-x320-stress | stress | -1.29% | 42 | 0.5623 | -18.448 | -0.423 |
| fresh-september | m30-n320-x160 | base | -0.31% | 21 | 0.7795 | -8.940 | -0.179 |
| fresh-september | m30-n320-x160-no-day-guard | base | -0.31% | 21 | 0.7795 | -8.940 | -0.179 |
| fresh-september | m30-n160-x80 | base | 2.13% | 19 | 3.226 | 67.314 | 1.552 |
| fresh-september | m30-n640-x320 | base | -0.45% | 17 | 0.6157 | -15.832 | -0.344 |
| fresh-september | m30-n320-x160-stress | stress | -0.44% | 21 | 0.6908 | -12.519 | -0.268 |
| fresh-september | m30-n320-x160-no-day-guard-stress | stress | -0.44% | 21 | 0.6908 | -12.519 | -0.268 |
| fresh-september | m30-n160-x80-stress | stress | 1.74% | 19 | 2.807 | 54.855 | 1.438 |
| fresh-september | m30-n640-x320-stress | stress | -0.53% | 17 | 0.5496 | -18.532 | -0.432 |
| transfer-2021 | m30-n320-x160 | base | 36.94% | 237 | 2.857 | 93.523 | 1.686 |
| transfer-2021 | m30-n320-x160-no-day-guard | base | 48.47% | 228 | 3.347 | 127.548 | 2.343 |
| transfer-2021 | m30-n160-x80 | base | 29.63% | 391 | 1.904 | 45.474 | 0.820 |
| transfer-2021 | m30-n640-x320 | base | 19.37% | 179 | 2.338 | 64.915 | 1.369 |
| transfer-2021 | m30-n320-x160-stress | stress | 35.46% | 236 | 2.791 | 90.153 | 1.700 |
| transfer-2021 | m30-n320-x160-no-day-guard-stress | stress | 44.77% | 228 | 3.203 | 117.808 | 2.286 |
| transfer-2021 | m30-n160-x80-stress | stress | 26.24% | 392 | 1.808 | 40.171 | 0.757 |
| transfer-2021 | m30-n640-x320-stress | stress | 17.22% | 180 | 2.194 | 57.384 | 1.268 |
| transfer-2024-oct-nov | m30-n320-x160 | base | 7.69% | 38 | 4.612 | 121.454 | 2.489 |
| transfer-2024-oct-nov | m30-n320-x160-no-day-guard | base | 18.84% | 37 | 9.847 | 305.521 | 6.734 |
| transfer-2024-oct-nov | m30-n160-x80 | base | 8.71% | 63 | 3.36 | 82.911 | 1.705 |
| transfer-2024-oct-nov | m30-n640-x320 | base | 6.08% | 33 | 3.883 | 110.516 | 2.308 |
| transfer-2024-oct-nov | m30-n320-x160-stress | stress | 7.17% | 38 | 4.368 | 113.160 | 2.381 |
| transfer-2024-oct-nov | m30-n320-x160-no-day-guard-stress | stress | 17.37% | 37 | 9.161 | 281.599 | 6.632 |
| transfer-2024-oct-nov | m30-n160-x80-stress | stress | 7.59% | 65 | 2.98 | 70.102 | 1.495 |
| transfer-2024-oct-nov | m30-n640-x320-stress | stress | 5.74% | 33 | 3.685 | 104.430 | 2.209 |
| completion-2022-aug | m30-n320-x160 | base | -1.15% | 17 | 0.07809 | -40.648 | -0.881 |
| completion-2022-aug | m30-n320-x160-no-day-guard | base | -1.15% | 17 | 0.07809 | -40.648 | -0.881 |
| completion-2022-aug | m30-n160-x80 | base | -1.83% | 29 | 0.1696 | -37.825 | -0.829 |
| completion-2022-aug | m30-n640-x320 | base | -0.57% | 9 | 0.0229 | -38.183 | -0.817 |
| completion-2022-aug | m30-n320-x160-stress | stress | -1.17% | 17 | 0.06675 | -41.132 | -0.952 |
| completion-2022-aug | m30-n320-x160-no-day-guard-stress | stress | -1.17% | 17 | 0.06675 | -41.132 | -0.952 |
| completion-2022-aug | m30-n160-x80-stress | stress | -1.86% | 29 | 0.1558 | -38.470 | -0.906 |
| completion-2022-aug | m30-n640-x320-stress | stress | -0.58% | 9 | 0.01391 | -38.974 | -0.880 |
| completion-2024-sep | m30-n320-x160 | base | -0.03% | 23 | 0.9763 | -0.872 | -0.015 |
| completion-2024-sep | m30-n320-x160-no-day-guard | base | -0.03% | 23 | 0.9763 | -0.872 | -0.015 |
| completion-2024-sep | m30-n160-x80 | base | -1.13% | 36 | 0.5269 | -18.890 | -0.418 |
| completion-2024-sep | m30-n640-x320 | base | -0.56% | 21 | 0.5841 | -15.958 | -0.355 |
| completion-2024-sep | m30-n320-x160-stress | stress | -0.18% | 23 | 0.8688 | -4.812 | -0.107 |
| completion-2024-sep | m30-n320-x160-no-day-guard-stress | stress | -0.18% | 23 | 0.8688 | -4.812 | -0.107 |
| completion-2024-sep | m30-n160-x80-stress | stress | -1.27% | 36 | 0.469 | -21.157 | -0.512 |
| completion-2024-sep | m30-n640-x320-stress | stress | -0.65% | 21 | 0.5154 | -18.689 | -0.449 |
| completion-2024-dec | m30-n320-x160 | base | -0.54% | 17 | 0.571 | -19.119 | -0.446 |
| completion-2024-dec | m30-n320-x160-no-day-guard | base | -0.75% | 17 | 0.4094 | -26.302 | -0.597 |
| completion-2024-dec | m30-n160-x80 | base | -1.52% | 31 | 0.3615 | -29.476 | -0.659 |
| completion-2024-dec | m30-n640-x320 | base | -0.14% | 10 | 0.8167 | -8.633 | -0.213 |
| completion-2024-dec | m30-n320-x160-stress | stress | -0.58% | 17 | 0.5373 | -20.644 | -0.531 |
| completion-2024-dec | m30-n320-x160-no-day-guard-stress | stress | -0.78% | 17 | 0.383 | -27.505 | -0.682 |
| completion-2024-dec | m30-n160-x80-stress | stress | -1.57% | 31 | 0.3412 | -30.406 | -0.739 |
| completion-2024-dec | m30-n640-x320-stress | stress | -0.17% | 10 | 0.7788 | -10.360 | -0.290 |

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
| completion-2022-aug | -1.15% | -5.977 | -1.15% | 17 | 0/6 | 45.50 | 5.93 |
| completion-2024-sep | -0.03% | -0.027 | -1.06% | 23 | 4/6 | 77.14 | 26.43 |
| completion-2024-dec | -0.54% | -1.678 | -1.65% | 17 | 1/6 | 53.80 | 28.49 |

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
| completion-2022-aug | -12.75% | 2.28% | -6.278 | -11.070 | -0.37% | 29.000 | 29.000 |
| completion-2024-sep | -0.41% | 6.83% | -0.039 | -0.383 | -0.81% | 11.000 | 3.000 |
| completion-2024-dec | -6.20% | 3.77% | -2.588 | -3.764 | -0.37% | 29.000 | 29.000 |

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
| completion-2022-aug | 45.50 | 5.93 | 21.11 | 72.53 | -618.49 | -691.02 |
| completion-2024-sep | 77.14 | 26.43 | 37.75 | 141.32 | 121.27 | -20.06 |
| completion-2024-dec | 53.80 | 28.49 | 21.96 | 104.25 | -220.78 | -325.03 |

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
| completion-2022-aug / BTCUSDT | -11.29% | -4.092 | -4.139 | -5.470 | -2.06% | 23.493 | 13.35 |
| completion-2022-aug / ETHUSDT | -4.89% | -0.971 | -1.384 | -2.181 | -2.24% | 17.671 | 9.64 |
| completion-2022-aug / BNBUSDT | -5.64% | -1.376 | -1.815 | -3.954 | -1.43% | 21.371 | 9.35 |
| completion-2022-aug / SOLUSDT | -16.25% | -3.712 | -4.040 | -8.534 | -1.90% | 18.743 | 11.87 |
| completion-2022-aug / XRPUSDT | -11.13% | -4.936 | -4.853 | -8.418 | -1.32% | 11.952 | 10.48 |
| completion-2022-aug / DOGEUSDT | -25.68% | -3.445 | -4.083 | -8.465 | -3.03% | 17.307 | 17.84 |
| completion-2024-sep / BTCUSDT | 3.11% | 0.458 | 0.744 | 1.462 | -2.13% | 13.637 | 19.25 |
| completion-2024-sep / ETHUSDT | 2.20% | 0.304 | 0.443 | 1.155 | -1.91% | 9.231 | 22.37 |
| completion-2024-sep / BNBUSDT | 5.10% | 0.468 | 0.675 | 1.675 | -3.04% | 8.047 | 22.02 |
| completion-2024-sep / SOLUSDT | 29.94% | 2.083 | 3.644 | 11.549 | -2.59% | 10.266 | 21.78 |
| completion-2024-sep / XRPUSDT | -26.41% | -8.040 | -7.518 | -10.611 | -2.49% | 18.458 | 26.37 |
| completion-2024-sep / DOGEUSDT | -8.51% | -0.722 | -1.020 | -2.813 | -3.03% | 17.648 | 29.53 |
| completion-2024-dec / BTCUSDT | -25.60% | -7.549 | -7.121 | -6.505 | -3.94% | 26.869 | 33.84 |
| completion-2024-dec / ETHUSDT | -21.84% | -4.759 | -4.901 | -6.553 | -3.33% | 26.381 | 25.47 |
| completion-2024-dec / BNBUSDT | -11.36% | -1.271 | -1.879 | -2.550 | -4.45% | 27.568 | 30.48 |
| completion-2024-dec / SOLUSDT | 0.00% | — | — | — | 0.00% | 0.000 | 0.00 |
| completion-2024-dec / XRPUSDT | 47.03% | 1.952 | 3.690 | 9.232 | -5.09% | 28.499 | 8.33 |
| completion-2024-dec / DOGEUSDT | -11.24% | -5.558 | -5.418 | -7.620 | -1.47% | 29.853 | 6.14 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development | 16.29% | 16.29% | — | [0.000, 0.000] |
| known-2024 | 7.08% | 7.08% | 5.16% | [0.000, 0.000] |
| known-2025 | 11.29% | 11.29% | 8.11% | [0.000, 0.000] |
| known-2026 | 7.19% | 7.19% | 4.96% | [0.000, 0.000] |
| historical-stress | -1.66% | -1.66% | -1.92% | [0.000, 0.000] |
| fresh-september | -0.31% | -0.31% | -0.44% | [0.000, 0.000] |
| transfer-2021 | 36.94% | 36.94% | 35.46% | [0.000, 0.000] |
| transfer-2024-oct-nov | 7.69% | 7.69% | 7.17% | [0.000, 0.000] |
| completion-2022-aug | -1.15% | -1.15% | -1.17% | [0.000, 0.000] |
| completion-2024-sep | -0.03% | -0.03% | -0.18% | [0.000, 0.000] |
| completion-2024-dec | -0.54% | -0.54% | -0.58% | [0.000, 0.000] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | m30-n320-x160-no-day-guard − m30-n320-x160 | +7.61 | +2.02 | [-0.275, 3.165] |
| development | m30-n160-x80 − m30-n320-x160 | -4.31 | -2.09 | [-2.423, 0.931] |
| development | m30-n640-x320 − m30-n320-x160 | -2.85 | +1.32 | [-2.664, 1.277] |
| known-2024 | m30-n320-x160-no-day-guard − m30-n320-x160 | +3.26 | -1.29 | [-2.494, 6.325] |
| known-2024 | m30-n160-x80 − m30-n320-x160 | +1.63 | +1.56 | [-1.595, 3.092] |
| known-2024 | m30-n640-x320 − m30-n320-x160 | -0.21 | +1.76 | [-5.023, 3.642] |
| known-2025 | m30-n320-x160-no-day-guard − m30-n320-x160 | -1.57 | -0.35 | [-0.861, -0.011] |
| known-2025 | m30-n160-x80 − m30-n320-x160 | -1.10 | -1.32 | [-2.176, 1.793] |
| known-2025 | m30-n640-x320 − m30-n320-x160 | -2.67 | +0.86 | [-2.971, 1.424] |
| known-2026 | m30-n320-x160-no-day-guard − m30-n320-x160 | +0.00 | -0.21 | [-0.786, 0.861] |
| known-2026 | m30-n160-x80 − m30-n320-x160 | +1.49 | -2.87 | [-2.022, 3.938] |
| known-2026 | m30-n640-x320 − m30-n320-x160 | -3.72 | +0.44 | [-4.949, 1.258] |
| historical-stress | m30-n320-x160-no-day-guard − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-stress | m30-n160-x80 − m30-n320-x160 | -2.67 | -2.28 | [-3.228, 0.221] |
| historical-stress | m30-n640-x320 − m30-n320-x160 | +0.51 | +0.39 | [-1.684, 2.049] |
| fresh-september | m30-n320-x160-no-day-guard − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| fresh-september | m30-n160-x80 − m30-n320-x160 | +2.44 | -0.35 | [-1.542, 19.674] |
| fresh-september | m30-n640-x320 − m30-n320-x160 | -0.14 | +0.37 | [-5.543, 4.074] |
| transfer-2021 | m30-n320-x160-no-day-guard − m30-n320-x160 | +11.53 | -7.69 | [-3.091, 9.273] |
| transfer-2021 | m30-n160-x80 − m30-n320-x160 | -7.31 | -2.08 | [-4.524, 1.586] |
| transfer-2021 | m30-n640-x320 − m30-n320-x160 | -17.58 | -0.37 | [-8.764, 0.393] |
| transfer-2024-oct-nov | m30-n320-x160-no-day-guard − m30-n320-x160 | +11.15 | -0.12 | [2.314, 31.964] |
| transfer-2024-oct-nov | m30-n160-x80 − m30-n320-x160 | +1.01 | +0.35 | [-6.268, 10.297] |
| transfer-2024-oct-nov | m30-n640-x320 − m30-n320-x160 | -1.61 | -0.03 | [-9.518, 3.407] |
| completion-2022-aug | m30-n320-x160-no-day-guard − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| completion-2022-aug | m30-n160-x80 − m30-n320-x160 | -0.68 | -0.88 | [-5.925, 1.760] |
| completion-2022-aug | m30-n640-x320 − m30-n320-x160 | +0.58 | +0.45 | [-0.251, 4.683] |
| completion-2024-sep | m30-n320-x160-no-day-guard − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| completion-2024-sep | m30-n160-x80 − m30-n320-x160 | -1.10 | -0.10 | [-14.130, 3.848] |
| completion-2024-sep | m30-n640-x320 − m30-n320-x160 | -0.53 | -0.55 | [-5.760, 1.635] |
| completion-2024-dec | m30-n320-x160-no-day-guard − m30-n320-x160 | -0.20 | -0.20 | [-3.599, 2.116] |
| completion-2024-dec | m30-n160-x80 − m30-n320-x160 | -0.98 | -0.97 | [-4.761, -1.623] |
| completion-2024-dec | m30-n640-x320 − m30-n320-x160 | +0.40 | +0.31 | [-0.604, 3.176] |

## 证据与复核

计划 SHA-256：`fddd5800b6d38e9f5a6ba09441be3b245a4ff82a3fde56944b0969e21459d78d`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`98fcc37e22083943b8b6d94cb9c3cc232b530989d98ed77fc925a35beaaca178`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

No new statistical promotion this round. Historical-completion comprises92days, below the prior180day evidence minimum even before trade counts/intervals; report evidence insufficient without weakening that gate. Fixed primary unchanged. Report every loss and both-cost result for all four accounts. Guard improvement is uncertain if either7/28day paired interval crosses0; do not replace the primary from point estimates. Neighboring horizons are stability diagnostics, not a search for a new winner. A positive historical expectation is distinct from effective prospective trading.

- Repeated adaptive research on familiar surviving crypto markets; no untouched chronological OOS claim. Three completion months may overlap previously seen warmup observations.
- Static modern lot/minNotional constraints and constant fee/slippage cannot reconstruct historical microstructure; no liquidation/order-book model.
- Separated windows reset capital/risk/position; boundary forced exits may materially affect short windows. Daily portfolio drawdown excludes within-day peak/trough.
- Nonstationarity, strongly correlated symbols, return concentration and project-wide multiple trials are not removed by block bootstrap. 28day blocks on30/31day windows provide limited information.
- No ensemble unless actual per-scale capital replays account for min lot/notional; no UTC anchor-hour optimization, grid or later rescoring this round.
- No live or prospective data collection is running; any future observation protocol must use data unavailable when frozen and retain signal/order receive timestamps and execution assumptions.
