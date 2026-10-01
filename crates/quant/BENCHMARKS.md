# JSG 大数据基准

基准输入和报告应存放在 worktree 外，避免清理已合并分支时一起删除。
生成器只写新目录，逐片生成 Arrow，并在所有文件及 SHA-256 清单写完后发布 manifest。

## 复现

```sh
bun install --frozen-lockfile
bun run build:wasm
cargo build --release --manifest-path crates/quant/Cargo.toml --bin jsg
# 先建立父目录；以下子目录必须不存在。
mkdir -p /tmp/bcr-research-benchmarks
bun scripts/generate-jsg-fixture.ts /tmp/bcr-research-benchmarks/input 5000 1250 20
python scripts/benchmark-jsg.py /tmp/bcr-research-benchmarks/input/manifest.json \
  --binary crates/quant/target/release/jsg --output /tmp/bcr-research-benchmarks/native
# 在另一个终端启动 bun run quant，使用其实际端口。
BASE_URL='http://localhost:5201/' node scripts/benchmark-jsg.mjs \
  /tmp/bcr-research-benchmarks/input /tmp/bcr-research-benchmarks/browser
node scripts/verify-jsg-parity.mjs /tmp/bcr-research-benchmarks/native/single.jsonl \
  /tmp/bcr-research-benchmarks/browser/result.json
```

测量时应停止其他测试和构建。浏览器基准每次创建独立 profile，首轮不会命中之前的
回测缓存；后续步骤专门验证缓存复用、完整导出、查询、50 行分页及取消后保留结果。
报告写入 `statistics.json`，完整浏览器结果写入 `result.json`。profile 包含本地研究数据，
用于需要时继续检查；不再需要时可删除该次报告目录中的 `profile-*` 子目录。

生成器支持 32–20,000 只证券、60–20,000 个会话和 1–20 日分片；单片超过 32 MiB 时
拒绝生成，应减小分片天数。使用合成工作日日历和可变价格/股本，不代表交易所历史行情。

## 2026-10-01 实测

环境：Linux，Intel Core i7-13700K（本环境提供 16 个逻辑 CPU），Bun 1.3.14、
Node 26.10.0、Playwright Chromium。原生为 release 构建。OS 页缓存未清空。

输入：5,000 只证券 × 1,250 会话，**6,250,000 行、501,073,424 字节（477.86 MiB）**，
63 个 Arrow 分片。30 个会话预热后有 1,220 个回测日、2,557 笔成交、244 次调仓。
manifest SHA-256：`b3d43842b80dbf9858b5579946e0d3a28f154a532b485227becf8595cc05aac5`。

| 操作                                 | 优化前浏览器基线 | 本轮最终浏览器 |
| ------------------------------------ | ---------------: | -------------: |
| 导入                                 |         3,795 ms |       2,807 ms |
| 回测（含提交、读取、计算及结果落盘） |         2,283 ms |       2,175 ms |
| 完整 JSON 导出                       |         1,699 ms |       1,709 ms |
| 打开成交页                           |           348 ms |         320 ms |
| 证券筛选                             |           820 ms |         820 ms |
| 相同参数缓存复用                     |           347 ms |         405 ms |
| 点击取消至任务结束                   |            80 ms |          73 ms |

最终 Worker 回测共 1,998 ms，其中读取 548 ms、Rust 解码/推进/结果排出 618 ms、
结果块写盘 788 ms；其余为调度及 JavaScript 处理。计时在最后的汇总文件写入前结束，
该汇总文件写入不计入 `writeMs`。图表精确日期查询约 18 ms，使用已经预热的结果 Worker
缓存。旧图表基准没有等待对应日期的新值，因此不作为前后比较。

原生单参数回测 3 次为 1,518 / 1,243 / 1,180 ms，**中位数 1,243 ms**，
进程峰值 RSS 18.26 MiB。包含快照 SHA-256 校验、文件读取和 JSONL 序列化。

