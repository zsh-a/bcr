# 30分钟结构回调：确认时序与关键位职责对照

引擎：`trend-continuation-16`。事前固定主候选：`sp-context`。基线：`sp-base`。

本报告审计已有运行并重新汇总账本，主候选由实验事前指定，不因结果改选；开发失败或样本不足即停止，不解锁后续单元。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：编译计划的 compilation.json 绑定原 experiment.json；冻结时间以原实验为准。

开发期资格：未通过。原因：too-few-profitable-symbols。资格不构成统计显著性或样本外认证。

## 资金与执行口径

3 个独立固定子账户，总初始资金 30,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Predeclared sp-context only; sp-confirm-close is a separate mechanism diagnostic, never a fallback winner.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |
|---|---|---|---|---:|
| development | development | 2022-09-01 | 2024-01-01 | 487 |

## 全部声明候选的净收益

| 规则 | development |
|---|---:|
| sp-strict | -0.17% |
| sp-confirm-close | -0.17% |
| sp-retest | -1.43% |
| sp-context | -0.55% |
| sp-base | -5.31% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | sp-strict | base | -0.17% | 1 | 0 | -50.632 | -1.133 |
| development | sp-confirm-close | base | -0.17% | 1 | 0 | -50.632 | -1.133 |
| development | sp-retest | base | -1.43% | 27 | 0.3611 | -15.876 | -0.345 |
| development | sp-context | base | -0.55% | 176 | 0.9634 | -0.939 | -0.025 |
| development | sp-base | base | -5.31% | 249 | 0.7604 | -6.399 | -0.156 |

</details>

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | -0.55% | -0.117 | -2.09% | 176 | 1/3 | 783.19 | 25.98 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | -0.41% | 3.12% | -0.265 | -0.198 | -0.42% | 192.000 | 192.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| development | 783.19 | 25.98 | 328.48 | 1137.65 | 972.36 | -165.29 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development / BTCUSDT | 5.02% | 0.834 | 2.430 | 1.075 | -4.67% | 136.276 | 386.46 |
| development / ETHUSDT | -0.11% | -0.002 | -0.004 | -0.026 | -4.38% | 348.101 | 265.51 |
| development / BNBUSDT | -6.25% | -1.632 | -2.544 | -0.462 | -13.53% | 325.045 | 485.67 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development | -5.31% | -0.55% | — | [0.424, 1.606] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | sp-confirm-close − sp-strict | +0.00 | +0.00 | [0.000, 0.000] |
| development | sp-context − sp-retest | +0.88 | -0.66 | [-1.023, 1.527] |
| development | sp-context − sp-base | +4.76 | +3.57 | [0.424, 1.606] |

## 证据与复核

计划 SHA-256：`e3db8c415084f558e3244bfdfc4c29f65edb82026af6b248fd12260a6fc9301c`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`279afa724e729dce0df6d40013c0f51dd13d9a057f2caabcde10e5b9fb6e562c`。

results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。

本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。

## 原计划的接受条件与局限

Development requires source-domain activity qualification, positive base-cost account return and daily drawdown at most10%; only then unlock validation. Validation and holdout require all sample gates, positive net return and daily drawdown at most10% under base/stress, with both 7/28day absolute mean-return 95% lower bounds above zero. No fallback candidate or universe replacement.

以上为冻结计划 transferEvaluation 声明的接受条件。逐项判定由 study.py 的阶段凭证给出；开发单元仅检查开发门槛，验证与留出单元还须通过独立 transfer_evaluation.py。

- Current static execution filters; not point-in-time historical rules.
- Three surviving contracts per group are purposive, correlated market samples; no cross-asset-class independence.
- Minute OHLC uses fixed bps fills; no order book, queue, partial fills or live outage simulation.
- The fixed 3bar impulse and pivot-based pattern definitions are research hypotheses, not a full reconstruction of discretionary Brooks price action.
- No volume-profile ownership/cost-basis inference from OHLCV. H2/H3 discretionary setup counting is not interchangeable with confirmed pivot legs.
- This is the second adaptive development round on these observations. Prior failed strategies and six v1 rules remain evidence; new registration does not reset total multiple-testing exposure.
- Independent opportunity records use the shared detector and original EMA cancellation rules, but do not inherit portfolio holdings, cooldown or risk rejections. They are not executed account returns.
- Impulse context qualifies a previously known pivot crossed during the impulse or a pre-validated EMA on the correct side at the origin. Neither qualification requires another pullback retest; subsequent invalidation and signal-side requirements remain.
- Timing variant only confirms an older pivot using the completed signal candle; it does not confirm the signal candle as a pivot, backfill old signals or change fills.
