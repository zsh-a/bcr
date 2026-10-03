# Quant research engines

`bcr-quant` contains the daily JSG portfolio engine and the minute-based Binance
perpetual trend engine. Native CLIs (`jsg`, `trend`) and Quant Lab's WASM Worker
share their domain implementations. The trend engine's data, execution and research
contracts are documented in [Binance trend research](../../docs/BINANCE-TREND.md)
and [research architecture](../../docs/TREND-RESEARCH-ARCHITECTURE.md).

The following sections describe the daily JSG workflow migrated from quent:
20-bar industry breadth, profitability/ST filters, smallest market-cap targets,
weekly rebalance, limit-up opening exits, and optional portfolio/position stops.

Snapshots can include optional `displayNames` dictionaries for instruments and
industries. Browser and native exports read `stock_daily_meta.name` and
`industry_info.industry_name` (or the older `industry` column), choosing the latest
nonblank record with deterministic tie breaks. These are current display labels,
not historical trading inputs: codes, ordering, blacklists and calculations retain
their original identities. Tables, heatmap tooltips, Chinese-name searches, CSV
and HTML reports use the same dictionaries. Existing browser snapshots can fetch
names independently and keep one source-scoped local metadata record, without
redownloading Arrow or replaying the engine; the original artifact hashes stay
unchanged. Missing names keep their codes, and “更新名称” retries name-only reads.
Browser name reads skip malformed optional source labels individually, so a corrupt
ETF name (such as a serialized multiline Python object) cannot suppress valid stock
or sector names. Strict validation of imported snapshot dictionaries and ambiguous
duplicate source codes is retained. Refreshes preserve previously cached valid
labels if the source omits them; neither enrichment nor refresh requires a replay.

## Research diagnostics and validation

The single-run engine now emits input diagnostics and daily research observations.
In the workbench, the data-quality badge shows covered sessions, warmup, source
freshness at acquisition, universe coverage and observed financial/industry gaps.
Universe coverage is observed rows / (instruments × active sessions); an absent
pre-listing or post-delisting row is not automatically a missing-data error. A
nonpositive profit observation is not automatically a missing financial report.
PIT capability labels are snapshot declarations; diagnostics cannot create absent
membership history, financial revisions or corporate-action events.

The ledger uses actual fills, not matched buy/sell pairs: per-code net profit is
net trading/distribution cashflow + marked value + distribution receivables.
Fees are included, and slippage is already in execution prices. Unrealized profit
uses weighted acquisition cost including buy fees, redistributed over bonus shares;
cash distributions accrue as realized income and do not reduce acquisition cost.
Realized profit is net profit minus unrealized profit; the strategy's existing
distribution-adjusted risk cost remains unchanged. The adjusted research model retains adjusted
price units. Daily cash + holdings + receivables and daily P&L are reconciled;
stale holding marks retain their actual last observation date. Sector contribution
accumulates daily P&L under that day's sector, while exposure uses closing value.
CSV exports the complete per-code ledger; the escaped, standalone HTML report can
be printed to PDF. Drawdown episodes and 63-session return/volatility/Sharpe use
the complete daily account history; the rolling display is bounded to 1,024 points.

Industry breadth is recorded every active day using the same MA20 history and
rounding as strategy signals. Historical heatmaps page through at most 63 sessions.
Rebalance explanations retain every selection-universe observation, market-cap
rank, filtering reason and tradability. Suspended securities remain candidates,
as in the original engine; their orders are subject to execution restrictions.

Quant Lab annotates closing equity with daily execution summaries and optional
decision/rejection events. Signals retain their original dates; buy/sell arrows
use actual fill dates and quantities, including partial fills. A linked inspector
opens frozen-snapshot candles and the day's complete paginated order records.
The Rust `snapshot_bars` export reads one instrument's raw OHLC, adjustment factor,
optional volume and tradability from bounded Arrow partitions. It does not replay
the portfolio or fetch current prices. Validated replay records input partition
date bounds; the default candle window reads only intersecting partitions around
the selected session. Year/all views expand on demand. Adjusted-v1 execution prices are already
in snapshot-adjusted units; raw-v2 prices are raw. Axis switches transform candles
and fill markers together while order details retain original execution prices.
Same-day fills are grouped by direction at quantity-weighted prices. Large views
group annotations, retain exact representative closing values and expand on zoom.
Blocked rebalance annotations come from recorded `portfolio-stop` audit facts.
Daily inputs do not provide intraday execution timestamps.

Parameter experiments provide a two-axis sensitivity map; additional dimensions
are fixed by explicit filters. Robustness validation works against the already
frozen dataset. Holdout splits by chronological trading sessions; rolling tests
follow trailing training windows, never overlap and include only complete test
windows. Selection uses only training metrics, with input order breaking ties.
Each train/test portfolio starts from equal capital and no holdings; earlier
prices supply indicator warmup. Test returns are not concatenated as a continuous
portfolio. `researchWindow: {start: YYYYMMDD, end: YYYYMMDD}` is available to native
and WASM configs; later bars are validated but never mark the window's holdings.
Training combinations × folds are bounded to 64 and use shared Rust factors.
Cost pressure holds the draft parameters fixed and scales commission, slippage,
dated commission, minimum commission, transfer fees and sell taxes by 0.5/1/2/3.

