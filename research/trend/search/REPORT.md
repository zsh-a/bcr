# 30 分钟多家族策略搜索：入场、过滤、退出与连续持仓验证

引擎：`trend-continuation-14`。冻结选择：`m30-n320-no-day-guard`。基线：`m30-n320-x160`。

本报告审计已有运行并重新汇总账本，保留当时的开发期选择，不重新挑选历史赢家。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03T08:13:04.882985+00:00。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Exactly once: highest development BASE-cost daily portfolio Sharpe among all32declared candidates with finite Sharpe and>=30closed trades in EACH of six symbols. Ties follow declared order. Separate >=4profitable symbols and positive median-symbol-meanR qualification does not trigger reselection on failure. Stress is not available on development and cannot influence this selection. No later-window choice or fallback winner; if no eligible candidate stop without inspecting validation. Every candidate is reported thereafter, including ineligible and losing families.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |
|---|---|---|---|---:|
| development | development | 2022-09-01 | 2024-01-01 | 487 |
| validation-2024-early | diagnostic-validation-known | 2024-01-01 | 2024-08-01 | 213 |
| validation-continuous | diagnostic-validation-known | 2024-09-01 | 2026-10-01 | 760 |
| historical-2021 | diagnostic-stress-known | 2021-01-01 | 2022-01-01 | 365 |
| historical-stress | diagnostic-stress-known | 2022-01-01 | 2022-07-01 | 181 |
| completion-2022-aug | diagnostic-stress-known | 2022-08-01 | 2022-09-01 | 31 |

## 候选风险覆盖

riskOverrides 仅允许覆盖 dailyLossPct；0 表示关闭日亏损保护。其余风控继承计划，成本压力与策略敏感性派生继承该候选的覆盖值。

日亏损保护按每个独立子账户的 UTC 日开盘 mark 权益建立日锚，分钟 mark 收盘触发后在下一开盘退出并阻止当日再入。它不是日内峰值回撤或整个组合的损失上限；跨日持仓可能在仍盈利时触发，已确认的退出意图不因午夜重置而撤销。

| 候选 | dailyLossPct 生效值 | 来源 |
|---|---:|---|
| m30-n320-x160 | 3.00% | 继承计划 |
| m30-n80-x40 | 3.00% | 继承计划 |
| m30-n160-x80 | 3.00% | 继承计划 |
| m30-n640-x320 | 3.00% | 继承计划 |
| m30-n320-episode | 3.00% | 继承计划 |
| m30-n320-ema | 3.00% | 继承计划 |
| m30-n320-slow-ema | 3.00% | 继承计划 |
| m30-n320-background | 3.00% | 继承计划 |
| m30-n320-both | 3.00% | 继承计划 |
| m30-n320-short | 3.00% | 继承计划 |
| m30-n320-x20 | 3.00% | 继承计划 |
| m30-n320-fixed-atr3 | 3.00% | 继承计划 |
| m30-n320-dynamic-atr3 | 3.00% | 继承计划 |
| m30-n320-dynamic-atr6 | 3.00% | 继承计划 |
| m30-n320-dynamic-be1 | 3.00% | 继承计划 |
| m30-n320-dynamic-be2 | 3.00% | 继承计划 |
| m30-n320-staged | 3.00% | 继承计划 |
| m30-n320-stop3 | 3.00% | 继承计划 |
| m30-n320-no-day-guard | 关闭（0） | 候选覆盖 |
| m30-n80-dynamic-atr3 | 3.00% | 继承计划 |
| m30-pullback-unfiltered | 3.00% | 继承计划 |
| m30-pullback-trend | 3.00% | 继承计划 |
| m30-pullback-long | 3.00% | 继承计划 |
| m30-pullback-staged | 3.00% | 继承计划 |
| m30-kdj-unfiltered | 3.00% | 继承计划 |
| m30-kdj-trend | 3.00% | 继承计划 |
| m30-kdj-long | 3.00% | 继承计划 |
| m30-kdj-staged | 3.00% | 继承计划 |
| m30-pa-base | 3.00% | 继承计划 |
| m30-pa-key | 3.00% | 继承计划 |
| m30-pa-legs | 3.00% | 继承计划 |
| m30-pa-key-legs | 3.00% | 继承计划 |

results.json 每个基础、压力及敏感性结果均记录完整生效 risk 与 riskOverrides；native 配置使用同一份合并规则。

## 全部声明候选的净收益

