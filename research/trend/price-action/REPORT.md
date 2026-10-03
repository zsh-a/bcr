# 价格行为回调：关键位与两腿条件的固定机制消融

引擎：`trend-continuation-13`。事前固定主候选：`pa-key-two-legs`。基线：`pa-base`。

本报告审计已有运行并重新汇总账本，主候选由计划事前指定；开发期只评价资格，样本不足或失败都不替换候选，后续继续预定的历史诊断。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：2026-10-03; this protocol is fixed before any result from this price-action study is generated or inspected. Every historical window was already used in earlier research.。

开发期资格：样本不足。原因：too-few-trades:BTCUSDT, too-few-trades:ETHUSDT, too-few-trades:BNBUSDT, too-few-trades:SOLUSDT, too-few-trades:XRPUSDT, too-few-trades:DOGEUSDT。资格不构成统计显著性或样本外认证。

## 资金与执行口径

6 个独立固定子账户，总初始资金 60,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：The primary candidate pa-key-two-legs is fixed in this plan before all results. Never rank or substitute candidates. Development qualification is insufficient-sample if any symbol has fewer than ten completed trades or the window has fewer than thirty complete UTC days. With sufficient observations, require defined finite aggregate daily Sharpe, at least four profitable symbols, and positive finite median symbol mean net R; otherwise status is failed. Preserve developmentQualified=false for both insufficient-sample and failed. Run every later predeclared diagnostic regardless of this status; sample adequacy is descriptive and is not a statistical-significance claim.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID                         | 声明身份              | 开始日期   | 结束日期（不含） | 日样本数 |
| -------------------------- | --------------------- | ---------- | ---------------- | -------: |
| development-2025           | development           | 2025-01-01 | 2026-01-01       |      365 |
| validation-2026-h1         | diagnostic-validation | 2026-01-01 | 2026-07-01       |      181 |
| historical-holdout-2026-q3 | diagnostic-holdout    | 2026-07-01 | 2026-10-01       |       92 |

## 全部声明候选的净收益

| 规则            | 开发期 · 已查看历史 | 验证期 · 已查看历史 | 最终历史留出 · 已查看历史 |
| --------------- | ------------------: | ------------------: | ------------------------: |
| legacy-pullback |             -70.21% |             -48.95% |                   -29.60% |
| pa-base         |             -55.81% |             -34.96% |                   -20.00% |
| pa-key          |              -9.42% |              -3.02% |                    -1.48% |
| pa-two-legs     |              -3.05% |              -1.29% |                    -0.52% |
| pa-key-two-legs |              -0.26% |               0.03% |                     0.00% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间                       | 方案                   | 成本情景 |  净收益 | 笔数 |     净 PF | 单笔净期望 USDT | 平均净 R |
| -------------------------- | ---------------------- | -------- | ------: | ---: | --------: | --------------: | -------: |
| development-2025           | legacy-pullback        | base     | -70.21% | 7210 |    0.6086 |          -5.842 |   -0.347 |
| development-2025           | pa-base                | base     | -55.81% | 4743 |    0.5968 |          -7.060 |   -0.354 |
| development-2025           | pa-key                 | base     |  -9.42% |  338 |    0.4217 |         -16.722 |   -0.514 |
| development-2025           | pa-two-legs            | base     |  -3.05% |   90 |    0.2906 |         -20.322 |   -0.690 |
| development-2025           | pa-key-two-legs        | base     |  -0.26% |    5 | 0.0001007 |         -30.819 |   -1.140 |
| validation-2026-h1         | legacy-pullback        | base     | -48.95% | 3231 |    0.5462 |          -9.090 |   -0.430 |
| validation-2026-h1         | pa-base                | base     | -34.96% | 2090 |    0.5571 |         -10.037 |   -0.426 |
| validation-2026-h1         | pa-key                 | base     |  -3.02% |  135 |     0.483 |         -13.411 |   -0.455 |
| validation-2026-h1         | pa-two-legs            | base     |  -1.29% |   40 |    0.3195 |         -19.324 |   -0.646 |
| validation-2026-h1         | pa-key-two-legs        | base     |   0.03% |    2 |     1.802 |           9.672 |   -0.442 |
| validation-2026-h1         | pa-key-two-legs-stress | stress   |  -0.01% |    2 |    0.8459 |          -2.726 |   -0.995 |
| validation-2026-h1         | pa-base-stress         | stress   | -52.52% | 2111 |    0.3279 |         -14.926 |   -0.822 |
| historical-holdout-2026-q3 | legacy-pullback        | base     | -29.60% | 1623 |    0.4748 |         -10.943 |   -0.519 |
| historical-holdout-2026-q3 | pa-base                | base     | -20.00% | 1001 |    0.4684 |         -11.990 |   -0.525 |
| historical-holdout-2026-q3 | pa-key                 | base     |  -1.48% |   64 |    0.5049 |         -13.867 |   -0.650 |
| historical-holdout-2026-q3 | pa-two-legs            | base     |  -0.52% |   31 |    0.5705 |         -10.112 |   -0.349 |
| historical-holdout-2026-q3 | pa-key-two-legs        | base     |   0.00% |    0 |         — |               — |        — |
| historical-holdout-2026-q3 | pa-key-two-legs-stress | stress   |   0.00% |    0 |         — |               — |        — |
| historical-holdout-2026-q3 | pa-base-stress         | stress   | -33.70% | 1025 |    0.1924 |         -19.726 |   -1.100 |

