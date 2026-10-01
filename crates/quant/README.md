# JSG research prototype

`bcr-quant` is a standalone Rust portfolio engine shared by the native `jsg` CLI
and Quant Lab's WASM Worker. It migrates the daily JSG workflow from quent:
20-bar industry breadth, profitability/ST filters, smallest market-cap targets,
weekly rebalance, limit-up opening exits, and optional portfolio/position stops.

## Run

```sh
bun install --frozen-lockfile
bun run build:wasm
bun run quant
```

Open `http://localhost:5201/?strategy=jsg` for the JSG workbench. This entry skips
SMA initialization and DuckDB data preparation. The existing SMA workbench remains
available through its tab. A deterministic 64-stock demo is supplied; click
“运行 JSG”. Import a `manifest.json` and **all** its `.arrow` files together to
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
- Only daily JSG is ported. General Python strategy loading, minute/tick simulation,
  and live trading are out of scope. Browser ClickHouse access is described below.

## Validation

```sh
bun run test:rust:quant
bun run test
bun run check
# Against the running standalone Quant Lab server:
bun run test:browser:jsg
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

### Local data-volume check

A synthetic input with 5,000 instruments × 1,250 sessions (6,250,000 rows,
477.9 MiB of Arrow, 7.6 MiB maximum partition) was exercised end to end in this
worktree. On this machine, with local files in the OS cache, native release replay
including file reads/output took approximately **0.55 s**, with **12.4 MiB peak
process RSS**. Browser file import took approximately **2.9 s** after switching
streamed hashing to the existing Rust BLAKE3 kernel; browser Worker replay took
approximately **1.1 s**. The browser/native final value and all orders agreed.
The fixture had 1,220 trading sessions after warmup and only 10 fills, so this
measures data throughput and memory behavior, not general strategy throughput.
It excludes ClickHouse export time and is not a cold-storage or hardware-neutral
benchmark. Browser peak memory was not measured.

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
BASE_URL=http://localhost:5201/?strategy=jsg node scripts/benchmark-jsg.mjs /tmp/jsg-q2 /tmp/jsg-browser
```

WASM/network dependencies are separated by compilation target. In native mode, credentials remain outside the browser. The optional direct mode keeps the entered
password in page/Worker memory and omits it from profiles, artifacts, cache keys and scheduler tasks. Native JSONL and browser artifacts stream full outputs; the UI loads one order
interval at a time and writes complete exports to a temporary OPFS file. Sampling affects only the chart
preview, while full result artifacts retain every event.

## Connect from the browser

Open Quant Lab's JSG tab and click the data source in the **下一次运行** bar. Select
**ClickHouse**, enter an HTTP(S) endpoint, database, username and password, then click
**测试连接** and **连接并使用**. Set dates separately with **设置回测区间** and click
**运行回测**. The browser fetches data and starts the same Rust/WASM portfolio engine.
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
Check **重新获取数据** to query updated source data. Cancellation or a failed refresh removes the
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

The browser script covers real Arrow loading, cached reloads with no network, password lifetime,
failed refresh, cancellation, retained results and mobile layout. It accepts `CLICKHOUSE_DATABASE`,
`CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `JSG_TEST_START` and `JSG_TEST_END`; defaults use
2026-04-01 through 2026-06-30. Ordinary CI tests use synthetic read-only responses rather than a live DB.

References: [ClickHouse HTTP interface](https://clickhouse.com/docs/interfaces/http),
[Arrow output settings](https://clickhouse.com/docs/operations/settings/formats#output_format_arrow_compression_method),
[local-network browser permissions](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access).

## JSG research interface

The working draft, next dataset, active task and displayed result are separate states. Editing
parameters or changing source/dates leaves the selected run visible with **待运行的修改**.
Each completed run captures its own configuration and dataset references; cancellation, failed
loads and failed backtests retain the last result. **导出结果** always exports the selected run's
captured configuration and complete result, even while the next run's parameters differ.
Invalid in-progress inputs do not overwrite the last valid saved draft or prevent completed runs
from being recorded. The v1 saved research project migrates to a v2 session on restore.

Desktop parameters can be collapsed; narrow workspaces show results first and use a parameter
sheet. Connection credentials and date/range controls live in separate dialogs. Common settings,
costs, optional risk limits and execution/industry settings are grouped with field-level validation.
Arrow-key navigation applies to both strategy tabs and result tabs; Ctrl/Cmd+Enter starts the next
run when no dialog is open. Native dialogs handle Escape, focus containment and focus restoration.

Net value and drawdown use Lightweight Charts with resize handling, theme updates, pan/zoom
and 3-month/1-year/full-range controls. Net values normalize each run by its own starting capital.
A date control provides an accessible numeric reading of an exact trading day. Preview curves
are refined from complete OPFS result chunks for the visible range, keeping at most 4,096 refined
points per series and preserving equity and drawdown extrema. Comparison is available for runs
with the same start/end dates; underlying datasets can differ, so compare source assumptions as
well as parameters. See [third-party notices](../../THIRD_PARTY_NOTICES.md) for chart attribution.

**成交** filters the full history by security, dates, direction and fill status; partial fills count as
executed orders and concrete engine rejection reasons remain visible. Pages render at most 50
rows. Unfiltered pagination uses chunk counts to read only the necessary files; arbitrary filters
scan one result chunk at a time. **持仓** is paginated and **调仓** reads the chosen day's chunk.
Order and position details open in sheets. No full market dataset is assembled in JavaScript.

**运行历史** retains metadata for the latest 20 runs. Selecting history changes the displayed
result while preserving the current draft; **使用所选运行参数** explicitly applies that run's
configuration. History deduplicates shared dataset references and stores small metrics, never copies of market rows,
inline complete result arrays or connection passwords. The 20-run metadata limit does not clean
up Runtime caches or old OPFS artifacts; browser storage quota still applies.

```sh
bun run test:browser:jsg
# Local source integration, when a browser and localhost listener are permitted:
BASE_URL=http://localhost:5201/ bun run test:browser:jsg:clickhouse
```