浏览器用 Long Tasks API 观察主线程：最终导入、回测、导出、精确日期查询、成交查询、
证券筛选、分页、取消各阶段均未记录到 ≥50 ms 的长任务；启动记录到 128 ms，
缓存复用记录到 50 ms。只能说明此负载的测量结果，不能保证任意规模下的响应时间。

本轮没有证明整体耗时或内存大幅降低。证券筛选耗时基本不变，包含 UI debounce、
Playwright 操作和等待；它不是纯查询内核耗时。主页面 heap + backing storage 采样峰值
从约 216 MiB 变为 247 MiB，Chromium 进程树 RSS 峰值从约 867 MiB 变为 930 MiB。
最终浏览器 RSS 基线约 642 MiB；RSS 每 50 ms 采样，包含浏览器、渲染器和 Worker，
共享页按进程重复计数。主页面指标不包含所有 Worker WASM 内存，不应解释为应用独占
内存。结果 Worker 的缓存以序列化文件大小限制为 8 MiB / 64 块，解析对象本身会更大。

完整原生 JSONL 与最终浏览器 JSON 逐项一致：全部净值、成交、调仓、持仓、
应收、挂单、警告和统计字段相同。最终权益为 2,468,055.854520044，累计费用为
28,899.699892259996。对账只排除浏览器特有的耗时字段。

原始测量摘要已收录于 [research-scale-2026-10-01.json](fixtures/benchmarks/research-scale-2026-10-01.json)。
测试输入与完整报告保存在本机 worktree 外：
`/home/zs/workspace/bcr-research-fixture-5000-1250` 和
`/home/zs/workspace/bcr-research-benchmarks`。这些大文件及浏览器 profile 不加入 Git。

## 数据获取与清理验收

```sh
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:storage
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:fixture
# 可选：显式指定的只读 ClickHouse 测试库。
BASE_URL=http://localhost:5201/ CLICKHOUSE_TEST_URL=http://localhost:8123/ \
  bun run test:browser:jsg:clickhouse
```

HTTP fixture 不启动数据库，也不解释 SQL，仅提供固定元数据和真实 ArrowStream，
覆盖 144 个回测日及重叠区间分片复用、无网络缓存、刷新失败、取消、恢复和密码生命周期。
生产构建的 Studio `/quant` 路由也通过该验收。ClickHouse SQL 的时间关联语义由已有隔离
原生集成测试负责；本轮另在本机真实 `stock_data` 上通过 60 个交易日的同一浏览器流程。

清理验收移除旧运行，回收其结果和任务/缓存记录，验证共享输入、剩余运行的完整导出、
其他 Quant 应用文件仍可使用；启动会删除中断的 JSG 临时传输文件，并回收超过 60 秒
下载缓冲期的导出文件。清理预览中的引用、
大小和候选文件在执行时重新核对，当前查询和导出通过共享文件锁与清理互斥。

## 浏览器参数网格

同一 625 万行输入，使用目标股票数 `4, 6, 8, 10` × 个股止损 `0, 3, 5, 8%`，
共 16 个独立账户。浏览器只读取/解码一次行情、共享市场特征，输出每组的配置和指标；
完整净值、订单及调仓在查看某组详情时单独生成。浏览器使用一个 Worker 和一个 CPU 线程。

```sh
# 使用上文已生成的 input，在另一个终端启动 bun run quant。
BASE_URL='http://localhost:5201/' node scripts/benchmark-jsg-grid.mjs \
  /tmp/bcr-research-benchmarks/input /tmp/bcr-research-benchmarks/browser-grid
python scripts/benchmark-jsg.py /tmp/bcr-research-benchmarks/input/manifest.json \
  --binary crates/quant/target/release/jsg \
  --configs /tmp/bcr-research-benchmarks/browser-grid/configs.json \
  --output /tmp/bcr-research-benchmarks/native-grid
node scripts/verify-jsg-grid-parity.mjs /tmp/bcr-research-benchmarks/native-grid/grid-1.jsonl \
  /tmp/bcr-research-benchmarks/browser-grid/grid.json
node scripts/verify-jsg-grid-parity.mjs /tmp/bcr-research-benchmarks/native-grid/grid-8.jsonl \
  /tmp/bcr-research-benchmarks/browser-grid/grid.json
```