Browser research output drains daily and packs up to five sessions or 8 MiB per
file, with a hard 32 MiB file limit. Only result previews enter the main result;
full analysis uses the existing OPFS query Worker. Native large runs should use
`--jsonl`; retained research rows are bounded when streaming is disabled.
Completed validation and its data snapshot survive reload and are protected from
storage cleanup. Older runs without research observations can be replayed to
produce the ledger and diagnostics.

## Run

```sh
bun install --frozen-lockfile
bun run build:wasm
bun run quant
```

Open `http://localhost:5201/` or Studio’s `/quant` for the unified JSG workbench.
A deterministic 64-stock demo is supplied; click
“运行回测”. Import a `manifest.json` and **all** its `.arrow` files together to
use your own research snapshot. Results, parameters and source artifacts persist
locally; repeated identical jobs use BCR's existing content-addressed task cache.

## ClickHouse connection

The native exporter reads the existing quent tables (`stock_daily`, `trade_dates`,
`index_stocks`, `finicial_report`, `shares_info`, `industry_info`). It executes
read-only, parameterized HTTP queries; native credentials come from environment variables.
ClickHouse filters the universe/date range and computes financial/share/industry
ASOF joins. Price results travel as an ArrowStream; the exporter
reassembles complete days and writes bounded IPC streams, without accumulating the
whole price history. Native Rust is the primary adapter and backtest core. The
legacy Python adapter below remains useful for comparison; native commands appear
in the final section. Neither path requires an additional running backend service.

```sh
python3 -m venv tmp/jsg-export
# Windows users can activate the environment and call python/pip normally.
tmp/jsg-export/bin/pip install -r scripts/requirements-jsg.txt
export CLICKHOUSE_URL=http://localhost:8123/
export CLICKHOUSE_DATABASE=stock_data
export CLICKHOUSE_USER=default
# Set CLICKHOUSE_PASSWORD through your environment or secret manager.
tmp/jsg-export/bin/python scripts/export-jsg.py \
  --start 2024-01-02 --end 2024-12-31 --output tmp/jsg-2024
```

The default breadth index is `000985`, selection index `399101`, calendar warmup
30 sessions, and partition size 20 days. Use `--batch-days 5` if a partition would
exceed 32 MiB. Export to a new directory; publication of `manifest.json` happens
only after every expected session has been exported successfully. No connection
to the user's live database is needed to run the demo or tests.

The same input can run directly in native Rust, close to the data source:

```sh
cargo run --release --manifest-path crates/quant/Cargo.toml --bin jsg -- \
  tmp/jsg-2024/manifest.json > tmp/jsg-result.json
# Optional second argument: JSON config with the same fields as JsgConfig.
```

## Data contract

Manifest `version: 1`, `schema: "jsg-daily-v1"` declares the source, date range,
`universeMode` (`snapshot`, `historical`, `synthetic`), warnings, instruments,
industries, full ordered calendar and ordered partition descriptors (`file`,
`bytes`, `rows`). Dates are numeric YYYYMMDD. Instrument/industry IDs are zero-based
positions in the manifest arrays. `calendar` starts at warmup and ends at the last
backtest session. Its `rebalance` flags must be computed from the **full exchange
calendar**, including sessions after the requested end, to avoid a false week-end
at a truncated range. Empty or missing calendar days fail the backtest.

Each Arrow IPC **stream** contains one complete trading day per RecordBatch, with
rows sorted by unique instrument ID. A day cannot be split between partitions.
All required columns are non-null and have exactly these types:

| Type        | Columns                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| UInt32      | `date`, `id`, `industry`                                                    |
| Float64     | `open`, `high`, `low`, `close`, `preclose`, `adjfactor`, `profit`, `shares` |
| UInt8 (0/1) | `is_st`, `tradable`, `breadth_member`, `selection_member`                   |

Prices/preclose are unadjusted; `adjfactor` must be positive. Missing profit/share
observations use zero and are excluded from selection. Profit must be the latest
observation **published before** the current date; shares require both publication
and effective dates to have passed. Industry classification is effective as of
that day. The reserved `unknown` industry is excluded from breadth aggregation. The exporter enforces these temporal join policies, including seeding
from observations before warmup. A custom exporter is responsible for matching
the same availability policy. `historical` membership requires actual historical
entry/exit data; declaring a historical manifest alone cannot eliminate biases.

Imported files are hashed with the existing Rust BLAKE3 WASM kernel and copied
sequentially through BCR's streaming Artifact API. The Worker loads at most one 32 MiB partition; Rust reads one daily
batch at a time and keeps portfolio state plus 20 closes per instrument. It yields
between daily batches on a 16 ms time budget so cancellation can be delivered. Native Rust reads partitions with
a buffered file reader. Limits: 20,000 instruments, 20,000 calendar sessions,
200,000 retained order records (streaming drains them into bounded chunks). The Worker
reserves 256 MiB in the scheduler; this is a scheduling estimate rather than a
guarantee on measured browser memory. Native JSONL and browser artifacts stream
full histories; metrics are accumulated online and the UI loads order intervals on demand.

## Execution model and known limits