</details>

## 冻结选择的账户表现

| 区间                       | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
| -------------------------- | -----: | ------------: | ---------: | ---: | -------: | ----------: | ----------------: |
| development-2025           | -0.26% |        -1.933 |     -0.26% |    5 |      0/6 |       39.14 |              0.94 |
| validation-2026-h1         |  0.03% |         0.552 |     -0.04% |    2 |      1/6 |       15.86 |              0.00 |
| historical-holdout-2026-q3 |  0.00% |             — |      0.00% |    0 |      0/6 |        0.00 |              0.00 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间                       | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
| -------------------------- | --------: | -------: | ------: | ----------: | -----: | ---------------: | -------------: |
| development-2025           |    -0.26% |    0.13% |  -1.926 |      -1.000 | -0.08% |          315.000 |        315.000 |
| validation-2026-h1         |     0.07% |    0.12% |   1.140 |       1.618 | -0.04% |           31.000 |          0.000 |
| historical-holdout-2026-q3 |     0.00% |    0.00% |       — |           — |  0.00% |            0.000 |          0.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间                       | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 |  净盈亏 |
| -------------------------- | -----: | -----------: | ---------: | -----: | ---------: | ------: |
| development-2025           |  39.14 |         0.94 |      15.81 |  55.89 |     -98.20 | -154.09 |
| validation-2026-h1         |  15.86 |         0.00 |       6.64 |  22.50 |      41.84 |   19.34 |
| historical-holdout-2026-q3 |   0.00 |         0.00 |       0.00 |   0.00 |       0.00 |    0.00 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种                           |   CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
| ------------------------------------- | -----: | --------: | ------: | -----: | -----------: | -----------: | ----------: |
| development-2025 / BTCUSDT            | -0.76% |    -1.354 |  -1.353 | -0.766 |       -0.99% |      314.476 |       33.08 |
| development-2025 / ETHUSDT            |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| development-2025 / BNBUSDT            | -0.29% |    -1.000 |  -1.000 | -0.721 |       -0.40% |       19.528 |       13.36 |
| development-2025 / SOLUSDT            | -0.49% |    -1.000 |  -1.000 | -1.000 |       -0.49% |       52.858 |        9.45 |
| development-2025 / XRPUSDT            |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| development-2025 / DOGEUSDT           |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| validation-2026-h1 / BTCUSDT          |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| validation-2026-h1 / ETHUSDT          |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| validation-2026-h1 / BNBUSDT          | -0.49% |    -1.420 |  -1.420 | -2.014 |       -0.24% |       51.997 |       13.45 |
| validation-2026-h1 / SOLUSDT          |  0.88% |     1.420 |       — |  1.261 |       -0.70% |       21.965 |        9.05 |
| validation-2026-h1 / XRPUSDT          |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| validation-2026-h1 / DOGEUSDT         |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| historical-holdout-2026-q3 / BTCUSDT  |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| historical-holdout-2026-q3 / ETHUSDT  |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| historical-holdout-2026-q3 / BNBUSDT  |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| historical-holdout-2026-q3 / SOLUSDT  |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| historical-holdout-2026-q3 / XRPUSDT  |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |
| historical-holdout-2026-q3 / DOGEUSDT |  0.00% |         — |       — |      — |        0.00% |        0.000 |        0.00 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间                       | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
| -------------------------- | ---------: | ---------: | -----------: | --------------------------- |
| development-2025           |    -55.81% |     -0.26% |            — | [17.139, 26.889]            |
| validation-2026-h1         |    -34.96% |      0.03% |       -0.01% | [14.765, 30.831]            |
| historical-holdout-2026-q3 |    -20.00% |      0.00% |        0.00% | [14.976, 32.447]            |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间                       | 候选 − 参照                   | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
| -------------------------- | ----------------------------- | ----------: | ------------: | --------------------------- |
| development-2025           | pa-key − pa-base              |      +46.39 |        +46.81 | [14.480, 24.049]            |
| development-2025           | pa-two-legs − pa-base         |      +52.76 |        +53.21 | [16.300, 26.161]            |
| development-2025           | pa-key-two-legs − pa-key      |       +9.16 |         +9.20 | [1.762, 3.505]              |
| development-2025           | pa-key-two-legs − pa-two-legs |       +2.79 |         +2.79 | [0.344, 1.193]              |
| validation-2026-h1         | pa-key − pa-base              |      +31.95 |        +31.86 | [13.019, 29.217]            |
| validation-2026-h1         | pa-two-legs − pa-base         |      +33.67 |        +33.62 | [14.038, 30.213]            |
| validation-2026-h1         | pa-key-two-legs − pa-key      |       +3.05 |         +3.08 | [0.982, 2.481]              |
| validation-2026-h1         | pa-key-two-legs − pa-two-legs |       +1.32 |         +1.33 | [0.284, 1.183]              |
| historical-holdout-2026-q3 | pa-key − pa-base              |      +18.52 |        +18.52 | [14.588, 29.967]            |
| historical-holdout-2026-q3 | pa-two-legs − pa-base         |      +19.48 |        +19.42 | [14.543, 31.885]            |
| historical-holdout-2026-q3 | pa-key-two-legs − pa-key      |       +1.48 |         +1.48 | [-0.120, 3.121]             |
| historical-holdout-2026-q3 | pa-key-two-legs − pa-two-legs |       +0.52 |         +0.58 | [-0.219, 1.355]             |

