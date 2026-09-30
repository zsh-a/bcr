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

The exporter reads the existing quent tables (`stock_daily`, `trade_dates`,
`index_stocks`, `finicial_report`, `shares_info`, `industry_info`). It executes
read-only, parameterized HTTP queries; credentials stay outside the browser.
ClickHouse filters the universe/date range and computes financial/share/industry
ASOF joins. Price results travel as an ArrowStream; the exporter
reassembles complete days and writes bounded IPC streams, without accumulating the
whole price history. Python here is an offline data adapter, not the backtest core
or a running backend service.

```sh
python3 -m venv tmp/jsg-export
# Windows users can activate the environment and call python/pip normally.
tmp/jsg-export/bin/pip install -r scripts/requirements-jsg.txt
export CLICKHOUSE_URL=http://localhost:8123/
export CLICKHOUSE_DATABASE=quent
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
200,000 order records. The Worker reserves 256 MiB in the scheduler; this is a
scheduling estimate rather than a guarantee on measured browser memory. Equity
and bounded order output accumulate in memory and are exported as JSON; very large
parameter grids or larger result histories need a future streamed result sink.

## Execution model and known limits

The explicit model version is **`jsg-adjusted-v1`**, a research migration, not a
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
  live trading and direct authenticated browser access to ClickHouse are out of scope.

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