| 规则 | 开发487天 · 已知历史 | 2024年1—7月 · 已知后续历史 | 2024年9月—2026年9月 · 连续760天已知历史 | 2021全年 · 已知历史压力 | 2022上半年 · 已知历史压力 | 2022年8月 · 已知亏损月份 |
|---|---:|---:|---:|---:|---:|---:|
| m30-n320-x160 | 16.29% | 7.08% | 27.42% | 36.94% | -1.66% | -1.15% |
| m30-n80-x40 | 4.53% | 7.74% | 18.43% | 26.82% | -6.97% | -2.57% |
| m30-n160-x80 | 11.98% | 8.71% | 30.59% | 29.63% | -4.34% | -1.83% |
| m30-n640-x320 | 13.44% | 6.87% | 16.12% | 19.37% | -1.15% | -0.57% |
| m30-n320-episode | 7.40% | 5.62% | 8.94% | 5.04% | -1.09% | -1.15% |
| m30-n320-ema | 16.46% | 7.08% | 27.42% | 29.16% | -1.66% | -1.25% |
| m30-n320-slow-ema | 16.29% | 7.08% | 27.42% | 36.94% | -1.66% | -1.15% |
| m30-n320-background | 16.35% | 6.53% | 13.89% | 18.80% | -0.89% | -0.75% |
| m30-n320-both | 9.57% | 3.16% | 15.84% | 28.74% | 3.42% | 0.80% |
| m30-n320-short | -6.46% | -3.95% | -8.71% | -5.72% | 5.09% | 1.89% |
| m30-n320-x20 | 3.30% | 0.94% | 23.88% | 12.95% | -1.72% | -0.85% |
| m30-n320-fixed-atr3 | 4.00% | -1.95% | 4.61% | 4.17% | -0.86% | -0.22% |
| m30-n320-dynamic-atr3 | 3.40% | -0.73% | 6.97% | 5.65% | -1.61% | -0.32% |
| m30-n320-dynamic-atr6 | 3.90% | -0.57% | 23.70% | 10.08% | -1.97% | -0.93% |
| m30-n320-dynamic-be1 | 3.31% | -0.92% | 6.45% | 5.00% | -1.54% | -0.30% |
| m30-n320-dynamic-be2 | 3.40% | -0.73% | 6.97% | 5.65% | -1.61% | -0.32% |
| m30-n320-staged | 3.36% | -1.37% | 7.46% | 4.30% | -0.78% | -0.42% |
| m30-n320-stop3 | 16.32% | 3.93% | 17.06% | 26.21% | -0.61% | -0.98% |
| m30-n320-no-day-guard | 23.90% | 10.34% | 40.88% | 48.47% | -1.66% | -1.15% |
| m30-n80-dynamic-atr3 | -1.87% | -0.29% | -6.75% | 5.15% | -4.32% | -1.06% |
| m30-pullback-unfiltered | -12.18% | -3.13% | -17.38% | -0.35% | -6.06% | -1.01% |
| m30-pullback-trend | -10.47% | -0.83% | -13.65% | -2.03% | -4.90% | -1.04% |
| m30-pullback-long | -5.05% | 0.69% | -5.03% | -0.64% | -4.34% | -0.44% |
| m30-pullback-staged | -8.38% | 1.97% | -11.08% | -1.31% | -3.84% | -1.17% |
| m30-kdj-unfiltered | -28.91% | -5.78% | -43.18% | -18.69% | 3.79% | 2.28% |
| m30-kdj-trend | -6.25% | 1.56% | -11.09% | -0.47% | 0.95% | -0.10% |
| m30-kdj-long | -3.04% | 1.37% | -6.55% | 1.08% | -0.68% | 0.05% |
| m30-kdj-staged | -5.17% | 0.91% | -10.05% | -0.45% | 0.65% | 0.24% |
| m30-pa-base | -9.90% | -3.43% | -14.94% | -0.84% | -5.48% | -1.26% |
| m30-pa-key | -1.19% | -0.69% | -0.20% | -0.72% | -0.86% | 0.32% |
| m30-pa-legs | -0.18% | 1.02% | -0.63% | -0.35% | 0.09% | -0.04% |
| m30-pa-key-legs | -0.07% | 0.00% | 0.18% | 0.03% | 0.22% | 0.05% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | m30-n320-x160 | base | 16.29% | 247 | 1.88 | 39.569 | 0.895 |
| development | m30-n80-x40 | base | 4.53% | 705 | 1.1 | 3.856 | 0.063 |
| development | m30-n160-x80 | base | 11.98% | 418 | 1.394 | 17.190 | 0.403 |
| development | m30-n640-x320 | base | 13.44% | 176 | 1.954 | 45.822 | 1.076 |
| development | m30-n320-episode | base | 7.40% | 91 | 2.177 | 48.822 | 1.265 |
| development | m30-n320-ema | base | 16.46% | 245 | 1.897 | 40.302 | 0.912 |
| development | m30-n320-slow-ema | base | 16.29% | 247 | 1.88 | 39.569 | 0.895 |
| development | m30-n320-background | base | 16.35% | 146 | 2.555 | 67.188 | 1.402 |
| development | m30-n320-both | base | 9.57% | 453 | 1.294 | 12.678 | 0.318 |
| development | m30-n320-short | base | -6.46% | 212 | 0.5443 | -18.294 | -0.391 |
| development | m30-n320-x20 | base | 3.30% | 343 | 1.169 | 5.766 | 0.124 |
| development | m30-n320-fixed-atr3 | base | 4.00% | 450 | 1.219 | 5.330 | 0.114 |
| development | m30-n320-dynamic-atr3 | base | 3.40% | 405 | 1.196 | 5.036 | 0.108 |
| development | m30-n320-dynamic-atr6 | base | 3.90% | 333 | 1.21 | 7.027 | 0.142 |
| development | m30-n320-dynamic-be1 | base | 3.31% | 408 | 1.193 | 4.871 | 0.104 |
| development | m30-n320-dynamic-be2 | base | 3.40% | 405 | 1.196 | 5.036 | 0.108 |
| development | m30-n320-staged | base | 3.36% | 387 | 1.184 | 5.204 | 0.108 |
| development | m30-n320-stop3 | base | 16.32% | 211 | 2.114 | 46.399 | 1.002 |
| development | m30-n320-no-day-guard | base | 23.90% | 243 | 2.288 | 59.014 | 1.329 |
| development | m30-n80-dynamic-atr3 | base | -1.87% | 930 | 0.9545 | -1.207 | -0.036 |
| development | m30-pullback-unfiltered | base | -12.18% | 1287 | 0.7632 | -5.680 | -0.147 |
| development | m30-pullback-trend | base | -10.47% | 918 | 0.7317 | -6.843 | -0.172 |
| development | m30-pullback-long | base | -5.05% | 523 | 0.7815 | -5.794 | -0.148 |
| development | m30-pullback-staged | base | -8.38% | 869 | 0.8024 | -5.783 | -0.144 |
| development | m30-kdj-unfiltered | base | -28.91% | 3030 | 0.7381 | -5.725 | -0.152 |
| development | m30-kdj-trend | base | -6.25% | 697 | 0.7733 | -5.379 | -0.129 |
| development | m30-kdj-long | base | -3.04% | 237 | 0.7071 | -7.699 | -0.180 |
| development | m30-kdj-staged | base | -5.17% | 657 | 0.8374 | -4.718 | -0.110 |
| development | m30-pa-base | base | -9.90% | 883 | 0.7233 | -6.730 | -0.166 |
| development | m30-pa-key | base | -1.19% | 61 | 0.5625 | -11.717 | -0.257 |
| development | m30-pa-legs | base | -0.18% | 21 | 0.723 | -5.131 | -0.114 |
| development | m30-pa-key-legs | base | -0.07% | 2 | 0.1798 | -20.414 | -0.473 |
| validation-2024-early | m30-n320-x160 | base | 7.08% | 138 | 1.686 | 30.776 | 0.720 |
| validation-2024-early | m30-n80-x40 | base | 7.74% | 337 | 1.36 | 13.772 | 0.311 |
| validation-2024-early | m30-n160-x80 | base | 8.71% | 205 | 1.62 | 25.489 | 0.587 |
| validation-2024-early | m30-n640-x320 | base | 6.87% | 80 | 2.077 | 51.509 | 1.213 |
| validation-2024-early | m30-n320-episode | base | 5.62% | 74 | 2.062 | 45.535 | 1.067 |
| validation-2024-early | m30-n320-ema | base | 7.08% | 138 | 1.686 | 30.788 | 0.720 |
| validation-2024-early | m30-n320-slow-ema | base | 7.08% | 138 | 1.686 | 30.776 | 0.720 |
| validation-2024-early | m30-n320-background | base | 6.53% | 89 | 2.047 | 43.996 | 1.006 |
| validation-2024-early | m30-n320-both | base | 3.16% | 236 | 1.186 | 8.043 | 0.210 |
| validation-2024-early | m30-n320-short | base | -3.95% | 100 | 0.427 | -23.721 | -0.517 |
| validation-2024-early | m30-n320-x20 | base | 0.94% | 202 | 1.087 | 2.804 | 0.056 |
| validation-2024-early | m30-n320-fixed-atr3 | base | -1.95% | 262 | 0.8304 | -4.460 | -0.103 |
| validation-2024-early | m30-n320-dynamic-atr3 | base | -0.73% | 248 | 0.9313 | -1.768 | -0.038 |
| validation-2024-early | m30-n320-dynamic-atr6 | base | -0.57% | 195 | 0.9473 | -1.767 | -0.034 |
| validation-2024-early | m30-n320-dynamic-be1 | base | -0.92% | 251 | 0.9117 | -2.198 | -0.050 |
| validation-2024-early | m30-n320-dynamic-be2 | base | -0.73% | 248 | 0.9313 | -1.768 | -0.038 |
| validation-2024-early | m30-n320-staged | base | -1.37% | 236 | 0.8778 | -3.471 | -0.078 |
| validation-2024-early | m30-n320-stop3 | base | 3.93% | 109 | 1.535 | 21.630 | 0.475 |
| validation-2024-early | m30-n320-no-day-guard | base | 10.34% | 128 | 2.089 | 48.457 | 1.107 |
| validation-2024-early | m30-n80-dynamic-atr3 | base | -0.29% | 493 | 0.9863 | -0.356 | -0.007 |
| validation-2024-early | m30-pullback-unfiltered | base | -3.13% | 697 | 0.8902 | -2.698 | -0.057 |
| validation-2024-early | m30-pullback-trend | base | -0.83% | 513 | 0.9609 | -0.969 | -0.016 |
| validation-2024-early | m30-pullback-long | base | 0.69% | 282 | 1.058 | 1.470 | 0.043 |
| validation-2024-early | m30-pullback-staged | base | 1.97% | 490 | 1.089 | 2.411 | 0.056 |
| validation-2024-early | m30-kdj-unfiltered | base | -5.78% | 1532 | 0.9043 | -2.262 | -0.049 |
| validation-2024-early | m30-kdj-trend | base | 1.56% | 304 | 1.129 | 3.089 | 0.061 |
| validation-2024-early | m30-kdj-long | base | 1.37% | 106 | 1.331 | 7.778 | 0.171 |
| validation-2024-early | m30-kdj-staged | base | 0.91% | 282 | 1.07 | 1.941 | 0.035 |
| validation-2024-early | m30-pa-base | base | -3.43% | 483 | 0.8323 | -4.264 | -0.097 |
| validation-2024-early | m30-pa-key | base | -0.69% | 34 | 0.523 | -12.253 | -0.265 |
| validation-2024-early | m30-pa-legs | base | 1.02% | 17 | 2.982 | 36.033 | 0.794 |
| validation-2024-early | m30-pa-key-legs | base | 0.00% | 0 | — | — | — |
| validation-2024-early | m30-n320-x160-stress | stress | 5.16% | 138 | 1.505 | 22.442 | 0.602 |
| validation-2024-early | m30-n80-x40-stress | stress | 4.31% | 337 | 1.203 | 7.667 | 0.199 |
| validation-2024-early | m30-n160-x80-stress | stress | 6.15% | 205 | 1.442 | 17.994 | 0.472 |
| validation-2024-early | m30-n640-x320-stress | stress | 5.50% | 80 | 1.873 | 41.252 | 1.104 |
| validation-2024-early | m30-n320-episode-stress | stress | 4.57% | 74 | 1.866 | 37.015 | 0.963 |
| validation-2024-early | m30-n320-ema-stress | stress | 5.16% | 138 | 1.505 | 22.452 | 0.603 |
| validation-2024-early | m30-n320-slow-ema-stress | stress | 5.16% | 138 | 1.505 | 22.442 | 0.602 |
| validation-2024-early | m30-n320-background-stress | stress | 5.18% | 89 | 1.834 | 34.939 | 0.905 |
| validation-2024-early | m30-n320-both-stress | stress | 0.93% | 236 | 1.055 | 2.357 | 0.109 |
| validation-2024-early | m30-n320-short-stress | stress | -4.26% | 100 | 0.3843 | -25.558 | -0.591 |
| validation-2024-early | m30-n320-x20-stress | stress | -0.60% | 202 | 0.9449 | -1.782 | -0.035 |
| validation-2024-early | m30-n320-fixed-atr3-stress | stress | -3.66% | 263 | 0.69 | -8.352 | -0.201 |
| validation-2024-early | m30-n320-dynamic-atr3-stress | stress | -2.46% | 250 | 0.7761 | -5.902 | -0.137 |
| validation-2024-early | m30-n320-dynamic-atr6-stress | stress | -1.90% | 195 | 0.8267 | -5.837 | -0.126 |
| validation-2024-early | m30-n320-dynamic-be1-stress | stress | -2.58% | 253 | 0.7572 | -6.130 | -0.146 |
| validation-2024-early | m30-n320-dynamic-be2-stress | stress | -2.46% | 250 | 0.7761 | -5.902 | -0.137 |
| validation-2024-early | m30-n320-staged-stress | stress | -2.67% | 237 | 0.7588 | -6.762 | -0.160 |
| validation-2024-early | m30-n320-stop3-stress | stress | 3.10% | 109 | 1.422 | 17.060 | 0.408 |
| validation-2024-early | m30-n320-no-day-guard-stress | stress | 8.49% | 128 | 1.902 | 39.784 | 1.016 |
| validation-2024-early | m30-n80-dynamic-atr3-stress | stress | -4.06% | 494 | 0.8125 | -4.933 | -0.119 |
| validation-2024-early | m30-pullback-unfiltered-stress | stress | -8.55% | 696 | 0.7057 | -7.370 | -0.185 |
| validation-2024-early | m30-pullback-trend-stress | stress | -5.22% | 514 | 0.7589 | -6.096 | -0.144 |
| validation-2024-early | m30-pullback-long-stress | stress | -1.80% | 283 | 0.8533 | -3.820 | -0.079 |
| validation-2024-early | m30-pullback-staged-stress | stress | -2.53% | 492 | 0.8855 | -3.089 | -0.071 |
| validation-2024-early | m30-kdj-unfiltered-stress | stress | -15.86% | 1538 | 0.7368 | -6.188 | -0.168 |
| validation-2024-early | m30-kdj-trend-stress | stress | -0.78% | 304 | 0.9381 | -1.540 | -0.053 |
| validation-2024-early | m30-kdj-long-stress | stress | 0.36% | 106 | 1.082 | 2.026 | 0.039 |
| validation-2024-early | m30-kdj-staged-stress | stress | -0.76% | 284 | 0.9419 | -1.608 | -0.053 |
| validation-2024-early | m30-pa-base-stress | stress | -6.51% | 485 | 0.689 | -8.059 | -0.202 |
| validation-2024-early | m30-pa-key-stress | stress | -0.97% | 33 | 0.3567 | -17.605 | -0.424 |
| validation-2024-early | m30-pa-legs-stress | stress | 0.80% | 17 | 2.491 | 28.381 | 0.684 |
| validation-2024-early | m30-pa-key-legs-stress | stress | 0.00% | 0 | — | — | — |
| validation-continuous | m30-n320-x160 | base | 27.42% | 396 | 1.936 | 41.547 | 0.887 |
| validation-continuous | m30-n80-x40 | base | 18.43% | 1264 | 1.225 | 8.749 | 0.209 |
| validation-continuous | m30-n160-x80 | base | 30.59% | 708 | 1.593 | 25.920 | 0.573 |
| validation-continuous | m30-n640-x320 | base | 16.12% | 271 | 1.789 | 35.680 | 0.837 |
| validation-continuous | m30-n320-episode | base | 8.94% | 128 | 2.09 | 41.911 | 0.925 |
| validation-continuous | m30-n320-ema | base | 27.42% | 396 | 1.936 | 41.545 | 0.887 |
| validation-continuous | m30-n320-slow-ema | base | 27.42% | 396 | 1.936 | 41.547 | 0.887 |
| validation-continuous | m30-n320-background | base | 13.89% | 290 | 1.663 | 28.731 | 0.633 |
| validation-continuous | m30-n320-both | base | 15.84% | 842 | 1.258 | 11.288 | 0.277 |
| validation-continuous | m30-n320-short | base | -8.71% | 446 | 0.7065 | -11.718 | -0.251 |
| validation-continuous | m30-n320-x20 | base | 23.88% | 565 | 1.77 | 25.364 | 0.527 |
| validation-continuous | m30-n320-fixed-atr3 | base | 4.61% | 773 | 1.144 | 3.575 | 0.075 |
| validation-continuous | m30-n320-dynamic-atr3 | base | 6.97% | 734 | 1.229 | 5.696 | 0.110 |
| validation-continuous | m30-n320-dynamic-atr6 | base | 23.70% | 542 | 1.77 | 26.235 | 0.547 |
| validation-continuous | m30-n320-dynamic-be1 | base | 6.45% | 743 | 1.213 | 5.212 | 0.101 |
| validation-continuous | m30-n320-dynamic-be2 | base | 6.97% | 734 | 1.229 | 5.696 | 0.110 |
| validation-continuous | m30-n320-staged | base | 7.46% | 689 | 1.233 | 6.500 | 0.129 |
| validation-continuous | m30-n320-stop3 | base | 17.06% | 346 | 1.738 | 29.589 | 0.633 |
| validation-continuous | m30-n320-no-day-guard | base | 40.88% | 394 | 2.271 | 62.256 | 1.297 |
| validation-continuous | m30-n80-dynamic-atr3 | base | -6.75% | 1754 | 0.9066 | -2.309 | -0.061 |
| validation-continuous | m30-pullback-unfiltered | base | -17.38% | 2740 | 0.8297 | -3.805 | -0.093 |
| validation-continuous | m30-pullback-trend | base | -13.65% | 2038 | 0.8304 | -4.018 | -0.095 |
| validation-continuous | m30-pullback-long | base | -5.03% | 1026 | 0.881 | -2.943 | -0.069 |
| validation-continuous | m30-pullback-staged | base | -11.08% | 1959 | 0.8743 | -3.395 | -0.078 |
| validation-continuous | m30-kdj-unfiltered | base | -43.18% | 5653 | 0.7474 | -4.583 | -0.140 |
| validation-continuous | m30-kdj-trend | base | -11.09% | 1057 | 0.7247 | -6.297 | -0.149 |
| validation-continuous | m30-kdj-long | base | -6.55% | 410 | 0.6146 | -9.588 | -0.217 |
| validation-continuous | m30-kdj-staged | base | -10.05% | 1020 | 0.7819 | -5.910 | -0.137 |
| validation-continuous | m30-pa-base | base | -14.94% | 1976 | 0.8073 | -4.536 | -0.111 |
| validation-continuous | m30-pa-key | base | -0.20% | 152 | 0.9677 | -0.786 | -0.013 |
| validation-continuous | m30-pa-legs | base | -0.63% | 55 | 0.756 | -6.926 | -0.168 |
| validation-continuous | m30-pa-key-legs | base | 0.18% | 6 | 1.96 | 18.079 | 0.388 |
| validation-continuous | m30-n320-x160-stress | stress | 20.27% | 398 | 1.705 | 30.553 | 0.742 |
| validation-continuous | m30-n80-x40-stress | stress | 4.77% | 1270 | 1.061 | 2.251 | 0.077 |
| validation-continuous | m30-n160-x80-stress | stress | 18.75% | 715 | 1.371 | 15.731 | 0.429 |
| validation-continuous | m30-n640-x320-stress | stress | 11.58% | 275 | 1.565 | 25.264 | 0.666 |
| validation-continuous | m30-n320-episode-stress | stress | 6.79% | 128 | 1.833 | 31.807 | 0.800 |
| validation-continuous | m30-n320-ema-stress | stress | 20.28% | 398 | 1.706 | 30.569 | 0.742 |
| validation-continuous | m30-n320-slow-ema-stress | stress | 20.27% | 398 | 1.705 | 30.553 | 0.742 |
| validation-continuous | m30-n320-background-stress | stress | 9.90% | 292 | 1.475 | 20.344 | 0.491 |
| validation-continuous | m30-n320-both-stress | stress | 7.49% | 845 | 1.125 | 5.317 | 0.171 |
| validation-continuous | m30-n320-short-stress | stress | -10.28% | 447 | 0.6529 | -13.795 | -0.325 |
| validation-continuous | m30-n320-x20-stress | stress | 16.31% | 567 | 1.528 | 17.260 | 0.402 |
| validation-continuous | m30-n320-fixed-atr3-stress | stress | -1.48% | 775 | 0.9544 | -1.143 | -0.037 |
| validation-continuous | m30-n320-dynamic-atr3-stress | stress | 0.91% | 735 | 1.03 | 0.745 | -0.003 |
| validation-continuous | m30-n320-dynamic-atr6-stress | stress | 16.48% | 544 | 1.541 | 18.175 | 0.430 |
| validation-continuous | m30-n320-dynamic-be1-stress | stress | 0.16% | 748 | 1.005 | 0.126 | -0.017 |
| validation-continuous | m30-n320-dynamic-be2-stress | stress | 0.91% | 735 | 1.03 | 0.745 | -0.003 |
| validation-continuous | m30-n320-staged-stress | stress | 2.20% | 693 | 1.069 | 1.904 | 0.028 |
| validation-continuous | m30-n320-stop3-stress | stress | 13.51% | 347 | 1.589 | 23.357 | 0.550 |
| validation-continuous | m30-n320-no-day-guard-stress | stress | 32.77% | 396 | 2.045 | 49.658 | 1.175 |
| validation-continuous | m30-n80-dynamic-atr3-stress | stress | -18.22% | 1756 | 0.7437 | -6.224 | -0.190 |
| validation-continuous | m30-pullback-unfiltered-stress | stress | -32.42% | 2739 | 0.6679 | -7.102 | -0.219 |
| validation-continuous | m30-pullback-trend-stress | stress | -25.74% | 2038 | 0.6716 | -7.577 | -0.219 |
| validation-continuous | m30-pullback-long-stress | stress | -12.36% | 1026 | 0.7111 | -7.226 | -0.201 |
| validation-continuous | m30-pullback-staged-stress | stress | -25.53% | 1976 | 0.6932 | -7.752 | -0.223 |
| validation-continuous | m30-kdj-unfiltered-stress | stress | -61.46% | 5662 | 0.5982 | -6.513 | -0.264 |
| validation-continuous | m30-kdj-trend-stress | stress | -17.86% | 1059 | 0.5668 | -10.116 | -0.277 |
| validation-continuous | m30-kdj-long-stress | stress | -9.31% | 410 | 0.4718 | -13.621 | -0.348 |
| validation-continuous | m30-kdj-staged-stress | stress | -16.21% | 1024 | 0.6443 | -9.497 | -0.254 |
| validation-continuous | m30-pa-base-stress | stress | -26.59% | 1980 | 0.6492 | -8.059 | -0.238 |
| validation-continuous | m30-pa-key-stress | stress | -1.36% | 152 | 0.7867 | -5.362 | -0.131 |
| validation-continuous | m30-pa-legs-stress | stress | -1.00% | 55 | 0.6246 | -10.906 | -0.292 |
| validation-continuous | m30-pa-key-legs-stress | stress | 0.11% | 6 | 1.571 | 11.317 | 0.243 |
| historical-2021 | m30-n320-x160 | base | 36.94% | 237 | 2.857 | 93.523 | 1.686 |
| historical-2021 | m30-n80-x40 | base | 26.82% | 590 | 1.598 | 27.273 | 0.501 |
| historical-2021 | m30-n160-x80 | base | 29.63% | 391 | 1.904 | 45.474 | 0.820 |
| historical-2021 | m30-n640-x320 | base | 19.37% | 179 | 2.338 | 64.915 | 1.369 |
| historical-2021 | m30-n320-episode | base | 5.04% | 43 | 2.721 | 70.341 | 1.570 |
| historical-2021 | m30-n320-ema | base | 29.16% | 239 | 2.496 | 73.193 | 1.440 |
| historical-2021 | m30-n320-slow-ema | base | 36.94% | 237 | 2.857 | 93.523 | 1.686 |
| historical-2021 | m30-n320-background | base | 18.80% | 191 | 2.245 | 59.059 | 1.156 |
| historical-2021 | m30-n320-both | base | 28.74% | 384 | 1.876 | 44.910 | 0.867 |
| historical-2021 | m30-n320-short | base | -5.72% | 146 | 0.4274 | -23.513 | -0.510 |
| historical-2021 | m30-n320-x20 | base | 12.95% | 363 | 1.614 | 21.405 | 0.418 |
| historical-2021 | m30-n320-fixed-atr3 | base | 4.17% | 493 | 1.204 | 5.073 | 0.105 |
| historical-2021 | m30-n320-dynamic-atr3 | base | 5.65% | 458 | 1.299 | 7.403 | 0.147 |
| historical-2021 | m30-n320-dynamic-atr6 | base | 10.08% | 343 | 1.495 | 17.640 | 0.355 |
| historical-2021 | m30-n320-dynamic-be1 | base | 5.00% | 466 | 1.268 | 6.432 | 0.128 |
| historical-2021 | m30-n320-dynamic-be2 | base | 5.65% | 458 | 1.299 | 7.403 | 0.147 |
| historical-2021 | m30-n320-staged | base | 4.30% | 438 | 1.216 | 5.896 | 0.117 |
| historical-2021 | m30-n320-stop3 | base | 26.21% | 189 | 2.819 | 83.197 | 1.524 |
| historical-2021 | m30-n320-no-day-guard | base | 48.47% | 228 | 3.347 | 127.548 | 2.343 |
| historical-2021 | m30-n80-dynamic-atr3 | base | 5.15% | 878 | 1.14 | 3.517 | 0.075 |
| historical-2021 | m30-pullback-unfiltered | base | -0.35% | 1248 | 0.9926 | -0.171 | 0.004 |
| historical-2021 | m30-pullback-trend | base | -2.03% | 962 | 0.9463 | -1.269 | -0.022 |
| historical-2021 | m30-pullback-long | base | -0.64% | 537 | 0.9693 | -0.720 | -0.011 |
| historical-2021 | m30-pullback-staged | base | -1.31% | 926 | 0.968 | -0.851 | -0.011 |
| historical-2021 | m30-kdj-unfiltered | base | -18.69% | 2658 | 0.8033 | -4.219 | -0.095 |
| historical-2021 | m30-kdj-trend | base | -0.47% | 443 | 0.9725 | -0.632 | -0.017 |
| historical-2021 | m30-kdj-long | base | 1.08% | 131 | 1.21 | 4.943 | 0.101 |
| historical-2021 | m30-kdj-staged | base | -0.45% | 417 | 0.9765 | -0.644 | -0.019 |
| historical-2021 | m30-pa-base | base | -0.84% | 924 | 0.977 | -0.543 | -0.005 |
| historical-2021 | m30-pa-key | base | -0.72% | 66 | 0.7284 | -6.522 | -0.140 |
| historical-2021 | m30-pa-legs | base | -0.35% | 13 | 0.3309 | -16.239 | -0.345 |
| historical-2021 | m30-pa-key-legs | base | 0.03% | 1 | — | 19.010 | 0.397 |
| historical-2021 | m30-n320-x160-stress | stress | 35.46% | 236 | 2.791 | 90.153 | 1.700 |
| historical-2021 | m30-n80-x40-stress | stress | 23.07% | 592 | 1.519 | 23.385 | 0.448 |
| historical-2021 | m30-n160-x80-stress | stress | 26.24% | 392 | 1.808 | 40.171 | 0.757 |
| historical-2021 | m30-n640-x320-stress | stress | 17.22% | 180 | 2.194 | 57.384 | 1.268 |
| historical-2021 | m30-n320-episode-stress | stress | 4.85% | 43 | 2.633 | 67.702 | 1.597 |
| historical-2021 | m30-n320-ema-stress | stress | 27.96% | 238 | 2.441 | 70.496 | 1.453 |
| historical-2021 | m30-n320-slow-ema-stress | stress | 35.46% | 236 | 2.791 | 90.153 | 1.700 |
| historical-2021 | m30-n320-background-stress | stress | 18.24% | 190 | 2.215 | 57.589 | 1.176 |
| historical-2021 | m30-n320-both-stress | stress | 26.17% | 384 | 1.805 | 40.898 | 0.820 |
| historical-2021 | m30-n320-short-stress | stress | -6.03% | 146 | 0.3991 | -24.769 | -0.555 |
| historical-2021 | m30-n320-x20-stress | stress | 10.80% | 363 | 1.515 | 17.858 | 0.360 |
| historical-2021 | m30-n320-fixed-atr3-stress | stress | 1.98% | 493 | 1.096 | 2.415 | 0.052 |
| historical-2021 | m30-n320-dynamic-atr3-stress | stress | 3.43% | 458 | 1.179 | 4.495 | 0.090 |
| historical-2021 | m30-n320-dynamic-atr6-stress | stress | 8.00% | 344 | 1.391 | 13.952 | 0.291 |
| historical-2021 | m30-n320-dynamic-be1-stress | stress | 3.00% | 466 | 1.159 | 3.859 | 0.076 |
| historical-2021 | m30-n320-dynamic-be2-stress | stress | 3.43% | 458 | 1.179 | 4.495 | 0.090 |
| historical-2021 | m30-n320-staged-stress | stress | 1.57% | 445 | 1.077 | 2.117 | 0.039 |
| historical-2021 | m30-n320-stop3-stress | stress | 24.74% | 189 | 2.729 | 78.537 | 1.482 |
| historical-2021 | m30-n320-no-day-guard-stress | stress | 44.77% | 228 | 3.203 | 117.808 | 2.286 |
| historical-2021 | m30-n80-dynamic-atr3-stress | stress | 0.75% | 879 | 1.02 | 0.513 | 0.011 |
| historical-2021 | m30-pullback-unfiltered-stress | stress | -5.84% | 1246 | 0.879 | -2.813 | -0.056 |
| historical-2021 | m30-pullback-trend-stress | stress | -6.25% | 962 | 0.8362 | -3.899 | -0.084 |
| historical-2021 | m30-pullback-long-stress | stress | -3.13% | 537 | 0.8537 | -3.492 | -0.077 |
| historical-2021 | m30-pullback-staged-stress | stress | -5.75% | 928 | 0.8583 | -3.716 | -0.077 |
| historical-2021 | m30-kdj-unfiltered-stress | stress | -27.11% | 2662 | 0.7081 | -6.111 | -0.155 |
| historical-2021 | m30-kdj-trend-stress | stress | -2.13% | 442 | 0.876 | -2.889 | -0.070 |
| historical-2021 | m30-kdj-long-stress | stress | 0.43% | 130 | 1.082 | 1.988 | 0.035 |
| historical-2021 | m30-kdj-staged-stress | stress | -1.89% | 418 | 0.9 | -2.707 | -0.067 |
| historical-2021 | m30-pa-base-stress | stress | -5.03% | 924 | 0.8625 | -3.266 | -0.067 |
| historical-2021 | m30-pa-key-stress | stress | -0.94% | 66 | 0.6499 | -8.587 | -0.198 |
| historical-2021 | m30-pa-legs-stress | stress | -0.39% | 13 | 0.2721 | -18.090 | -0.398 |
| historical-2021 | m30-pa-key-legs-stress | stress | 0.03% | 1 | — | 16.033 | 0.348 |
| historical-stress | m30-n320-x160 | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n80-x40 | base | -6.97% | 251 | 0.5508 | -16.650 | -0.369 |
| historical-stress | m30-n160-x80 | base | -4.34% | 142 | 0.5515 | -18.317 | -0.402 |
| historical-stress | m30-n640-x320 | base | -1.15% | 42 | 0.6106 | -16.401 | -0.352 |
| historical-stress | m30-n320-episode | base | -1.09% | 70 | 0.7794 | -9.364 | -0.196 |
| historical-stress | m30-n320-ema | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n320-slow-ema | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n320-background | base | -0.89% | 54 | 0.7623 | -9.907 | -0.217 |
| historical-stress | m30-n320-both | base | 3.42% | 197 | 1.264 | 10.417 | 0.226 |
| historical-stress | m30-n320-short | base | 5.09% | 120 | 1.684 | 25.439 | 0.551 |
| historical-stress | m30-n320-x20 | base | -1.72% | 101 | 0.6588 | -10.232 | -0.228 |
| historical-stress | m30-n320-fixed-atr3 | base | -0.86% | 121 | 0.8376 | -4.265 | -0.101 |
| historical-stress | m30-n320-dynamic-atr3 | base | -1.61% | 126 | 0.7125 | -7.656 | -0.174 |
| historical-stress | m30-n320-dynamic-atr6 | base | -1.97% | 95 | 0.6182 | -12.417 | -0.278 |
| historical-stress | m30-n320-dynamic-be1 | base | -1.54% | 126 | 0.7209 | -7.355 | -0.167 |
| historical-stress | m30-n320-dynamic-be2 | base | -1.61% | 126 | 0.7125 | -7.656 | -0.174 |
| historical-stress | m30-n320-staged | base | -0.78% | 111 | 0.8535 | -4.238 | -0.095 |
| historical-stress | m30-n320-stop3 | base | -0.61% | 56 | 0.8356 | -6.486 | -0.122 |
| historical-stress | m30-n320-no-day-guard | base | -1.66% | 77 | 0.6991 | -12.948 | -0.276 |
| historical-stress | m30-n80-dynamic-atr3 | base | -4.32% | 318 | 0.6856 | -8.146 | -0.180 |
| historical-stress | m30-pullback-unfiltered | base | -6.06% | 609 | 0.7552 | -5.969 | -0.131 |
| historical-stress | m30-pullback-trend | base | -4.90% | 467 | 0.7414 | -6.302 | -0.136 |
| historical-stress | m30-pullback-long | base | -4.34% | 206 | 0.5188 | -12.642 | -0.276 |
| historical-stress | m30-pullback-staged | base | -3.84% | 440 | 0.8175 | -5.232 | -0.113 |
| historical-stress | m30-kdj-unfiltered | base | 3.79% | 1220 | 1.079 | 1.863 | 0.048 |
| historical-stress | m30-kdj-trend | base | 0.95% | 236 | 1.097 | 2.404 | 0.063 |
| historical-stress | m30-kdj-long | base | -0.68% | 58 | 0.7238 | -7.004 | -0.143 |
| historical-stress | m30-kdj-staged | base | 0.65% | 232 | 1.057 | 1.693 | 0.051 |
| historical-stress | m30-pa-base | base | -5.48% | 449 | 0.7043 | -7.323 | -0.162 |
| historical-stress | m30-pa-key | base | -0.86% | 33 | 0.4655 | -15.619 | -0.333 |
| historical-stress | m30-pa-legs | base | 0.09% | 8 | 1.405 | 6.579 | 0.146 |
| historical-stress | m30-pa-key-legs | base | 0.22% | 1 | — | 133.341 | 2.908 |
| historical-stress | m30-n320-x160-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n80-x40-stress | stress | -7.90% | 252 | 0.4941 | -18.813 | -0.451 |
| historical-stress | m30-n160-x80-stress | stress | -4.82% | 142 | 0.5024 | -20.360 | -0.477 |
| historical-stress | m30-n640-x320-stress | stress | -1.29% | 42 | 0.5623 | -18.448 | -0.423 |
| historical-stress | m30-n320-episode-stress | stress | -1.35% | 70 | 0.7263 | -11.609 | -0.268 |
| historical-stress | m30-n320-ema-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n320-slow-ema-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n320-background-stress | stress | -1.13% | 54 | 0.6987 | -12.600 | -0.282 |
| historical-stress | m30-n320-both-stress | stress | 2.03% | 198 | 1.156 | 6.144 | 0.150 |
| historical-stress | m30-n320-short-stress | stress | 3.99% | 121 | 1.53 | 19.766 | 0.469 |
| historical-stress | m30-n320-x20-stress | stress | -2.14% | 101 | 0.5809 | -12.701 | -0.305 |
| historical-stress | m30-n320-fixed-atr3-stress | stress | -1.43% | 121 | 0.7355 | -7.107 | -0.178 |
| historical-stress | m30-n320-dynamic-atr3-stress | stress | -2.19% | 126 | 0.6198 | -10.407 | -0.253 |
| historical-stress | m30-n320-dynamic-atr6-stress | stress | -2.33% | 95 | 0.55 | -14.716 | -0.353 |
| historical-stress | m30-n320-dynamic-be1-stress | stress | -2.10% | 126 | 0.6295 | -9.992 | -0.243 |
| historical-stress | m30-n320-dynamic-be2-stress | stress | -2.19% | 126 | 0.6198 | -10.407 | -0.253 |
| historical-stress | m30-n320-staged-stress | stress | -1.01% | 110 | 0.8084 | -5.489 | -0.138 |
| historical-stress | m30-n320-stop3-stress | stress | -0.73% | 56 | 0.8014 | -7.835 | -0.170 |
| historical-stress | m30-n320-no-day-guard-stress | stress | -1.92% | 77 | 0.6514 | -14.984 | -0.346 |
| historical-stress | m30-n80-dynamic-atr3-stress | stress | -5.81% | 318 | 0.587 | -10.961 | -0.263 |
| historical-stress | m30-pullback-unfiltered-stress | stress | -9.28% | 610 | 0.6338 | -9.131 | -0.217 |
| historical-stress | m30-pullback-trend-stress | stress | -7.17% | 467 | 0.6307 | -9.216 | -0.216 |
| historical-stress | m30-pullback-long-stress | stress | -5.31% | 206 | 0.4317 | -15.454 | -0.362 |
| historical-stress | m30-pullback-staged-stress | stress | -7.36% | 445 | 0.6519 | -9.928 | -0.232 |
| historical-stress | m30-kdj-unfiltered-stress | stress | -3.77% | 1223 | 0.9214 | -1.850 | -0.031 |
| historical-stress | m30-kdj-trend-stress | stress | -0.65% | 236 | 0.9341 | -1.663 | -0.023 |
| historical-stress | m30-kdj-long-stress | stress | -1.02% | 58 | 0.601 | -10.505 | -0.229 |
| historical-stress | m30-kdj-staged-stress | stress | -0.76% | 232 | 0.933 | -1.971 | -0.026 |
| historical-stress | m30-pa-base-stress | stress | -7.76% | 450 | 0.5948 | -10.341 | -0.246 |
| historical-stress | m30-pa-key-stress | stress | -1.00% | 33 | 0.398 | -18.100 | -0.407 |
| historical-stress | m30-pa-legs-stress | stress | 0.03% | 8 | 1.14 | 2.391 | 0.065 |
| historical-stress | m30-pa-key-legs-stress | stress | 0.20% | 1 | — | 118.738 | 2.811 |
| completion-2022-aug | m30-n320-x160 | base | -1.15% | 17 | 0.07809 | -40.648 | -0.881 |
| completion-2022-aug | m30-n80-x40 | base | -2.57% | 46 | 0.1841 | -33.566 | -0.740 |
| completion-2022-aug | m30-n160-x80 | base | -1.83% | 29 | 0.1696 | -37.825 | -0.829 |
| completion-2022-aug | m30-n640-x320 | base | -0.57% | 9 | 0.0229 | -38.183 | -0.817 |
| completion-2022-aug | m30-n320-episode | base | -1.15% | 17 | 0.07809 | -40.648 | -0.881 |
| completion-2022-aug | m30-n320-ema | base | -1.25% | 17 | 0.06304 | -44.129 | -0.955 |
| completion-2022-aug | m30-n320-slow-ema | base | -1.15% | 17 | 0.07809 | -40.648 | -0.881 |
| completion-2022-aug | m30-n320-background | base | -0.75% | 11 | 0.1011 | -40.806 | -0.877 |
| completion-2022-aug | m30-n320-both | base | 0.80% | 27 | 1.523 | 17.790 | 0.396 |
| completion-2022-aug | m30-n320-short | base | 1.89% | 11 | 6.187 | 103.188 | 2.238 |
| completion-2022-aug | m30-n320-x20 | base | -0.85% | 19 | 0.1854 | -26.931 | -0.587 |
| completion-2022-aug | m30-n320-fixed-atr3 | base | -0.22% | 20 | 0.6853 | -6.609 | -0.139 |
| completion-2022-aug | m30-n320-dynamic-atr3 | base | -0.32% | 20 | 0.5638 | -9.510 | -0.203 |
| completion-2022-aug | m30-n320-dynamic-atr6 | base | -0.93% | 19 | 0.1511 | -29.419 | -0.638 |
| completion-2022-aug | m30-n320-dynamic-be1 | base | -0.30% | 20 | 0.5756 | -9.066 | -0.193 |
| completion-2022-aug | m30-n320-dynamic-be2 | base | -0.32% | 20 | 0.5638 | -9.510 | -0.203 |
| completion-2022-aug | m30-n320-staged | base | -0.42% | 20 | 0.4331 | -12.684 | -0.271 |
| completion-2022-aug | m30-n320-stop3 | base | -0.98% | 15 | 0.09495 | -39.216 | -0.833 |
| completion-2022-aug | m30-n320-no-day-guard | base | -1.15% | 17 | 0.07809 | -40.648 | -0.881 |
| completion-2022-aug | m30-n80-dynamic-atr3 | base | -1.06% | 52 | 0.5322 | -12.179 | -0.263 |
| completion-2022-aug | m30-pullback-unfiltered | base | -1.01% | 97 | 0.7543 | -6.231 | -0.135 |
| completion-2022-aug | m30-pullback-trend | base | -1.04% | 73 | 0.6851 | -8.554 | -0.186 |
| completion-2022-aug | m30-pullback-long | base | -0.44% | 33 | 0.6499 | -8.071 | -0.184 |
| completion-2022-aug | m30-pullback-staged | base | -1.17% | 72 | 0.6801 | -9.718 | -0.214 |
| completion-2022-aug | m30-kdj-unfiltered | base | 2.28% | 197 | 1.335 | 6.936 | 0.152 |
| completion-2022-aug | m30-kdj-trend | base | -0.10% | 45 | 0.9255 | -1.375 | -0.027 |
| completion-2022-aug | m30-kdj-long | base | 0.05% | 10 | 1.206 | 2.979 | 0.060 |
| completion-2022-aug | m30-kdj-staged | base | 0.24% | 42 | 1.176 | 3.358 | 0.089 |
| completion-2022-aug | m30-pa-base | base | -1.26% | 72 | 0.595 | -10.511 | -0.229 |
| completion-2022-aug | m30-pa-key | base | 0.32% | 8 | 3.09 | 23.781 | 0.495 |
| completion-2022-aug | m30-pa-legs | base | -0.04% | 3 | 0.5404 | -8.183 | -0.186 |
| completion-2022-aug | m30-pa-key-legs | base | 0.05% | 1 | — | 28.863 | 0.623 |
| completion-2022-aug | m30-n320-x160-stress | stress | -1.17% | 17 | 0.06675 | -41.132 | -0.952 |
| completion-2022-aug | m30-n80-x40-stress | stress | -2.66% | 46 | 0.1639 | -34.675 | -0.826 |
| completion-2022-aug | m30-n160-x80-stress | stress | -1.86% | 29 | 0.1558 | -38.470 | -0.906 |
| completion-2022-aug | m30-n640-x320-stress | stress | -0.58% | 9 | 0.01391 | -38.974 | -0.880 |
| completion-2022-aug | m30-n320-episode-stress | stress | -1.17% | 17 | 0.06675 | -41.132 | -0.952 |
| completion-2022-aug | m30-n320-ema-stress | stress | -1.26% | 17 | 0.05631 | -44.426 | -1.025 |
| completion-2022-aug | m30-n320-slow-ema-stress | stress | -1.17% | 17 | 0.06675 | -41.132 | -0.952 |
| completion-2022-aug | m30-n320-background-stress | stress | -0.76% | 11 | 0.09032 | -41.264 | -0.942 |
| completion-2022-aug | m30-n320-both-stress | stress | 0.62% | 27 | 1.404 | 13.746 | 0.325 |
| completion-2022-aug | m30-n320-short-stress | stress | 1.71% | 11 | 5.666 | 93.227 | 2.169 |
| completion-2022-aug | m30-n320-x20-stress | stress | -0.90% | 19 | 0.1551 | -28.350 | -0.664 |
| completion-2022-aug | m30-n320-fixed-atr3-stress | stress | -0.33% | 20 | 0.5438 | -9.767 | -0.219 |
| completion-2022-aug | m30-n320-dynamic-atr3-stress | stress | -0.41% | 20 | 0.4344 | -12.432 | -0.281 |
| completion-2022-aug | m30-n320-dynamic-atr6-stress | stress | -0.98% | 19 | 0.1185 | -30.801 | -0.715 |
| completion-2022-aug | m30-n320-dynamic-be1-stress | stress | -0.39% | 20 | 0.4503 | -11.761 | -0.266 |
| completion-2022-aug | m30-n320-dynamic-be2-stress | stress | -0.41% | 20 | 0.4344 | -12.432 | -0.281 |
| completion-2022-aug | m30-n320-staged-stress | stress | -0.43% | 20 | 0.429 | -12.769 | -0.288 |
| completion-2022-aug | m30-n320-stop3-stress | stress | -0.99% | 15 | 0.08496 | -39.655 | -0.882 |
| completion-2022-aug | m30-n320-no-day-guard-stress | stress | -1.17% | 17 | 0.06675 | -41.132 | -0.952 |
| completion-2022-aug | m30-n80-dynamic-atr3-stress | stress | -1.24% | 51 | 0.4476 | -14.579 | -0.338 |
| completion-2022-aug | m30-pullback-unfiltered-stress | stress | -1.54% | 97 | 0.6343 | -9.543 | -0.224 |
| completion-2022-aug | m30-pullback-trend-stress | stress | -1.42% | 73 | 0.5817 | -11.656 | -0.276 |
| completion-2022-aug | m30-pullback-long-stress | stress | -0.62% | 33 | 0.5271 | -11.334 | -0.284 |
| completion-2022-aug | m30-pullback-staged-stress | stress | -1.59% | 72 | 0.5718 | -13.289 | -0.317 |
| completion-2022-aug | m30-kdj-unfiltered-stress | stress | 0.81% | 198 | 1.115 | 2.459 | 0.059 |
| completion-2022-aug | m30-kdj-trend-stress | stress | -0.38% | 45 | 0.7381 | -5.071 | -0.114 |
| completion-2022-aug | m30-kdj-long-stress | stress | -0.01% | 10 | 0.977 | -0.363 | -0.015 |
| completion-2022-aug | m30-kdj-staged-stress | stress | 0.12% | 43 | 1.092 | 1.720 | 0.063 |
| completion-2022-aug | m30-pa-base-stress | stress | -1.60% | 72 | 0.503 | -13.292 | -0.313 |
| completion-2022-aug | m30-pa-key-stress | stress | 0.25% | 8 | 2.554 | 18.839 | 0.400 |
| completion-2022-aug | m30-pa-legs-stress | stress | -0.06% | 3 | 0.3899 | -11.949 | -0.294 |
| completion-2022-aug | m30-pa-key-legs-stress | stress | 0.04% | 1 | — | 22.906 | 0.530 |

