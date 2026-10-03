# 30 分钟突破与退出：固定规则账户回放及独立突破事件诊断

引擎：`trend-continuation-13`。事前固定主候选：`m30-n40-channel`。基线：`m30-n20-channel`。

本报告审计已有运行并重新汇总账本，主候选由计划事前指定；开发期只评价资格，样本不足或失败都不替换候选，后续继续预定的历史诊断。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03; defined before inspecting any thirty-minute result. All six historical market windows were inspected in prior studies; no new untouched OOS claim.。

开发期资格：未通过。原因：too-few-profitable-symbols。资格不构成统计显著性或样本外认证。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Always keep m30-n40-channel as the primary, directly changing the previous primary period to 30 minutes. Development requires at least 30 completed trades per symbol, 30 complete UTC days, finite daily Sharpe, at least four profitable symbols and a positive median symbol mean net R. Qualification is descriptive; failures never trigger replacement. All six candidates and all later windows are always reported.

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
| m30-n20-channel | -6.27% | -2.37% | -5.77% | -4.89% | -11.06% | 1.75% |
| m30-n40-channel | -0.57% | -0.93% | 1.44% | 11.23% | -9.13% | 1.31% |
| m30-n20-atr3 | -14.55% | -3.27% | -9.61% | -6.94% | -9.90% | 1.43% |
| m30-n40-atr3 | -4.95% | -1.25% | -7.01% | -1.07% | -7.41% | 2.81% |
| m30-n40-atr3-be1 | -5.01% | -1.72% | -7.39% | -0.75% | -7.16% | 2.93% |
| m30-n40-atr3-be2 | -4.95% | -1.24% | -7.01% | -1.07% | -7.41% | 2.81% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | m30-n20-channel | base | -6.27% | 2035 | 0.9371 | -1.850 | -0.044 |
| development | m30-n40-channel | base | -0.57% | 1219 | 0.9918 | -0.279 | -0.010 |
| development | m30-n20-atr3 | base | -14.55% | 2241 | 0.8421 | -3.894 | -0.107 |
| development | m30-n40-atr3 | base | -4.95% | 1454 | 0.9197 | -2.041 | -0.055 |
| development | m30-n40-atr3-be1 | base | -5.01% | 1467 | 0.9174 | -2.047 | -0.054 |
| development | m30-n40-atr3-be2 | base | -4.95% | 1454 | 0.9197 | -2.041 | -0.055 |
| known-2024 | m30-n20-channel | base | -2.37% | 954 | 0.9478 | -1.489 | -0.030 |
| known-2024 | m30-n40-channel | base | -0.93% | 575 | 0.9703 | -0.971 | -0.021 |
| known-2024 | m30-n20-atr3 | base | -3.27% | 1029 | 0.9237 | -1.904 | -0.044 |
| known-2024 | m30-n40-atr3 | base | -1.25% | 709 | 0.9581 | -1.058 | -0.023 |
| known-2024 | m30-n40-atr3-be1 | base | -1.72% | 717 | 0.9416 | -1.437 | -0.033 |
| known-2024 | m30-n40-atr3-be2 | base | -1.24% | 709 | 0.9583 | -1.053 | -0.023 |
| known-2024 | m30-n20-channel-stress | stress | -9.70% | 959 | 0.7853 | -6.071 | -0.156 |
| known-2024 | m30-n40-channel-stress | stress | -5.25% | 575 | 0.8307 | -5.482 | -0.135 |
| known-2024 | m30-n20-atr3-stress | stress | -11.04% | 1034 | 0.7433 | -6.408 | -0.170 |
| known-2024 | m30-n40-atr3-stress | stress | -6.48% | 710 | 0.7845 | -5.477 | -0.139 |
| known-2024 | m30-n40-atr3-be1-stress | stress | -7.02% | 724 | 0.7623 | -5.820 | -0.149 |
| known-2024 | m30-n40-atr3-be2-stress | stress | -6.48% | 710 | 0.7845 | -5.477 | -0.139 |
| known-2025 | m30-n20-channel | base | -5.77% | 1662 | 0.9232 | -2.082 | -0.040 |
| known-2025 | m30-n40-channel | base | 1.44% | 1007 | 1.026 | 0.858 | 0.017 |
| known-2025 | m30-n20-atr3 | base | -9.61% | 1794 | 0.8623 | -3.215 | -0.078 |
| known-2025 | m30-n40-atr3 | base | -7.01% | 1272 | 0.8652 | -3.306 | -0.083 |
| known-2025 | m30-n40-atr3-be1 | base | -7.39% | 1289 | 0.8547 | -3.441 | -0.085 |
| known-2025 | m30-n40-atr3-be2 | base | -7.01% | 1272 | 0.8652 | -3.306 | -0.083 |
| known-2025 | m30-n20-channel-stress | stress | -17.27% | 1669 | 0.7649 | -6.207 | -0.171 |
| known-2025 | m30-n40-channel-stress | stress | -6.33% | 1011 | 0.8816 | -3.759 | -0.113 |
| known-2025 | m30-n20-atr3-stress | stress | -21.02% | 1799 | 0.6954 | -7.012 | -0.207 |
| known-2025 | m30-n40-atr3-stress | stress | -15.05% | 1272 | 0.71 | -7.098 | -0.207 |
| known-2025 | m30-n40-atr3-be1-stress | stress | -15.35% | 1297 | 0.6973 | -7.101 | -0.209 |
| known-2025 | m30-n40-atr3-be2-stress | stress | -15.05% | 1272 | 0.71 | -7.097 | -0.207 |
| known-2026 | m30-n20-channel | base | -4.89% | 1048 | 0.9027 | -2.802 | -0.055 |
| known-2026 | m30-n40-channel | base | 11.23% | 604 | 1.326 | 11.157 | 0.309 |
| known-2026 | m30-n20-atr3 | base | -6.94% | 1133 | 0.8511 | -3.673 | -0.082 |
| known-2026 | m30-n40-atr3 | base | -1.07% | 756 | 0.9671 | -0.851 | -0.018 |
| known-2026 | m30-n40-atr3-be1 | base | -0.75% | 761 | 0.9763 | -0.595 | -0.013 |
| known-2026 | m30-n40-atr3-be2 | base | -1.07% | 756 | 0.9671 | -0.851 | -0.018 |
| known-2026 | m30-n20-channel-stress | stress | -14.15% | 1053 | 0.7206 | -8.063 | -0.214 |
| known-2026 | m30-n40-channel-stress | stress | 2.77% | 607 | 1.081 | 2.739 | 0.146 |
| known-2026 | m30-n20-atr3-stress | stress | -16.21% | 1137 | 0.6578 | -8.552 | -0.240 |
| known-2026 | m30-n40-atr3-stress | stress | -7.96% | 758 | 0.7615 | -6.301 | -0.174 |
| known-2026 | m30-n40-atr3-be1-stress | stress | -8.06% | 771 | 0.7518 | -6.270 | -0.175 |
| known-2026 | m30-n40-atr3-be2-stress | stress | -7.94% | 758 | 0.7619 | -6.289 | -0.174 |
| historical-stress | m30-n20-channel | base | -11.06% | 761 | 0.6687 | -8.721 | -0.199 |
| historical-stress | m30-n40-channel | base | -9.13% | 443 | 0.5993 | -12.366 | -0.278 |
| historical-stress | m30-n20-atr3 | base | -9.90% | 825 | 0.7013 | -7.201 | -0.163 |
| historical-stress | m30-n40-atr3 | base | -7.41% | 535 | 0.6595 | -8.311 | -0.188 |
| historical-stress | m30-n40-atr3-be1 | base | -7.16% | 536 | 0.6672 | -8.018 | -0.181 |
| historical-stress | m30-n40-atr3-be2 | base | -7.41% | 535 | 0.6595 | -8.311 | -0.188 |
| historical-stress | m30-n20-channel-stress | stress | -14.15% | 760 | 0.578 | -11.174 | -0.283 |
| historical-stress | m30-n40-channel-stress | stress | -11.12% | 445 | 0.5185 | -14.999 | -0.367 |
| historical-stress | m30-n20-atr3-stress | stress | -13.71% | 826 | 0.5937 | -9.959 | -0.250 |
| historical-stress | m30-n40-atr3-stress | stress | -9.94% | 536 | 0.5545 | -11.122 | -0.275 |
| historical-stress | m30-n40-atr3-be1-stress | stress | -9.74% | 538 | 0.5563 | -10.866 | -0.270 |
| historical-stress | m30-n40-atr3-be2-stress | stress | -9.94% | 536 | 0.5545 | -11.122 | -0.275 |
| fresh-september | m30-n20-channel | base | 1.75% | 138 | 1.23 | 7.595 | 0.185 |
| fresh-september | m30-n40-channel | base | 1.31% | 83 | 1.297 | 9.438 | 0.203 |
| fresh-september | m30-n20-atr3 | base | 1.43% | 152 | 1.212 | 5.641 | 0.138 |
| fresh-september | m30-n40-atr3 | base | 2.81% | 101 | 1.681 | 16.694 | 0.389 |
| fresh-september | m30-n40-atr3-be1 | base | 2.93% | 102 | 1.729 | 17.222 | 0.401 |
| fresh-september | m30-n40-atr3-be2 | base | 2.81% | 101 | 1.681 | 16.694 | 0.389 |
| fresh-september | m30-n20-channel-stress | stress | 0.30% | 138 | 1.039 | 1.323 | 0.046 |
| fresh-september | m30-n40-channel-stress | stress | 0.18% | 85 | 1.038 | 1.269 | 0.009 |
| fresh-september | m30-n20-atr3-stress | stress | -0.21% | 153 | 0.9702 | -0.826 | -0.011 |
| fresh-september | m30-n40-atr3-stress | stress | 1.49% | 102 | 1.337 | 8.785 | 0.234 |
| fresh-september | m30-n40-atr3-be1-stress | stress | 1.42% | 106 | 1.319 | 8.025 | 0.211 |
| fresh-september | m30-n40-atr3-be2-stress | stress | 1.49% | 102 | 1.337 | 8.785 | 0.234 |

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
| development | -6.27% | -0.57% | — | [-0.831, 3.093] |
| known-2024 | -2.37% | -0.93% | -5.25% | [-2.850, 4.208] |
| known-2025 | -5.77% | 1.44% | -6.33% | [-0.349, 4.305] |
| known-2026 | -4.89% | 11.23% | 2.77% | [1.138, 13.995] |
| historical-stress | -11.06% | -9.13% | -11.12% | [-2.181, 4.378] |
| fresh-september | 1.75% | 1.31% | 0.18% | [-15.473, 12.091] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | m30-n40-channel − m30-n20-channel | +5.71 | +3.95 | [-0.831, 3.093] |
| development | m30-n40-atr3 − m30-n40-channel | -4.38 | +1.30 | [-4.086, 1.776] |
| development | m30-n40-atr3 − m30-n20-atr3 | +9.60 | +7.56 | [0.722, 3.423] |
| development | m30-n40-atr3-be1 − m30-n40-atr3 | -0.06 | +0.12 | [-0.210, 0.181] |
| development | m30-n40-atr3-be2 − m30-n40-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| known-2024 | m30-n40-channel − m30-n20-channel | +1.44 | +1.69 | [-2.850, 4.208] |
| known-2024 | m30-n40-atr3 − m30-n40-channel | -0.32 | +1.95 | [-4.226, 3.174] |
| known-2024 | m30-n40-atr3 − m30-n20-atr3 | +2.02 | +1.42 | [-1.413, 3.259] |
| known-2024 | m30-n40-atr3-be1 − m30-n40-atr3 | -0.47 | +0.20 | [-0.736, 0.196] |
| known-2024 | m30-n40-atr3-be2 − m30-n40-atr3 | +0.01 | +0.01 | [-0.001, 0.010] |
| known-2025 | m30-n40-channel − m30-n20-channel | +7.21 | +1.94 | [-0.349, 4.305] |
| known-2025 | m30-n40-atr3 − m30-n40-channel | -8.45 | -1.68 | [-5.318, 0.259] |
| known-2025 | m30-n40-atr3 − m30-n20-atr3 | +2.60 | +2.71 | [-0.810, 2.469] |
| known-2025 | m30-n40-atr3-be1 − m30-n40-atr3 | -0.38 | -0.36 | [-0.507, 0.209] |
| known-2025 | m30-n40-atr3-be2 − m30-n40-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| known-2026 | m30-n40-channel − m30-n20-channel | +16.12 | +5.98 | [1.138, 13.995] |
| known-2026 | m30-n40-atr3 − m30-n40-channel | -12.30 | +1.63 | [-15.585, 2.687] |
| known-2026 | m30-n40-atr3 − m30-n20-atr3 | +5.86 | +5.12 | [0.307, 4.735] |
| known-2026 | m30-n40-atr3-be1 − m30-n40-atr3 | +0.32 | +0.38 | [-0.143, 0.385] |
| known-2026 | m30-n40-atr3-be2 − m30-n40-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-stress | m30-n40-channel − m30-n20-channel | +1.93 | +1.38 | [-2.181, 4.378] |
| historical-stress | m30-n40-atr3 − m30-n40-channel | +1.72 | +1.83 | [-2.032, 3.703] |
| historical-stress | m30-n40-atr3 − m30-n20-atr3 | +2.49 | +1.82 | [-1.446, 4.233] |
| historical-stress | m30-n40-atr3-be1 − m30-n40-atr3 | +0.25 | +0.22 | [0.030, 0.270] |
| historical-stress | m30-n40-atr3-be2 − m30-n40-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| fresh-september | m30-n40-channel − m30-n20-channel | -0.44 | +1.55 | [-15.473, 12.091] |
| fresh-september | m30-n40-atr3 − m30-n40-channel | +1.50 | +0.10 | [-3.353, 13.137] |
| fresh-september | m30-n40-atr3 − m30-n20-atr3 | +1.38 | +0.50 | [-2.889, 12.354] |
| fresh-september | m30-n40-atr3-be1 − m30-n40-atr3 | +0.12 | +0.06 | [-0.292, 1.054] |
| fresh-september | m30-n40-atr3-be2 − m30-n40-atr3 | +0.00 | +0.00 | [0.000, 0.000] |

