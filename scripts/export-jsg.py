#!/usr/bin/env python3
"""Read quent's ClickHouse schema into portable, bounded JSG Arrow daily batches.

Requires pyarrow (scripts/requirements-jsg.txt). No server process or database writes.
Credentials: CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE.
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc

MAX_BYTES = 32 * 1024 * 1024
SCHEMA = pa.schema([
    ("date", pa.uint32()), ("id", pa.uint32()), ("industry", pa.uint32()),
    *[(name, pa.float64()) for name in ("open", "high", "low", "close", "preclose", "adjfactor", "profit", "shares")],
    *[(name, pa.uint8()) for name in ("is_st", "tradable", "breadth_member", "selection_member")],
])


class ClickHouse:
    def __init__(self):
        self.url = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123/")
        parsed = urllib.parse.urlsplit(self.url)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("CLICKHOUSE_URL must be an HTTP(S) endpoint without credentials/query")
        self.database = os.environ.get("CLICKHOUSE_DATABASE", "quent")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.database):
            raise ValueError("invalid database identifier")

    def query(self, sql, params=None):
        options = {"database": self.database, "readonly": "1"}
        options.update({f"param_{key}": str(value) for key, value in (params or {}).items()})
        headers = {"X-ClickHouse-User": os.environ.get("CLICKHOUSE_USER", "default"), "X-ClickHouse-Key": os.environ.get("CLICKHOUSE_PASSWORD", "")}
        request = urllib.request.Request(self.url + "?" + urllib.parse.urlencode(options), data=sql.encode(), headers=headers, method="POST")
        try:
            return urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as error:
            # Do not echo the request URL/headers: they may contain secrets or private endpoints.
            raise RuntimeError(f"ClickHouse HTTP {error.code}; check schema, permissions and query compatibility") from None

    def json(self, sql, params=None):
        with self.query(sql + " FORMAT JSONEachRow", params) as response:
            return [json.loads(line) for line in response if line.strip()]


def numeric_date(date):
    return int(str(date).replace("-", ""))


def sessions(calendar, start, end, warmup):
    """Calendar extends beyond end so a truncated week is never treated as a week end."""
    dates = sorted(set(dt.date.fromisoformat(str(row["date"])) for row in calendar))
    selected = [date for date in dates if start <= date <= end]
    if not selected:
        raise ValueError("no exchange sessions within requested range")
    before = [date for date in dates if date < selected[0]][-warmup:]
    if len(before) < warmup:
        raise ValueError("insufficient warmup calendar history")
    after = [date for date in dates if date > selected[-1]]
    if not after:
        raise ValueError("calendar must extend beyond the last backtest day")
    week_last = {}
    for date in dates:
        week_last[date.isocalendar()[:2]] = date
    result = [{"date": numeric_date(date), "rebalance": date == week_last[date.isocalendar()[:2]]} for date in before + selected]
    return result, selected[0], selected[-1]


PRICE_SQL = (Path(__file__).resolve().parents[1] / "crates/quant/sql/snapshot.sql").read_text()


def daily_batches(reader):
    """ClickHouse batches may split days; retain only slices for the current day."""
    current = None
    chunks = []
    rows = 0
    for batch in reader:
        values = batch.column(batch.schema.get_field_index("date")).to_pylist()
        begin = 0
        while begin < len(values):
            date = values[begin]
            finish = begin + 1
            while finish < len(values) and values[finish] == date:
                finish += 1
            if current is not None and date != current:
                if date < current:
                    raise ValueError("ClickHouse daily stream out of order")
                yield current, pa.Table.from_batches(chunks).combine_chunks()
                chunks, rows = [], 0
            current = date
            chunks.append(batch.slice(begin, finish - begin))
            rows += finish - begin
            if rows > 20_000:
                raise ValueError("daily instrument limit exceeded")
            begin = finish
    if chunks:
        yield current, pa.Table.from_batches(chunks).combine_chunks()


def normalize(table, codes, industries):
    arrays = {
        "date": pc.cast(table["date"], pa.uint32()),
        "id": pa.array([codes[code] for code in table["code"].to_pylist()], type=pa.uint32()),
        "industry": pa.array([industries[code] for code in table["industry_code"].to_pylist()], type=pa.uint32()),
    }
    for field in SCHEMA:
        if field.name not in arrays:
            arrays[field.name] = pc.cast(table[field.name], field.type)
    return pa.RecordBatch.from_arrays([arrays[field.name].combine_chunks() if isinstance(arrays[field.name], pa.ChunkedArray) else arrays[field.name] for field in SCHEMA], schema=SCHEMA)


def write_partitions(folder, batches, batch_days):
    """One IPC stream per bounded group; one complete day per RecordBatch."""
    partitions = []
    expected = []
    writer = sink = None
    days = rows = 0
    file = None

    def close():
        nonlocal writer, sink
        if writer is None:
            return
        writer.close()
        sink.close()
        size = (folder / file).stat().st_size
        if size > MAX_BYTES:
            raise ValueError("partition exceeds 32 MiB; reduce --batch-days")
        partitions.append({"file": file, "bytes": size, "rows": rows})
        writer = sink = None

    try:
        for date, batch in batches:
            if writer is None or days >= batch_days:
                close()
                file = f"daily-{len(partitions):04}.arrow"
                sink = pa.OSFile(str(folder / file), "wb")
                writer = pa.ipc.new_stream(sink, SCHEMA)
                days = rows = 0
            writer.write_batch(batch)
            expected.append(date)
            days += 1
            rows += batch.num_rows
        close()
    finally:
        if writer is not None:
            writer.close()
        if sink is not None:
            sink.close()
    return partitions, expected


def export(args):
    if args.output.exists():
        raise ValueError("output directory already exists; choose a new destination")
    ch = ClickHouse()
    params = {"breadth": args.breadth_index, "selection": args.selection_index}
    calendar = ch.json("SELECT calendar_date AS date FROM trade_dates FINAL WHERE is_trading_day = 1 ORDER BY date")
    cal, start, end = sessions(calendar, args.start, args.end, args.warmup)
    code_rows = ch.json("SELECT DISTINCT code FROM index_stocks FINAL WHERE index IN ({breadth:String}, {selection:String}) ORDER BY code", params)
    codes = {row["code"]: i for i, row in enumerate(code_rows)}
    if not codes or len(codes) > 20_000:
        raise ValueError("invalid stock universe size")
    industry_rows = ch.json("SELECT DISTINCT industry_code FROM industry_info FINAL WHERE industry_code != '' ORDER BY industry_code")
    industries = {code: i for i, code in enumerate(sorted({row["industry_code"] for row in industry_rows} | {"unknown"}))}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".jsg-export-", dir=args.output.parent))
    try:
        params.update(start=dt.datetime.strptime(str(cal[0]["date"]), "%Y%m%d").date(), end=end)
        with ch.query(PRICE_SQL, params) as response:
            with pa.ipc.open_stream(response) as reader:
                batches = ((date, normalize(table, codes, industries)) for date, table in daily_batches(reader))
                partitions, actual = write_partitions(staging, batches, args.batch_days)
        if actual != [session["date"] for session in cal]:
            raise ValueError("price dates differ from exchange calendar (missing/extra daily data)")
        instruments = []
        for code in codes:
            digits = code.split(".")[-1]
            ratio = 0.2 if digits.startswith(("30", "68")) else 0.1
            instruments.append({"code": code, "limitRatio": ratio})
        manifest = {"version": 1, "schema": "jsg-daily-v1", "name": args.name,
                    "source": "ClickHouse / quent schema", "universeMode": "snapshot",
                    "warnings": ["index_stocks 缺少历史退出区间，使用当前成分快照，可能存在幸存者偏差。",
                                 "财报按 publish_date 严格早于交易日取值；股本按公布日与变更日均已过去取值。",
                                 "旧库 ReplacingMergeTree 可能覆盖历史财报修订版本；无法从已丢失的版本还原完整历史可见性。",
                                 "涨跌停采用固定板块比例，未覆盖上市初期豁免、创业板历史规则与其他特殊制度。"],
                    "startDate": numeric_date(start), "endDate": numeric_date(end), "calendar": cal,
                    "instruments": instruments, "industries": list(industries), "partitions": partitions}
        (staging / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.output.exists():
            raise ValueError("output destination appeared while exporting")
        staging.rename(args.output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(f"Exported {sum(p['rows'] for p in partitions):,} rows / {len(partitions)} partitions to {args.output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", required=True, type=dt.date.fromisoformat)
    parser.add_argument("--end", required=True, type=dt.date.fromisoformat)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--name", default="JSG ClickHouse research")
    parser.add_argument("--breadth-index", default="000985")
    parser.add_argument("--selection-index", default="399101")
    parser.add_argument("--warmup", default=30, type=int)
    parser.add_argument("--batch-days", default=20, type=int)
    args = parser.parse_args()
    if args.start > args.end or not 20 <= args.warmup <= 1000 or not 1 <= args.batch_days <= 20:
        parser.error("invalid dates, warmup (20–1000), or batch-days (1–20)")
    try:
        export(args)
    except (ValueError, RuntimeError, OSError, pa.ArrowException) as error:
        print(f"export-jsg: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