The compatibility model version is **`jsg-adjusted-v1`**, a research migration, not a
claim of byte-for-byte parity with quent or a complete exchange simulator.

- MA and theoretical execution use `raw price × adjfactor`, matching the original
  strategy's adjusted execution convention. Holdings are synthetic research
  units. Corporate actions are not interpreted as real share/cash events.
- Market cap and price-limit checks use raw prices/preclose. This corrects the
  original mixed-scale limit check. Limits use the manifest's fixed board ratio,
  or 5% for ST. Historical board changes/new-listing exemptions are not modeled.
- Weekly last-session signals fill at the next supplied session's open. Sells
  release cash before buys; ties use deterministic code/industry ordering. This
  is an explicit difference from quent's potentially interleaved order submission.
- 95% allocation, 100-unit lots, proportional commission and constant slippage;
  no minimum commission, stamp duty, volume participation or partial auction fills.
  Insufficient cash can reduce a purchase to affordable whole lots. Rejected
  next-open orders expire. Stop/limit-up-opening exits use that day's close.
- Optional T+1 defaults **off**, preserving quent's lack of settlement constraints.
  Daily equity is recorded **after** immediate-close fills, including their costs.
  Unfilled portfolio drawdown liquidations are retried on following sessions.
- Suspended/limit-blocked orders are logged. Missing held bars use the last mark
  and emit a result warning; they cannot fill orders. Terminal pending orders stay
  pending; no forced liquidation is performed.
- quent's `index_stocks` lacks exit intervals, so the supplied exporter declares
  **snapshot** membership and warns of survivorship bias. Financial tables use
  ReplacingMergeTree keys that may overwrite old revisions; a temporal join cannot
  restore revisions already lost from the source.
- The quent migration covers daily JSG. Binance perpetual research has a separate
  minute OHLC engine; arbitrary Python strategy loading, tick simulation and live
  trading remain outside these engines. Browser ClickHouse access is described below.

## Validation

```sh
bun run test:rust:quant
bun run test
bun run check
# Against the running standalone Quant Lab server:
bun run test:browser:jsg
bun run test:browser:jsg:storage
# Self-contained read-only HTTP/Arrow fixture; no ClickHouse server required:
bun run test:browser:jsg:fixture
# Export boundary tests, after installing PyArrow:
tmp/jsg-export/bin/python scripts/test_export_jsg.py
```

Tests exercise cash/fees, next-open vs close, limits, suspension, T+1, warmup,
missing marks, no lookahead in the core, Rust decoding of JS Arrow, identical full
results across 20-day versus single-day partitions, worker cancellation, content
identity and browser import/run/cache/configuration/reload/cancel/mobile flows.
The export SQL has also been exercised with an isolated local ClickHouse fixture;
production credentials and the user's live database are not part of validation.