## 证据与复核

计划 SHA-256：`b3e2ad3f442df8641422b7b59d4b83bff4b4b62aa0e6ee83ddfada8ee5d23a70`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`038feb28af3a5b57d1ad654c87994045f2bd18ebbf893e25218233a84424e19f`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

Publish every candidate in every window with net return, daily drawdown, Sharpe, PF, win rate/average win-loss, trade count, net R, dollar expectation, holding time, costs and exit reasons. All six receive doubled fee/slippage replays outside development. Report all five predeclared paired daily-return comparisons. Signal accuracy must show denominator, acceptance coverage, ambiguity, censoring, false-break definition and 12-hour horizon, separately from actual net win rate. No accuracy or historical profit threshold licenses changing the primary/defaults or declaring stable future positive expectation.

- Both candidate definitions and all six historical windows were examined before this plan. Fixing an earlier winner for recheck is conditional on prior selection and does not reset multiple-testing risk.
- The inherited dates omit July-August 2022 and August-December 2024. Some underlying data gaps caused the original boundaries, but entire omitted ranges have not been established as unavailable. No continuous full-history claim is permitted.
- The fresh-september id is an old alignment identifier only. September 2026 is now previously viewed historical data.
- All six account candidates and six signal definitions (two N values by three confirmations) are exploratory predeclared contrasts, not an exhaustive search or a new independent sample.
- Long-only surviving crypto assets, fixed separate capital sleeves, static precision and simulated minute fills have the same market and execution limits as the source study.
- Each window starts with independent capital/warmup; inherited omitted date ranges remain. Never concatenate returns or interpret daily portfolio drawdown as minute portfolio drawdown.
- A 30-minute 40-bar lookback is twenty hours versus 160 hours at the previous four-hour period; changing bar period changes economic horizons and ATR risk distance, not only sampling resolution.
- Signal episodes intentionally deduplicate an advance; actual native strategy permits fresh completed-bar signals after exiting even within the same episode. Episode accuracy is not realized account win rate.
- Buffer requires strength on the first episode bar, whereas two-close waits exactly one bar against the frozen boundary. Their coverage/lag/ATR and reference-entry prices differ. They are signal hypotheses, not account-tested profit filters.
- Raw forward labels omit position sizing/funding/net costs and can overlap. A +2R/-1R threshold hit percentage or a 33.3% zero-cost reference cannot be asserted to be an executable net profit result.
- Seven-day blocks reduce but do not remove serial/cross-symbol dependence; candidates, thresholds and horizons were not multiplicity-adjusted. Confidence bounds are descriptive.
- Changing exits changes all later entry opportunities and risk state. Completed-trade MFE/MAE is exit-censored; do not substitute it for full-horizon signal observations.
- The shared staged rule activates trailing at the first closeR>=0 when trailingStartR=0. No claim of unconditional entry-time dynamic trailing is permitted.
- No fixed-profit target full-account policy is added in this round; +1R/+2R first-touch diagnostics evaluate opportunity shape only. No intrabar breakout or discretionary retest policy is implemented.