| 操作                                             |        2026-10-01 实测 |
| ------------------------------------------------ | ---------------------: |
| 浏览器 16 组实验（含提交、读取、计算及发布指标） |               4,952 ms |
| Worker 总计 / 读取 / 计算                        | 4,601 / 635 / 3,874 ms |
| 相同网格缓存复用                                 |                 390 ms |
| 64 组任务点击取消至结束                          |                 170 ms |
| 原生 16 组、1 线程，3 次中位数                   |               3,389 ms |
| 原生 16 组、8 线程，3 次中位数                   |               1,544 ms |

原生 1 线程峰值 RSS 19.07–19.20 MiB，8 线程 28.64–29.26 MiB；同轮单参数原生
中位数 1,209 ms、RSS 18.55 MiB。原生网格包含快照 SHA-256 校验及指标 JSON 写出。
1/8 线程的配置、行数和全部指标相同。浏览器与原生配置逐项一致，除 3 组年化收益
最多相差 `2.220446049250313e-16` 外，其余所有指标相同。原生 `powf` 与 WASM
幂运算的浮点舍入不同，对账脚本仅对年化收益允许 `1e-12 × max(1, |原生值|)` 误差。
同一 WASM 内网格与独立单组回测的全部指标严格一致，包含 raw-v2 的部分成交、分期费用和公司行为。

网格计算阶段未观测到 ≥50 ms 的主线程长任务。本轮没有测量浏览器内存；不能据此
宣称浏览器峰值内存下降。浏览器是单次观测，OS 页缓存已预热，墙钟时间包含 UI/自动化等待。
网格只生成指标，单参数基准还生成完整历史，因此不能把两者耗时直接当作性能倍率。

机器可读摘要见 [browser-grid-2026-10-01.json](fixtures/benchmarks/browser-grid-2026-10-01.json)。
完整报告位于 worktree 外的 `/home/zs/workspace/bcr-research-benchmarks/grid-16` 与
`grid-16-native`；`grid.json` 为首轮实验，`configs.json` 为相同配置的原生对账输入。

## 完整结果研究评估

```sh
BASE_URL='http://localhost:5201/' node scripts/benchmark-jsg-evaluation.mjs \
  /tmp/bcr-research-benchmarks/input /tmp/bcr-research-benchmarks/evaluation
```

2026-10-01，在同一 625 万行冻结输入上先生成完整回测结果，再在 Studio 生产 `/quant`
打开分析页。1,220 个交易日、57 个月的分析约 **739 ms**，包含 UI 自动化操作、完整结果
分片读取、指标计算与渲染等待；不包含此前导入和回测耗时，也不是纯计算内核耗时。
该阶段未观测到 ≥50 ms 主线程长任务。图表返回 1,040 个采样点（上限 3,072），表格
首屏 24 期，下一页验证分页。所有统计使用完整日线结果，采样只影响曲线展示。

月度收益复利与累计收益对账通过。独立重算原生完整 JSONL 后，57 个月、5 个年度的
日期、日数和收益均一致，累计指标最大数值差为 0。源码单元测试另验证跨年/跨月、初始本金、样本方差、
精确基准日历、缺失数据拒绝与独立 Rust/WASM 统计一致性。测量为预热环境的单次观测，
本轮没有测量浏览器内存。摘要见
[research-evaluation-2026-10-01.json](fixtures/benchmarks/research-evaluation-2026-10-01.json)，
完整报告和独立浏览器 profile 保存在 worktree 外的
`/home/zs/workspace/bcr-research-benchmarks/evaluation-1`。
