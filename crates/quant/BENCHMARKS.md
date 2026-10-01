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
BASE_URL='http://localhost:5201/?strategy=jsg' node scripts/benchmark-jsg.mjs \
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