Protocol references: [Arrow Rust StreamReader](https://docs.rs/arrow-ipc/60.0.0/arrow_ipc/reader/struct.StreamReader.html),
[ClickHouse ASOF JOIN](https://clickhouse.com/docs/reference/statements/select/join),
[ClickHouse ArrowStream](https://clickhouse.com/docs/reference/formats/Arrow/ArrowStream).

### Large-data baseline

Use [BENCHMARKS.md](BENCHMARKS.md) for the deterministic 6,250,000-row workload,
reproduction commands and measurement boundaries. It exercises 2,557 fills rather than
only a handful of orders, compares complete native/browser outputs and records read,
compute, artifact-write and browser-interaction timings. These measurements replace the
earlier low-fill synthetic throughput sample; neither run is a cold-storage benchmark.

## Native ClickHouse and raw-price v2

The primary snapshot exporter is now Rust. Python remains an optional reference/reconciliation tool.
See [RECONCILIATION.md](RECONCILIATION.md) for the real-data comparison, gaps and measured performance.

```sh
cargo build --release --manifest-path crates/quant/Cargo.toml --bin jsg
# Defaults: localhost:8123, default user, stock_data database.
# For another source set CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE.
crates/quant/target/release/jsg inspect
crates/quant/target/release/jsg export 2026-04-01 2026-06-30 /tmp/jsg-q2
crates/quant/target/release/jsg /tmp/jsg-q2/manifest.json --trace /tmp/jsg-audit.jsonl
crates/quant/target/release/jsg /tmp/jsg-q2/manifest.json --jsonl > /tmp/jsg-results.jsonl
# configs.json is an array of complete strategy configurations.
crates/quant/target/release/jsg grid /tmp/jsg-q2/manifest.json configs.json --threads 8
# Requires the optional source contracts AND audited coverage over the full warmup/range.
crates/quant/target/release/jsg export 2026-04-01 2026-06-30 /tmp/jsg-history --strict-pit
```

`inspect` reports source capabilities; `--strict-pit` fails on the current legacy schema.
The exporter executes fixed SELECT queries with typed parameters and `readonly=1`, streams compressed
Arrow from ClickHouse, writes uncompressed portable daily batches, and records source capabilities,
query timings and SHA-256 integrity hashes. The engine validates these hashes before native replay.
No Python process or additional backend is needed for export or backtesting.

V1 manifests remain valid. V2 uses `version:2`, `schema:"jsg-daily-v2"`, `dataQuality` and explicit
`corporateActions`. Daily batches additionally require `volume:UInt64`, `limit_up:Float64`,
`limit_down:Float64`; `(0,0)` means explicitly unlimited for that session. Corporate action fields
are `id`, `recordDate`, `exDate`, `payDate`, `shareAvailableDate`, `knownDate`, `cashPerShare`,
`withholdingPerShare`, `shareRatio` (additional shares per old share), `fractionalCashPrice`.
The raw model requires complete action coverage and daily limits. The new source SQL contract is
[sql/history-schema.sql](sql/history-schema.sql); the CLI never creates or mutates source tables.

Add these fields to the strategy configuration for raw v2 (rates here are explicit example values,
not a prescribed market fee schedule):

```json
{
  "executionModel": "jsg-raw-v2",
  "participation": 0.1,
  "fees": [
    {
      "from": 20200101,
      "commissionBps": 3,
      "minimumCommission": 5,
      "transferBps": 0.1,
      "sellTaxBps": 5
    }
  ]
}
```

`fees` is ordered by effective date; commission overrides are optional. Merge these fields into a
complete strategy config (available in an exported result's `config` field). This fragment is not a
standalone config. The UI exposes
model selection, participation and fee periods after importing a v2 snapshot.

To capture and replay the original quent implementation, use an environment containing quent's
original dependencies plus PyArrow. This tool intentionally imports that implementation unchanged:

```sh
python scripts/reconcile-jsg.py --quent /path/to/quent --manifest /tmp/jsg-q2/manifest.json \
  --output /tmp/jsg-reconciliation --capture --rust-trace /tmp/jsg-audit.jsonl
# Run again with --capture omitted: reads frozen queries only and verifies source/input hashes.
```

Reconciliation only needs Python for the reference run. The source project's settings govern reference
capture; run with its configured environment. The reduced real-price fixture and daily audit are checked
by `cargo test`. Native integration tests run an isolated embedded ClickHouse, never the user's database:

```sh
python -m pip install pyarrow==23.0.1 chdb==4.4.0
python scripts/test_export_jsg.py
python scripts/test_reconcile_jsg.py
python scripts/test_native_jsg.py
python scripts/benchmark-jsg.py /tmp/jsg-q2/manifest.json \
  --binary crates/quant/target/release/jsg --configs configs.json --output /tmp/jsg-bench
BASE_URL=http://localhost:5201/ node scripts/benchmark-jsg.mjs /tmp/jsg-q2 /tmp/jsg-browser
```

WASM/network dependencies are separated by compilation target. In native mode, credentials remain outside the browser. The optional direct mode keeps the entered
password in page/Worker memory and omits it from profiles, artifacts, cache keys and scheduler tasks. Native JSONL and browser artifacts stream full outputs; the UI loads one order
interval at a time and writes complete exports to a temporary OPFS file. Sampling affects only the chart
preview, while full result artifacts retain every event.

## Connect from the browser

Choose **JSG · 行业宽度轮动** in Quant Lab's strategy selector. Open **运行设置 → 数据与区间**,
select **ClickHouse**, enter an HTTP(S) endpoint, database, username and password, then click
**测试连接**. Set the dates in the same panel and click **使用设置运行**, or close it and click
**运行回测** in the toolbar. The browser fetches data and starts the same Rust/WASM portfolio engine.
No CLI export or application backend is required.

The default source is `http://localhost:8123/`, database `stock_data`, user `default`, empty password.
`localhost` refers to the computer running the browser. Connections, date ranges and the history-mode
choice persist as a profile; passwords stay in the current page session and are cleared on reload.

The database must support CORS for the page's origin, POST/OPTIONS and the
`X-ClickHouse-User` / `X-ClickHouse-Key` headers. Requests use `credentials: omit` and
`readonly=1`. When prompted by the browser, allow the site's local-network access for a local
endpoint. A small Window query triggers this permission before the data Worker fetches the snapshot.
Use an account with SELECT access to the required tables and permitted query/format settings;
server-side account grants enforce permissions. No database configuration or source data is modified.

The dedicated Worker queries the same fixed SQL compiled into Rust, streams bounded raw Arrow
responses into temporary OPFS files, and uses shared Rust normalization to reassemble complete daily
batches. Requests initially cover 20 sessions; oversized responses retry with shorter windows. Each
raw/normalized partition is limited to 32 MiB, and Arrow IPC buffer compression is explicitly disabled
for WASM compatibility. HTTP content compression may still be handled transparently by the browser.
Only small metadata uses JSON; market rows are never converted to JavaScript row objects.

A complete manifest and local snapshot index are published after all requested days validate. Loading
an identical source/range reuses the local snapshot without network requests, including when offline.
Overlapping ranges reuse validated daily partitions aligned to the source's full trading calendar;
partial boundary windows are loaded separately. Partition identities include the endpoint, database,
user, SQL, instrument/industry dictionaries, exact dates and a local source-generation marker.
Check **重新获取数据** to start a new generation and query updated source data; previous generations
remain available to retained runs. Old range caches are invalidated for future acquisition after a
successful refresh. Acquisition metadata is retained with each run and its JSON export; the compact
run summary exposes the acquisition timestamp and source coverage in its tooltip. Each snapshot
captures the original requested dates separately from the aligned trading dates, including cache reuse.

Generations govern local cache reuse. They do not freeze the database across multiple queries.
The source should keep historical inputs stable during acquisition; refresh when source history is revised.
Cancellation or a failed refresh removes the
new attempt's temporary files/artifacts and retains the previous complete snapshot and research result.
The browser's storage quota still limits how many full snapshots can be kept.

**严格历史数据** requires the optional source contracts and audited coverage, with the same
membership/revision/actions/limits checks as native export. The existing legacy source runs in snapshot
mode and does not acquire historical completeness through direct access.

```sh
bun run quant
# Optional integration check against an explicit read-only test source:
BASE_URL=http://localhost:5201/ CLICKHOUSE_TEST_URL=http://localhost:8123/ \
  bun run test:browser:jsg:clickhouse
```

The browser script covers real Arrow loading, overlapping-range partition reuse, cached reloads with no network, password lifetime,
failed refresh, cancellation, retained results and mobile layout. It accepts `CLICKHOUSE_DATABASE`,
`CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `JSG_TEST_START` and `JSG_TEST_END`; defaults use
2026-04-01 through 2026-06-30. The CI HTTP fixture exercises the browser protocol and Arrow path
with deterministic inputs, not ClickHouse SQL execution. The isolated native integration checks above
remain responsible for SQL semantics; the optional browser integration uses an explicitly selected source.

References: [ClickHouse HTTP interface](https://clickhouse.com/docs/interfaces/http),
[Arrow output settings](https://clickhouse.com/docs/operations/settings/formats#output_format_arrow_compression_method),
[local-network browser permissions](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access).

## JSG research interface

The working draft, next dataset, active task and displayed result are separate states. Editing
parameters or changing source/dates leaves the selected run visible. The **运行设置** button shows
the number of changed settings; its **修改** tab lists each captured and proposed value.
Each completed run captures its own configuration and dataset references; cancellation, failed
loads and failed backtests retain the last result. **导出结果** always exports the selected run's
captured configuration and complete result, even while the next run's parameters differ.
Invalid in-progress inputs do not overwrite the last valid saved draft or prevent completed runs
from being recorded. The v1 saved research project migrates to a v2 session on restore.

A single compact toolbar contains the strategy selector, history, settings and run action. The selected
run's summary and four core metrics precede the result tabs: **概览**, **分析**, **成交**, **持仓** and
**调仓**. The net-value/drawdown chart belongs to the overview; other tabs show their own content
without forcing a scroll past the chart. Parameter experiments expand into a focused experiment view;
opening a combination's details returns to the selected result with the experiment collapsed.

**运行设置** is a right-hand drawer on desktop and a full-width panel on small screens. Its **参数**,
**数据与区间** and **修改** tabs share a fixed run action; costs, risk limits and advanced source options
are folded. **恢复本次运行设置** restores the selected run's frozen parameters and source request.
Passwords never participate in change detection. Original requested dates are captured separately
from aligned trading dates, so holidays do not falsely mark a run as edited. The idle status bar is
hidden; active tasks show progress under the toolbar. Arrow keys navigate result/settings tabs;
Ctrl/Cmd+Enter starts the next run from the workspace or settings drawer. Native dialogs handle
Escape, focus containment and focus restoration.

Net value and drawdown use Lightweight Charts with resize handling, theme updates, pan/zoom
and 3-month/1-year/full-range controls. Net values normalize each run by its own starting capital.
**查看交易日** expands a date control with an accessible numeric reading of an exact trading day.
Chart range selection is retained when switching result tabs. Preview curves
are refined from complete OPFS result chunks for the visible range, keeping at most 4,096 refined
points per series and preserving equity and drawdown extrema. Comparison is available for runs
with the same start/end dates; underlying datasets can differ, so compare source assumptions as
well as parameters. See [third-party notices](../../THIRD_PARTY_NOTICES.md) for chart attribution.

**成交** filters the full history by security, dates, direction and fill status; partial fills count as
executed orders and concrete engine rejection reasons remain visible. Pages render at most 50
rows. Unfiltered pagination uses chunk counts to read only the necessary files; arbitrary filters
scan one result chunk at a time. Querying and parsing happen in a dedicated Worker, which uses
chunk date/security/side/status summaries to skip irrelevant files and caches at most 64 parsed chunks
whose serialized source sizes total at most 8 MiB. This byte budget does not measure JavaScript heap
size. Requests can be cancelled, and stale replies cannot overwrite a newer query. **持仓** is
paginated and **调仓** reads the chosen day's chunk.
Order and position details open in sheets. No full market dataset is assembled in JavaScript.

**运行历史** retains completed runs without automatically evicting the oldest twenty. Selecting history changes the displayed
result while preserving the current draft; **使用所选运行参数** explicitly applies that run's
configuration. History deduplicates shared dataset references and stores small metrics, never copies of market rows,
inline complete result arrays or connection passwords.

Use **更多 → 数据与存储** to inspect local snapshots, their ranges, byte sizes and references, choose
a saved snapshot, and preview/reclaim unused data. Remove old runs with the history row's delete
button, then use **清理未使用数据** and **确认清理** to reclaim their artifacts. Clearing history
metadata alone does not delete files. Cleanup protects the current dataset, retained/selected runs,
shared input partitions and active exports/queries; it prunes the associated completed task/cache
records and releases their lineage before deleting approved artifacts. It checks references and file
sizes again at execution time and leaves other Quant applications' files intact. Startup removes
abandoned JSG transfer files, dangling partition indexes and export files older than the existing
60-second download grace period. Browser storage quota still applies.

```sh
bun run test:browser:jsg
bun run test:browser:jsg:layout
# Local source integration, when a browser and localhost listener are permitted:
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:clickhouse
```

## Browser parameter experiments

Use **更多 → 参数实验** to vary 1–6 settings: stock count, pool size, stop loss,
trailing stop, portfolio drawdown, single-symbol/total exposure caps, daily loss,
fixed take profit, slippage and commission. Enter comma-separated candidate
values; risk limits use percentages (`5` means 5%, `0` disables the limit). Other settings use
the current draft. Equivalent values are deduplicated, every combination is validated, and
the Cartesian product is limited to 64 independent configurations.

ClickHouse data is acquired once through the existing snapshot/partition cache. One browser
Worker drives the Rust/WASM grid: each daily Arrow batch and market feature set is computed
once, then shared by independent portfolios. The Worker yields between portfolio steps for
progress and cancellation. It uses one CPU thread; browser WASM threads are not required.
Only configuration and summary metrics are persisted for each combination, keeping one
bounded input partition and shared market windows rather than 64 complete result histories.

Results sort by return, drawdown, Sharpe or fees and display 20 rows per page. **查看详情**
generates a complete single-run result using that combination's captured configuration and
frozen local dataset, or reuses an existing full-result cache. Explicit default values give
ordinary runs and grid details the same cache identity. Viewing details preserves the draft;
**使用参数** explicitly changes it. Existing selected results and the previous experiment
remain available during a new experiment, cancellation or failure.

**导出参数实验** saves configurations, metrics, manifest and snapshot provenance as JSON.
The selected experiment is restored after reload; all archived experiments' input and output references are protected
from storage cleanup. Replacing it or choosing **移除参数实验** releases the metadata reference;
use **数据与存储 → 清理未使用数据** to reclaim eligible artifacts and task/cache records.
Complete detail runs remain in the persistent research library. Exports contain the experiment's
captured source and range, even if the current draft or source has changed.

```sh
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:grid
BASE_URL='http://localhost:5201/' node scripts/benchmark-jsg-grid.mjs \
  /tmp/bcr-research-benchmarks/input /tmp/bcr-research-benchmarks/browser-grid
```

The grid test covers independent-run metric parity, validation, sorting/pagination, cache,
cancel/restore, detail generation, immutable exports, storage reclamation and 320 px layouts.
See [BENCHMARKS.md](BENCHMARKS.md) for the large-data measurements and native comparison.

## Research evaluation and benchmarks

Open **分析** on a selected full-result run to inspect monthly/yearly compound returns and
annualized volatility. A dedicated result Worker scans the complete OPFS chunks once; the
chart preview is never the source of statistics. Period tables show at most 24 rows per page.
The first day's return uses the run's initial capital. Later periods start from the previous
session's closing equity, so compound period returns reproduce the complete run's return.
Partial first/last months and years display their actual dates and session counts.

**设置基准** supports the current ClickHouse connection or a CSV file. ClickHouse fetches
`stock_daily FINAL` close values for an explicit code (default `sh.000300`, CSI 300), using
typed HTTP parameters in a temporary data Worker. This is a **price-return** comparison and
excludes dividends. CSV files use `date,close` and `YYYY-MM-DD,positive-value` rows; users
explicitly declare price or total return. Declaring total return does not reconstruct dividends.
Inputs must be strictly ordered, unique, at most 20,000 rows and 2 MiB. Every backtest date,
plus the exact preceding trading session from the frozen calendar, must be present. Missing
dates are rejected without interpolation or forward-fill; extra dates do not affect the statistics.

A successfully validated benchmark is stored as an immutable artifact and bound to that run.
Changing the next source, dates or draft does not replace it. Failure/cancellation preserves
the previous binding; reload reads the saved artifact without contacting ClickHouse. The
binding is protected by storage cleanup while its run is retained. **移除所选运行基准**
releases the reference; ordinary unused-data cleanup can then reclaim the file. Benchmarks
are fetched by one bounded query, but are not a transaction snapshot shared with the earlier
market download. Acquisition time and source are included in exports; passwords are not.

**导出研究评估** saves the run references/configuration, manifest, frozen benchmark, exact
statistics, periods and bounded chart curve. The ordinary full-result export also includes
benchmark data and replay versions in a separate `research` header, leaving the existing
engine result fields intact. New runs/grid experiments record engine, executor and metric
versions; historical runs with no version metadata remain explicitly unrecorded. Version
constants live in `src/jsg/versions.ts`; replay behavior changes require an engine/executor
version bump, and metric formula changes require a metric/evaluation version bump.

The contract uses 252 sessions per year, zero risk-free return, daily simple returns, sample
variance and closing portfolio equity after fees. CAGR is `(last / initial)^(252 / days) - 1`;
volatility is `sample_std(daily_returns) * sqrt(252)`; Sharpe is
`mean(daily_returns) / sample_std(daily_returns) * sqrt(252)` (zero for constant returns).
Drawdown includes the initial capital as the starting peak. Excess return is strategy minus
benchmark return in **percentage points**, distinct from relative wealth return
`(1 + strategy_return) / (1 + benchmark_return) - 1`. The exported conventions and
**指标口径与版本** panel state these assumptions.

**风险与收益质量** adds Sortino, Calmar, annual downside deviation, winning-day
ratio, daily profit factor, and average winning/losing-day P&L. Downside deviation is
`sqrt(sum(min(daily_return, 0)^2) / all_sessions) * sqrt(252)`; Sortino divides
`mean(daily_return) * 252` by this deviation, and Calmar divides CAGR by absolute
maximum drawdown. Winning-day ratio counts positive daily account P&L over all
sessions, including flat days. Profit factor divides total positive daily P&L by
absolute total negative daily P&L. These are account-day statistics, not matched
trade statistics. Average P&L values are in account currency. Ratios with zero
denominators are `null` in evaluation exports and shown as `—`; they are never
replaced with an arbitrary large number. Benchmark statistics use the same formulas.

**添加对照** selects up to four other completed runs with exactly the same start/end
sessions, for five runs total. All net curves use each run's own initial capital;
colors consistently identify curves and table columns. Comparison metrics scan
complete local result chunks in the result Worker, including validation detail
windows, rather than using chart samples. The table includes risk/profit statistics,
collapsible canonical parameter differences, and CSV export with immutable run IDs.
Different input snapshots or engine versions are labeled. Removing a retained run
or changing to an incompatible selected interval removes its comparison. Comparison
choices are temporary; completed runs and risk settings persist across reload.

## Optional risk controls

All new controls default to `0` (disabled), and work in both native Rust and WASM,
single runs, shared-factor grids, and validation. **运行设置 → 参数 → 风险控制**
exposes the same settings that JSON configurations accept:

| Field            | Meaning                                                    | Valid values |
| ---------------- | ---------------------------------------------------------- | ------------ |
| `maxPositionPct` | Maximum value of one holding / account equity at purchase  | 0–1          |
| `maxExposurePct` | Maximum total stock value / account equity at purchase     | 0–1          |
| `maxDailyLoss`   | Close equity loss from the previous session's final equity | 0–<1         |
| `takeProfit`     | Fixed gain over the engine's weighted position risk cost   | 0–10         |

Purchase caps value every holding using the current execution's open or close
(the last known mark for a missing bar), including adjustment units in the research
model. They use equity after the proposed fill's actual fees and slippage, including
receivables, and shrink orders by whole 100-share lots using a bounded binary search.
They restrict new purchases; subsequent price changes can move exposure above a
cap and do not force sales. Partially filled orders preserve `status: "partial"`
and add `riskReason: "position-cap"` or `"exposure-cap"`. A purchase blocked entirely
uses the corresponding cap status. Orders and full exports retain these reasons.

Daily loss is checked at the close, including that day's fills and distributions;
it is not an intraday maximum-loss guarantee. A trigger cancels queued purchases,
liquidates the portfolio, and retries exits on later sessions if a suspension,
price limit, or T+1 prevents selling. Fixed take profit is also checked at the close;
once triggered, its exit persists even if the gain falls below the threshold.
All individual risk exits persist until the shares can be sold. An exited symbol
is not scheduled for purchase on that exit session. Portfolio liquidation blocks
re-entry through the liquidation session; after clearing, a later scheduled
rebalance can resume purchases. New engine/executor versions invalidate old replay
cache entries; previously stored complete runs remain available for comparison.

```sh
bun run test:rust:quant
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:features
```

```sh
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:evaluation
BASE_URL='http://localhost:5201/' node scripts/benchmark-jsg-evaluation.mjs \
  /tmp/bcr-research-benchmarks/input /tmp/bcr-research-benchmarks/evaluation
```

The deterministic browser test mocks only the benchmark HTTP response; the source fixture
and optional real ClickHouse browser integration also fetch and validate a benchmark through
the same application path. See [BENCHMARKS.md](BENCHMARKS.md) for measurement boundaries.

## Research projects and shared strategies

Quant Lab now organizes work as **project → experiment → immutable runs**. The collapsible
research directory supports project creation/renaming, experiment creation/renaming, tags,
notes, favorites and a baseline run. Backtests, parameter grids and validation studies are
archived independently; selecting an older grid/study loads its result on demand. Selecting
history preserves the next-run draft. Baselines must belong to the same experiment, and
removing that run clears the baseline. Compatible intervals can be compared from the result
header. The selected result kind is saved, so reload restores the same research view.

The compact metadata catalog lives in the existing SQLite metadata store; Arrow input and
full result chunks remain in OPFS. V2 sessions are imported into a default project/experiment
without replaying completed results. There is no automatic retention eviction: safety limits
are 100 projects, 1,000 experiments, 1,000 entries of each result kind and a 16 MiB metadata
record. New tasks stop at the entry limit and request manual removal. Storage cleanup protects
all archived input/output references, result chunks and benchmark bindings until their records
are explicitly removed; clearing a selected result does not implicitly clear the archive.

The frozen **数据与执行** disclosure shows historical-data declarations, strategy-specific
financial requirements, warmup coverage, execution price model, T+1, volume participation,
fees, slippage and replay versions. A different next-run snapshot shows added/removed dates,
securities and changed partition fingerprints. Fingerprint differences can come from partition
boundaries; they do not prove which historical rows were revised. Source historical declarations
are displayed as declarations, not independently certified quality scores.

Strategy metadata/parameter contracts are in `packages/market-data/src/research/strategy.ts`;
Rust signal generators and portfolio construction are in `src/strategy.rs`. Account marking,
corporate actions, fills, fees and portfolio risk remain shared in `Engine`. `ResearchConfig`
retains the existing daily transport/execution fields and adds an optional `strategy` object:

```json
{
  "id": "momentum",
  "lookback": 20,
  "rebalance": "daily",
  "allocation": "equal",
  "investment": 0.95
}
```

Omitting this object preserves JSG's MA20, weekly calendar rebalances and 95% equal allocation.
JSG generates the original breadth gate and ascending-market-cap ranks, including its
limit-up-opened exit. Momentum ranks positive adjusted-price returns descending and excludes
ST/non-selection members, without using profit/share count or JSG-specific exits. Both support
5–250 observations, daily/weekly/monthly schedules and equal/inverse-volatility weights.
Price history counts valid observations per instrument; newly listed or sparsely observed
members can remain ineligible despite sufficient calendar warmup. Shared daily Arrow inputs
still use the existing typed daily transport columns; the momentum strategy ignores financial
columns rather than changing the file schema.

Monthly scheduling uses the optional frozen calendar `monthEnd` flag, generated from the full
source trading calendar. Imported snapshots without this flag identify a month end from the
following covered session; the final covered session is not assumed to be month end. Grid
accounts share decoded market observations and features keyed by strategy, period and weight
method. Independent/WASM-grid/native results are reconciled in strategy tests. Observation
period is also available as a grid axis; complete combination details use the same single-run
engine and cache identity.

Browser ClickHouse acquisition requests at least 30 warmup sessions, increasing this to the
largest strategy requirement in a grid (up to 251). The public snapshot request records longer
warmup without passwords. Local imports keep their original coverage, which is visible in the
context disclosure. Market's independent MA20 breadth indicator continues to use the same
shared data without portfolio state.

```sh
bun run build:wasm:quant
bun run test:rust:quant
bun run test apps/quant-lab/tests
# Start Studio, then use its actual /quant URL.
BASE_URL=http://localhost:5297/quant bun run test:browser:quant:experiments
```

The browser check covers projects/favorites/notes, multiple grid/study archives, momentum
explanations, baseline comparison, reload, cleanup and the mobile research directory.

## Continuous out-of-sample research

Open **更多研究操作 → 稳健性验证 → 连续样本外 · 滚动选参**. Specify candidate stock counts,
stop losses and observation periods, a training window (at least 20 sessions), a test window
(at least 5 sessions) and a training objective. Training candidates × windows is limited to 64.
The final shorter test window is retained, so deployment covers every session after training.

Candidates run independently on the preceding training range. Only their training metrics select
each winning configuration; ties use candidate order. The selected parameters are installed at
the training range's final close and generate orders for the next session's open. One Rust `Engine`
replays all deployment windows with continuous cash, holdings, corporate actions, risk high-water
marks and pending risk exits. A parameter boundary forces a rebalance; the normal selected
schedule applies between boundaries. Risk rules in the new profile start with the following
session. Execution model, capital, fees, slippage, participation and T+1 assumptions stay fixed.

`ParameterStep` records `from`, `selectedAt` and the complete configuration. Rust and the shared
TypeScript contract reject future or non-adjacent selections, unordered dates and changes to
execution assumptions. Price history retains the largest scheduled lookback, but signal generation
uses only observations already processed. The schedule describes frozen training decisions;
native replay does not rerun training or independently certify how those decisions were made.

The result view exposes continuous equity/drawdown, compounded monthly/yearly returns, actual
deployment-window returns alongside independent empty-account tests, and selected-parameter
frequencies/switch counts. Global metrics are computed from actual daily equity; individual reset
window metrics are never compounded into the displayed curve. Segment returns use the previous
segment's closing equity; segment drawdown restarts its local peak for that diagnostic only.

Studies now use result schema v2 while existing v1 independent studies remain readable. Study
artifacts retain the continuous summary, full-result reference, chunk references and calculated
analysis. Cleanup protects those references even when the study is archived and not selected.
**导出稳健性验证** exports frozen decisions, training/test/cost summaries and analysis;
**完整结果** expands every result chunk into a portable JSON export with the parameter schedule,
all daily equity, orders, decisions and research observations. Charts use bounded previews.

The existing native executable accepts the same schedule:

```sh
jsg manifest.json config.json --schedule schedule.json --jsonl
```

Use the complete export's `config` as `config.json` and `research.parameterSchedule` as
`schedule.json`, together with the original frozen Arrow snapshot. No database connection is
needed for replay. The browser test checks full native/WASM equity, order and metric parity,
the shorter final window, reload, cleanup, cancellation and narrow layouts:

```sh
BASE_URL=http://localhost:5297/quant bun run test:browser:quant:walk-forward
```