## 证据与复核

计划 SHA-256：`2954e3c02fe0199bf07fec10193063a6b2f05dc6f2ca1419d7780739c87ebd8e`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`bc80b3d4878ec5f32d6011c024fb035fd731c9cdd170ae5c7298bbe0bd0b2026`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

Always report the fixed primary's development qualification, every candidate and every declared comparison. Both later diagnostic windows must have positive primary net returns and positive primary returns after doubling fees and slippage before describing robustness within this reused historical sample. Report returns, daily drawdown, completed trades, net profit factor, net trade expectancy and cost attribution, plus all four paired daily-return block-bootstrap comparisons regardless of sign. Primary-versus-base changes two mechanisms. Keep legacy-pullback as an overall reference. Failure or insufficient observations never changes the primary, candidates, thresholds or dates and never triggers additional searching. No strategy is established by these reused historical observations.

- Every date range was inspected in earlier research. The final historical holdout is only a frozen split for this comparison, not untouched OOS or prospective evidence.
- The primary is specified before this experiment, but this is another disclosed research trial after prior studies. Neither preregistration nor block-bootstrap intervals remove historical reuse or multiple-comparison effects.
- Only five fixed candidates are tested. No stop sensitivity, period search, threshold optimization or post-result fallback is permitted. Later cost stress applies only to the predeclared primary and pa-base.
- Two-leg and key-level recognition are causal mechanical proxies with fixed tolerance and lifetime; results do not validate or invalidate all discretionary Brooks price-action methods.
- The old pullback reference differs in multiple detector and lifecycle rules. Four mechanism comparisons share risk and exit settings but can still produce different future position and risk states.
- Six surviving liquid USDT perpetuals are not a point-in-time universe and are not six independent asset classes.
- Fixed precision and fee/slippage assumptions are not historical exchange filters or an order-book execution model.
- Minute OHLC cannot establish intraminute high/low ordering, queue priority, partial fills, liquidation or real live-stop execution.
- Six fixed 10000-USDT sleeves sum to 60000 USDT; no shared margin, netting or capital transfers.
- Per-sleeve Calmar uses minute/fill drawdown; aggregate account Calmar uses daily-close drawdown. Costs already embedded in equity are never deducted again.
- Binance USDT perpetual minute data and funding do not validate crude-oil contract multipliers, session calendars, expiration/roll, margin/liquidation or live order execution. Those markets require their own data and execution rules.