</details>

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | 23.90% | 1.733 | -4.69% | 243 | 5/6 | 913.72 | 527.53 |
| validation-2024-early | 10.34% | 1.632 | -6.00% | 128 | 4/6 | 438.20 | 753.62 |
| validation-continuous | 40.88% | 1.533 | -8.65% | 394 | 6/6 | 1793.09 | 1054.41 |
| historical-2021 | 48.47% | 2.050 | -11.02% | 228 | 6/6 | 626.94 | 3841.25 |
| historical-stress | -1.66% | -0.848 | -3.01% | 77 | 3/6 | 202.84 | 14.24 |
| completion-2022-aug | -1.15% | -5.977 | -1.15% | 17 | 0/6 | 45.50 | 5.93 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | 17.42% | 9.53% | 3.212 | 3.713 | -1.99% | 190.000 | 46.000 |
| validation-2024-early | 18.36% | 10.68% | 2.873 | 3.061 | -3.25% | 130.000 | 10.000 |
| validation-continuous | 17.89% | 11.14% | 3.166 | 2.068 | -3.17% | 227.000 | 38.000 |
| historical-2021 | 48.47% | 20.26% | 3.762 | 4.398 | -6.12% | 169.000 | 53.000 |
| historical-stress | -3.32% | 3.90% | -1.326 | -1.105 | -0.79% | 141.000 | 141.000 |
| completion-2022-aug | -12.75% | 2.28% | -6.278 | -11.070 | -0.37% | 29.000 | 29.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| development | 913.72 | 527.53 | 425.69 | 1866.94 | 16207.22 | 14340.28 |
| validation-2024-early | 438.20 | 753.62 | 200.41 | 1392.23 | 7594.67 | 6202.44 |
| validation-continuous | 1793.09 | 1054.41 | 768.08 | 3615.57 | 28144.37 | 24528.80 |
| historical-2021 | 626.94 | 3841.25 | 285.96 | 4754.16 | 33835.18 | 29081.02 |
| historical-stress | 202.84 | 14.24 | 88.60 | 305.68 | -691.34 | -997.02 |
| completion-2022-aug | 45.50 | 5.93 | 21.11 | 72.53 | -618.49 | -691.02 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development / BTCUSDT | 36.09% | 2.097 | 4.792 | 5.275 | -6.84% | 122.272 | 531.65 |
| development / ETHUSDT | 14.61% | 1.122 | 2.034 | 1.490 | -9.81% | 295.034 | 365.25 |
| development / BNBUSDT | 6.46% | 0.589 | 0.991 | 0.409 | -15.77% | 351.712 | 151.38 |
| development / SOLUSDT | 48.55% | 1.714 | 3.458 | 2.875 | -16.89% | 276.847 | 261.97 |
| development / XRPUSDT | -6.44% | -0.559 | -0.967 | -0.526 | -12.25% | 293.535 | 224.51 |
| development / DOGEUSDT | 2.11% | 0.208 | 0.417 | 0.084 | -25.05% | 425.599 | 332.18 |
| validation-2024-early / BTCUSDT | 33.83% | 1.892 | 3.451 | 4.654 | -7.27% | 139.704 | 377.39 |
| validation-2024-early / ETHUSDT | 57.20% | 2.821 | 6.940 | 7.103 | -8.05% | 69.902 | 327.46 |
| validation-2024-early / BNBUSDT | 15.44% | 0.938 | 1.631 | 1.610 | -9.59% | 137.998 | 77.29 |
| validation-2024-early / SOLUSDT | -9.06% | -0.761 | -1.172 | -0.713 | -12.70% | 185.548 | 168.96 |
| validation-2024-early / XRPUSDT | -0.76% | -0.013 | -0.021 | -0.067 | -11.37% | 165.886 | 172.87 |
| validation-2024-early / DOGEUSDT | 18.43% | 0.816 | 1.357 | 0.963 | -19.14% | 148.912 | 268.26 |
| validation-continuous / BTCUSDT | 5.41% | 0.548 | 0.988 | 0.503 | -10.75% | 466.006 | 668.87 |
| validation-continuous / ETHUSDT | 10.62% | 0.788 | 1.652 | 0.797 | -13.32% | 371.885 | 514.55 |
| validation-continuous / BNBUSDT | 0.17% | 0.075 | 0.124 | 0.009 | -19.53% | 358.490 | 655.05 |
| validation-continuous / SOLUSDT | 16.19% | 1.233 | 2.161 | 1.754 | -9.23% | 372.174 | 388.37 |
| validation-continuous / XRPUSDT | 53.99% | 1.754 | 4.186 | 2.366 | -22.82% | 226.635 | 988.63 |
| validation-continuous / DOGEUSDT | 12.42% | 0.878 | 1.655 | 1.112 | -11.17% | 187.679 | 400.10 |
| historical-2021 / BTCUSDT | 2.09% | 0.233 | 0.345 | 0.174 | -12.00% | 289.384 | 489.85 |
| historical-2021 / ETHUSDT | 18.68% | 1.003 | 1.625 | 1.629 | -11.47% | 110.633 | 855.87 |
| historical-2021 / BNBUSDT | 106.42% | 1.481 | 3.212 | 3.256 | -32.69% | 315.378 | 1498.56 |
| historical-2021 / SOLUSDT | 20.35% | 1.318 | 2.304 | 1.836 | -11.09% | 121.325 | 523.41 |
| historical-2021 / XRPUSDT | 11.22% | 0.668 | 1.243 | 0.713 | -15.75% | 261.774 | 508.57 |
| historical-2021 / DOGEUSDT | 132.05% | 1.719 | 4.040 | 3.684 | -35.85% | 259.427 | 877.90 |
| historical-stress / BTCUSDT | 1.95% | 0.355 | 0.539 | 0.573 | -3.40% | 94.185 | 54.39 |
| historical-stress / ETHUSDT | 1.11% | 0.258 | 0.354 | 0.345 | -3.22% | 93.485 | 49.71 |
| historical-stress / BNBUSDT | -6.07% | -0.854 | -1.106 | -0.910 | -6.67% | 91.921 | 40.67 |
| historical-stress / SOLUSDT | -2.86% | -0.335 | -0.544 | -0.457 | -6.25% | 89.433 | 53.86 |
| historical-stress / XRPUSDT | 0.60% | 0.109 | 0.229 | 0.068 | -8.90% | 142.729 | 58.54 |
| historical-stress / DOGEUSDT | -14.17% | -3.154 | -3.543 | -1.715 | -8.26% | 167.735 | 48.50 |
| completion-2022-aug / BTCUSDT | -11.29% | -4.092 | -4.139 | -5.470 | -2.06% | 23.493 | 13.35 |
| completion-2022-aug / ETHUSDT | -4.89% | -0.971 | -1.384 | -2.181 | -2.24% | 17.671 | 9.64 |
| completion-2022-aug / BNBUSDT | -5.64% | -1.376 | -1.815 | -3.954 | -1.43% | 21.371 | 9.35 |
| completion-2022-aug / SOLUSDT | -16.25% | -3.712 | -4.040 | -8.534 | -1.90% | 18.743 | 11.87 |
| completion-2022-aug / XRPUSDT | -11.13% | -4.936 | -4.853 | -8.418 | -1.32% | 11.952 | 10.48 |
| completion-2022-aug / DOGEUSDT | -25.68% | -3.445 | -4.083 | -8.465 | -3.03% | 17.307 | 17.84 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development | 16.29% | 23.90% | — | [-0.275, 3.165] |
| validation-2024-early | 7.08% | 10.34% | 8.49% | [-2.494, 6.325] |
| validation-continuous | 27.42% | 40.88% | 32.77% | [-0.470, 3.682] |
| historical-2021 | 36.94% | 48.47% | 44.77% | [-3.091, 9.273] |
| historical-stress | -1.66% | -1.66% | -1.92% | [0.000, 0.000] |
| completion-2022-aug | -1.15% | -1.15% | -1.17% | [0.000, 0.000] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | m30-n320-ema − m30-n320-x160 | +0.17 | +0.08 | [-0.003, 0.080] |
| development | m30-n320-slow-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| development | m30-n320-background − m30-n320-x160 | +0.06 | +4.18 | [-2.195, 1.984] |
| development | m30-n320-both − m30-n320-x160 | -6.72 | -1.54 | [-3.097, 1.043] |
| development | m30-n320-fixed-atr3 − m30-n320-x160 | -12.29 | +4.72 | [-6.549, 1.141] |
| development | m30-n320-dynamic-atr3 − m30-n320-x160 | -12.89 | +5.00 | [-6.687, 1.129] |
| development | m30-n320-dynamic-atr6 − m30-n320-dynamic-atr3 | +0.50 | -1.46 | [-0.747, 1.096] |
| development | m30-n320-dynamic-be1 − m30-n320-dynamic-atr3 | -0.09 | +0.02 | [-0.135, 0.073] |
| development | m30-n320-dynamic-be2 − m30-n320-dynamic-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| development | m30-n320-staged − m30-n320-dynamic-be1 | +0.04 | -0.29 | [-0.324, 0.378] |
| development | m30-n80-dynamic-atr3 − m30-n320-dynamic-atr3 | -5.27 | -4.40 | [-2.366, 0.385] |
| development | m30-pullback-trend − m30-pullback-unfiltered | +1.71 | +1.49 | [-0.476, 1.246] |
| development | m30-pullback-long − m30-pullback-trend | +5.42 | +4.63 | [0.124, 2.219] |
| development | m30-pullback-staged − m30-pullback-trend | +2.09 | +2.26 | [-0.482, 1.347] |
| development | m30-kdj-trend − m30-kdj-unfiltered | +22.66 | +21.70 | [2.703, 8.392] |
| development | m30-kdj-long − m30-kdj-trend | +3.21 | +2.69 | [-0.672, 1.902] |
| development | m30-kdj-staged − m30-kdj-trend | +1.08 | +1.41 | [-0.676, 1.202] |
| development | m30-pa-key − m30-pa-base | +8.71 | +9.09 | [0.448, 3.293] |
| development | m30-pa-legs − m30-pa-base | +9.73 | +9.92 | [0.594, 3.545] |
| development | m30-pa-key-legs − m30-pa-base | +9.84 | +10.21 | [0.616, 3.552] |
| validation-2024-early | m30-n320-ema − m30-n320-x160 | +0.00 | +0.00 | [-0.017, 0.020] |
| validation-2024-early | m30-n320-slow-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| validation-2024-early | m30-n320-background − m30-n320-x160 | -0.55 | +1.83 | [-3.750, 2.572] |
| validation-2024-early | m30-n320-both − m30-n320-x160 | -3.92 | -2.49 | [-4.264, 1.695] |
| validation-2024-early | m30-n320-fixed-atr3 − m30-n320-x160 | -9.03 | +1.68 | [-9.817, 0.405] |
| validation-2024-early | m30-n320-dynamic-atr3 − m30-n320-x160 | -7.81 | +2.23 | [-9.193, 1.122] |
| validation-2024-early | m30-n320-dynamic-atr6 − m30-n320-dynamic-atr3 | +0.16 | -0.82 | [-1.307, 1.659] |
| validation-2024-early | m30-n320-dynamic-be1 − m30-n320-dynamic-atr3 | -0.19 | +0.03 | [-0.488, 0.198] |
| validation-2024-early | m30-n320-dynamic-be2 − m30-n320-dynamic-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| validation-2024-early | m30-n320-staged − m30-n320-dynamic-be1 | -0.45 | -0.44 | [-0.816, 0.412] |
| validation-2024-early | m30-n80-dynamic-atr3 − m30-n320-dynamic-atr3 | +0.44 | -1.34 | [-1.725, 2.441] |
| validation-2024-early | m30-pullback-trend − m30-pullback-unfiltered | +2.31 | +2.04 | [-0.911, 3.108] |
| validation-2024-early | m30-pullback-long − m30-pullback-trend | +1.52 | +1.51 | [-1.041, 2.449] |
| validation-2024-early | m30-pullback-staged − m30-pullback-trend | +2.80 | -0.73 | [-0.069, 2.815] |
| validation-2024-early | m30-kdj-trend − m30-kdj-unfiltered | +7.34 | +4.70 | [-0.153, 7.211] |
| validation-2024-early | m30-kdj-long − m30-kdj-trend | -0.19 | +1.06 | [-2.523, 1.888] |
| validation-2024-early | m30-kdj-staged − m30-kdj-trend | -0.65 | -0.53 | [-1.014, 0.443] |
| validation-2024-early | m30-pa-key − m30-pa-base | +2.74 | +4.24 | [-1.122, 3.780] |
| validation-2024-early | m30-pa-legs − m30-pa-base | +4.45 | +4.66 | [-0.292, 4.695] |
| validation-2024-early | m30-pa-key-legs − m30-pa-base | +3.43 | +4.97 | [-0.908, 4.320] |
| validation-continuous | m30-n320-ema − m30-n320-x160 | -0.00 | +0.00 | [-0.083, 0.074] |
| validation-continuous | m30-n320-slow-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| validation-continuous | m30-n320-background − m30-n320-x160 | -13.53 | +1.86 | [-3.902, 0.159] |
| validation-continuous | m30-n320-both − m30-n320-x160 | -11.58 | -3.25 | [-3.361, 1.610] |
| validation-continuous | m30-n320-fixed-atr3 − m30-n320-x160 | -22.82 | +5.42 | [-6.095, 0.182] |
| validation-continuous | m30-n320-dynamic-atr3 − m30-n320-x160 | -20.45 | +5.38 | [-5.956, 0.531] |
| validation-continuous | m30-n320-dynamic-atr6 − m30-n320-dynamic-atr3 | +16.73 | -1.32 | [0.060, 4.817] |
| validation-continuous | m30-n320-dynamic-be1 − m30-n320-dynamic-atr3 | -0.51 | +0.03 | [-0.174, 0.034] |
| validation-continuous | m30-n320-dynamic-be2 − m30-n320-dynamic-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| validation-continuous | m30-n320-staged − m30-n320-dynamic-be1 | +1.01 | -0.35 | [-0.196, 0.523] |
| validation-continuous | m30-n80-dynamic-atr3 − m30-n320-dynamic-atr3 | -13.72 | -10.55 | [-3.052, -0.507] |
| validation-continuous | m30-pullback-trend − m30-pullback-unfiltered | +3.73 | +3.30 | [-0.461, 1.484] |
| validation-continuous | m30-pullback-long − m30-pullback-trend | +8.62 | +7.21 | [-0.186, 2.451] |
| validation-continuous | m30-pullback-staged − m30-pullback-trend | +2.56 | +1.81 | [-0.322, 1.159] |
| validation-continuous | m30-kdj-trend − m30-kdj-unfiltered | +32.08 | +31.51 | [2.848, 8.623] |
| validation-continuous | m30-kdj-long − m30-kdj-trend | +4.54 | +3.77 | [-0.299, 1.501] |
| validation-continuous | m30-kdj-staged − m30-kdj-trend | +1.05 | +1.52 | [-0.429, 0.809] |
| validation-continuous | m30-pa-key − m30-pa-base | +14.74 | +13.83 | [0.234, 3.775] |
| validation-continuous | m30-pa-legs − m30-pa-base | +14.30 | +14.32 | [0.079, 3.795] |
| validation-continuous | m30-pa-key-legs − m30-pa-base | +15.12 | +15.59 | [0.191, 3.904] |
| historical-2021 | m30-n320-ema − m30-n320-x160 | -7.79 | -0.15 | [-5.106, 0.327] |
| historical-2021 | m30-n320-slow-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-2021 | m30-n320-background − m30-n320-x160 | -18.14 | +0.55 | [-7.932, -0.780] |
| historical-2021 | m30-n320-both − m30-n320-x160 | -8.20 | -1.31 | [-3.338, 0.172] |
| historical-2021 | m30-n320-fixed-atr3 − m30-n320-x160 | -32.77 | +1.48 | [-13.800, -2.611] |
| historical-2021 | m30-n320-dynamic-atr3 − m30-n320-x160 | -31.29 | +1.29 | [-13.094, -2.359] |
| historical-2021 | m30-n320-dynamic-atr6 − m30-n320-dynamic-atr3 | +4.43 | -1.15 | [-1.072, 4.077] |
| historical-2021 | m30-n320-dynamic-be1 − m30-n320-dynamic-atr3 | -0.66 | -0.01 | [-0.439, 0.052] |
| historical-2021 | m30-n320-dynamic-be2 − m30-n320-dynamic-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-2021 | m30-n320-staged − m30-n320-dynamic-be1 | -0.69 | -0.45 | [-0.716, 0.364] |
| historical-2021 | m30-n80-dynamic-atr3 − m30-n320-dynamic-atr3 | -0.50 | -0.71 | [-1.591, 1.438] |
| historical-2021 | m30-pullback-trend − m30-pullback-unfiltered | -1.68 | +0.65 | [-1.659, 0.646] |
| historical-2021 | m30-pullback-long − m30-pullback-trend | +1.39 | +1.06 | [-1.446, 1.944] |
| historical-2021 | m30-pullback-staged − m30-pullback-trend | +0.72 | -0.85 | [-0.921, 1.430] |
| historical-2021 | m30-kdj-trend − m30-kdj-unfiltered | +18.22 | +17.00 | [2.432, 8.471] |
| historical-2021 | m30-kdj-long − m30-kdj-trend | +1.55 | +1.34 | [-0.662, 1.433] |
| historical-2021 | m30-kdj-staged − m30-kdj-trend | +0.02 | -0.15 | [-0.700, 0.769] |
| historical-2021 | m30-pa-key − m30-pa-base | +0.12 | +3.97 | [-1.813, 1.794] |
| historical-2021 | m30-pa-legs − m30-pa-base | +0.48 | +4.75 | [-1.775, 1.980] |
| historical-2021 | m30-pa-key-legs − m30-pa-base | +0.87 | +5.13 | [-1.690, 2.114] |
| historical-stress | m30-n320-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-stress | m30-n320-slow-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-stress | m30-n320-background − m30-n320-x160 | +0.77 | +0.39 | [-1.328, 1.913] |
| historical-stress | m30-n320-both − m30-n320-x160 | +5.08 | -2.37 | [-3.706, 11.089] |
| historical-stress | m30-n320-fixed-atr3 − m30-n320-x160 | +0.80 | +0.68 | [-2.648, 2.845] |
| historical-stress | m30-n320-dynamic-atr3 − m30-n320-x160 | +0.05 | +0.28 | [-3.115, 2.465] |
| historical-stress | m30-n320-dynamic-atr6 − m30-n320-dynamic-atr3 | -0.36 | -0.21 | [-0.959, 0.644] |
| historical-stress | m30-n320-dynamic-be1 − m30-n320-dynamic-atr3 | +0.06 | +0.00 | [0.000, 0.093] |
| historical-stress | m30-n320-dynamic-be2 − m30-n320-dynamic-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| historical-stress | m30-n320-staged − m30-n320-dynamic-be1 | +0.76 | +0.06 | [-0.157, 1.168] |
| historical-stress | m30-n80-dynamic-atr3 − m30-n320-dynamic-atr3 | -2.71 | -2.22 | [-3.526, 0.394] |
| historical-stress | m30-pullback-trend − m30-pullback-unfiltered | +1.15 | +0.83 | [-0.917, 2.352] |
| historical-stress | m30-pullback-long − m30-pullback-trend | +0.56 | +1.17 | [-2.047, 2.505] |
| historical-stress | m30-pullback-staged − m30-pullback-trend | +1.07 | +0.80 | [-0.965, 2.504] |
| historical-stress | m30-kdj-trend − m30-kdj-unfiltered | -2.84 | +2.56 | [-6.820, 3.936] |
| historical-stress | m30-kdj-long − m30-kdj-trend | -1.62 | +0.48 | [-3.149, 1.318] |
| historical-stress | m30-kdj-staged − m30-kdj-trend | -0.29 | -0.42 | [-1.069, 0.909] |
| historical-stress | m30-pa-key − m30-pa-base | +4.62 | +4.90 | [-0.243, 5.200] |
| historical-stress | m30-pa-legs − m30-pa-base | +5.57 | +5.78 | [0.151, 5.881] |
| historical-stress | m30-pa-key-legs − m30-pa-base | +5.70 | +5.89 | [0.189, 5.972] |
| completion-2022-aug | m30-n320-ema − m30-n320-x160 | -0.10 | -0.10 | [-0.760, -0.000] |
| completion-2022-aug | m30-n320-slow-ema − m30-n320-x160 | +0.00 | +0.00 | [0.000, 0.000] |
| completion-2022-aug | m30-n320-background − m30-n320-x160 | +0.40 | +0.40 | [-0.978, 3.987] |
| completion-2022-aug | m30-n320-both − m30-n320-x160 | +1.95 | +0.14 | [-2.828, 18.231] |
| completion-2022-aug | m30-n320-fixed-atr3 − m30-n320-x160 | +0.93 | +0.86 | [0.203, 6.489] |
| completion-2022-aug | m30-n320-dynamic-atr3 − m30-n320-x160 | +0.83 | +0.83 | [0.151, 5.874] |
| completion-2022-aug | m30-n320-dynamic-atr6 − m30-n320-dynamic-atr3 | -0.61 | -0.61 | [-4.061, -0.289] |
| completion-2022-aug | m30-n320-dynamic-be1 − m30-n320-dynamic-atr3 | +0.01 | +0.01 | [-0.000, 0.144] |
| completion-2022-aug | m30-n320-dynamic-be2 − m30-n320-dynamic-atr3 | +0.00 | +0.00 | [0.000, 0.000] |
| completion-2022-aug | m30-n320-staged − m30-n320-dynamic-be1 | -0.12 | -0.11 | [-0.874, 0.055] |
| completion-2022-aug | m30-n80-dynamic-atr3 − m30-n320-dynamic-atr3 | -0.74 | -0.79 | [-5.168, 0.678] |
| completion-2022-aug | m30-pullback-trend − m30-pullback-unfiltered | -0.03 | -0.11 | [-2.004, 1.713] |
| completion-2022-aug | m30-pullback-long − m30-pullback-trend | +0.60 | +0.75 | [-5.219, 8.792] |
| completion-2022-aug | m30-pullback-staged − m30-pullback-trend | -0.13 | +0.06 | [-2.022, 1.337] |
| completion-2022-aug | m30-kdj-trend − m30-kdj-unfiltered | -2.38 | +0.37 | [-16.839, 0.966] |
| completion-2022-aug | m30-kdj-long − m30-kdj-trend | +0.15 | +0.37 | [-2.137, 2.664] |
| completion-2022-aug | m30-kdj-staged − m30-kdj-trend | +0.34 | -0.23 | [-1.900, 4.688] |
| completion-2022-aug | m30-pa-key − m30-pa-base | +1.58 | +1.15 | [-1.276, 10.520] |
| completion-2022-aug | m30-pa-legs − m30-pa-base | +1.22 | +1.22 | [-4.353, 10.199] |
| completion-2022-aug | m30-pa-key-legs − m30-pa-base | +1.31 | +1.29 | [-4.353, 10.805] |

