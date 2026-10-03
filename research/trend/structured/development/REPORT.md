# 30分钟结构回调研究

引擎：`trend-continuation-15`。事前固定主候选：`sp-primary`。基线：`sp-base`。

本报告审计已有运行并重新汇总账本，主候选由实验事前指定，不因结果改选；开发失败或样本不足即停止，不解锁后续单元。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。

计划冻结说明：编译计划的 compilation.json 绑定原 experiment.json；冻结时间以原实验为准。

开发期资格：样本不足。原因：too-few-trades:BTCUSDT, too-few-trades:ETHUSDT, too-few-trades:BNBUSDT。资格不构成统计显著性或样本外认证。

## 资金与执行口径

3 个独立固定子账户，总初始资金 30,000.00 USDT，每个子账户 10,000.00 USDT。资金模式：`total-account-equal-sleeves`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。

品种：BTCUSDT, ETHUSDT, BNBUSDT。单边手续费 5 bps，滑点 2 bps；压力情形分别为 10 与 4 bps。收益扣除手续费、模拟滑点和历史资金费。

每笔子账户风险 0.50%，名义敞口上限 95.00%。各研究窗口独立开始，不拼接为连续实盘净值。

冻结选择规则：Predeclared sp-primary; ablations diagnose mechanisms and can never replace the primary.

统计采用 2000 次、7 天循环块重采样，种子 20261003。区间未校正候选选择偏差。

## 研究窗口

| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |
|---|---|---|---|---:|
| development | development | 2022-09-01 | 2024-01-01 | 487 |

## 全部声明候选的净收益

| 规则 | development |
|---|---:|
| sp-primary | -0.17% |
| sp-no-key | -2.36% |
| sp-no-shape | -1.43% |
| sp-no-ema | -0.17% |
| sp-reversal | 0.00% |
| sp-base | -5.31% |

<details>
<summary>全部方案交易质量与成本压力</summary>

基础、成本压力和计划中的其他对照逐行保留。净 PF 与单笔期望已包含成本；零交易的指标显示为 —。

| 区间 | 方案 | 成本情景 | 净收益 | 笔数 | 净 PF | 单笔净期望 USDT | 平均净 R |
|---|---|---|---:|---:|---:|---:|---:|
| development | sp-primary | base | -0.17% | 1 | 0 | -50.632 | -1.133 |
| development | sp-no-key | base | -2.36% | 15 | 0 | -47.192 | -1.062 |
| development | sp-no-shape | base | -1.43% | 27 | 0.3611 | -15.876 | -0.345 |
| development | sp-no-ema | base | -0.17% | 1 | 0 | -50.632 | -1.133 |
| development | sp-reversal | base | 0.00% | 0 | — | — | — |
| development | sp-base | base | -5.31% | 249 | 0.7604 | -6.399 | -0.156 |

</details>

## 冻结选择的账户表现

| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | -0.17% | -1.225 | -0.17% | 1 | 0/3 | 4.41 | 0.65 |

合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。

| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| development | -0.13% | 0.10% | -1.224 | -0.750 | -0.09% | 184.000 | 184.000 |

最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。

| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |
|---|---:|---:|---:|---:|---:|---:|
| development | 4.41 | 0.65 | 1.78 | 6.84 | -43.79 | -50.63 |

金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。

<details>
<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>

| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |
|---|---:|---:|---:|---:|---:|---:|---:|
| development / BTCUSDT | 0.00% | — | — | — | 0.00% | 0.000 | 0.00 |
| development / ETHUSDT | 0.00% | — | — | — | 0.00% | 0.000 | 0.00 |
| development / BNBUSDT | -0.38% | -1.225 | -1.224 | -0.750 | -0.51% | 183.104 | 6.84 |

逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。

</details>

## 同风险预算的基线比较

| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |
|---|---:|---:|---:|---|
| development | -5.31% | -0.17% | — | [-0.549, 2.611] |

配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。

## 事前声明的机制比较

差值均为候选减参照；回撤用负数表示，因此回撤差为正表示日终最大回撤减轻。所有比较均照计划披露，不按结果重新选择。

| 区间 | 候选 − 参照 | 净收益差 pp | 日终回撤差 pp | 日均收益差 95% 配对区间 bps |
|---|---|---:|---:|---|
| development | sp-primary − sp-no-key | +2.19 | +2.19 | [0.222, 0.722] |
| development | sp-primary − sp-no-shape | +1.26 | +1.26 | [0.038, 0.518] |
| development | sp-primary − sp-no-ema | +0.00 | +0.00 | [0.000, 0.000] |
| development | sp-reversal − sp-primary | +0.17 | +0.17 | [0.000, 0.104] |

## 证据与复核

计划 SHA-256：`c47028848fc203b3a894609b3e7e4584387fa9369f5c852355fe95ab986c2cfa`。
评价版本：`trend-account-evaluation-2`，评价源码 SHA-256：`f150e1aa52fcda1248d2a71837267655f8aab6e2da5ea0192f07258bebb2f362`。

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