## 证据与复核

计划 SHA-256：`f6db2c3a71c08fbed0a7a6c2b6f7f1538fbf40d29180aafab216e766f2b62594`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`0a2fd14d934a6d3305fb4b08cfa83864c1f6f4ce20d6ba0db4a7cd4f5a2da768`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

未声明结构化接受条件；本报告仅描述结果。

- All history and some controls previously inspected;32declaredtrials addto accumulated search. This maxdiagnostic onlyadjusts current32x2family, not priorstagesorhuman hypothesis selection.
- Only32 prespecified module recipes, not allpossible strategies. MAfilters are not MAentry; KDJunfiltered isnot failure-breakout. No vol-breakout/MAcrossover/neworder-types/live/paperdeployment claim.
- Choosing32rules on one knowntrainperiod canoverfit; trainingqualification cannotbe inferredfrombettervalidationcandidate. Cashfallback wouldrequire separate tradingpolicy; thisstudydoesnot invent cash-selecteddeployments.
- MinuteOHLClimits gap/queue/liquidity/partialfill/liquidation realism. Costs arefixed5+2or10+4bpsper-side; actualfundingstillconsumed. Historicalfees/precisionmaydiffer.
- Shared sixcoin correlation andlongbiasedcrypto market are not independentcross-asset evidence. PortfolioMDDdailyclose excludesintradaypeak/trough.
- Independentwindow capitalstatescannotbechained; onlythe760day accountiscontinuous. Calendar slicesreconcile tosingleNAV andcannotbe usedtochoosefavorableenddates.
- No ensemble constructedby averagingfull60000accounts. Anyfuturecombinedpolicy requiresactualallocatedcapitalreplay andnewfrozenprotocol.
- Blockbootstrapstationarity assumptions andfixedstrata arelimitations; per-rowpointwiseCIarenotselection-adjusted andcurrentfamilymaxpdoesnotprovefutureedge.
