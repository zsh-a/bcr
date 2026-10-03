"""Checksum-verified Binance UM archives. Stdlib only; no keys or account access."""
import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import shutil
import tempfile
import time
import urllib.request
import zipfile

from artifacts import atomic_bytes, content_addressed, ensure_writable, read, write_once
from protocol import validate_plan
from warmup import WARMUP_POLICY, window_warmup_days

BASE = "https://data.binance.vision/data/futures/um"
UTC = dt.timezone.utc
MINUTE = 60000
DAY = 86400000


def timestamp(date):
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=UTC).timestamp() * 1000)


def months(start, end):
    current = dt.date.fromisoformat(start).replace(day=1)
    last = dt.date.fromisoformat(end)
    while current < last:
        yield current.strftime("%Y-%m")
        current = (current.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def archive(cache, symbol, kind, month, cadence="monthly"):
    interval = "" if kind == "fundingRate" else "1m/"
    stem = f"{symbol}-{kind if kind == 'fundingRate' else '1m'}-{month}"
    url = f"{BASE}/{cadence}/{kind}/{symbol}/{interval}{stem}.zip"
    folder = cache / symbol / kind
    if cadence == "daily":
        folder /= "daily"
    folder.mkdir(parents=True, exist_ok=True)
    output, receipt = folder / f"{stem}.csv", folder / f"{stem}.json"
    if output.exists() != receipt.exists():
        raise ValueError(f"incomplete cached archive; preserve existing bytes and use a separate cache path: {output}")
    if output.exists() and receipt.exists():
        metadata = json.loads(receipt.read_text())
        if metadata["csvSha256"] != digest(output):
            raise ValueError(f"cached CSV checksum mismatch: {output}")
        return metadata
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url + ".CHECKSUM", timeout=45) as r:
                checksum = r.read().decode().split()[0].lower()
            if len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
                raise ValueError(f"invalid checksum: {url}")
            with tempfile.TemporaryDirectory(dir=folder) as scratch:
                zipped = Path(scratch) / "archive.zip"
                with urllib.request.urlopen(url, timeout=60) as r, zipped.open("wb") as w:
                    shutil.copyfileobj(r, w)
                if digest(zipped) != checksum:
                    raise ValueError(f"official checksum mismatch: {url}")
                csv_path = Path(scratch) / "archive.csv"
                with zipfile.ZipFile(zipped) as z:
                    entries = z.infolist()
                    if len(entries) != 1 or not entries[0].filename.endswith(".csv"):
                        raise ValueError(f"unexpected archive contents: {url}")
                    with z.open(entries[0]) as r, csv_path.open("wb") as w:
                        shutil.copyfileobj(r, w)
                metadata = {"url": url, "zipSha256": checksum, "csvSha256": digest(csv_path),
                            "path": str(output.resolve()), "retrievedAt": dt.datetime.now(UTC).isoformat()}
                atomic_bytes(output, csv_path.read_bytes(), replace=False)
                write_once(receipt, metadata)
                return metadata
        except FileExistsError as error:
            raise ValueError(f"archive destination was published concurrently; existing bytes were preserved: {output}") from error
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def merge_intervals(intervals):
    """Canonical half-open minute ranges; overlapping/adjacent windows share input."""
    ordered = []
    for start, end in intervals:
        if (type(start) is not int or type(end) is not int or start >= end
                or start % MINUTE or end % MINUTE):
            raise ValueError("required intervals must be positive, minute-aligned ranges")
        ordered.append((start, end))
    merged = []
    for start, end in sorted(ordered):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def month_intervals(month, required_intervals=None):
    first = dt.date.fromisoformat(month + "-01")
    next_month = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    start, end = timestamp(str(first)), timestamp(str(next_month))
    if required_intervals is None:
        return [(start, end)]
    return [(max(start, a), min(end, b)) for a, b in merge_intervals(required_intervals)
            if a < end and b > start]


def minute_rows(path):
    values = {}
    with Path(path).open() as f:
        for line in f:
            if line.startswith("open_time"):
                continue
            t = int(line.split(",", 1)[0])
            if t in values or t % MINUTE:
                raise ValueError(f"duplicate or invalid minute: {path}")
            values[t] = line.rstrip("\r\n")
    return values


def validation_scope(policy, intervals):
    return {"policy": policy, "intervals": [{"start": a, "end": b} for a, b in intervals]}


def complete_partition(cache, symbol, kind, month, monthly, required_intervals=None):
    """Replace incomplete calendar DAYS using verified official daily archives.

    The original monthly archive remains immutable. Never interpolate a bar.
    With an explicit scope, require full UTC days touched by that scope only.
    Keep all other original rows, even if their days are incomplete.
    """
    start, end = month_intervals(month)[0]
    intervals = month_intervals(month, required_intervals)
    days = sorted({t // DAY * DAY for a, b in intervals
                   for t in range(a // DAY * DAY, b, DAY)})
    scope = validation_scope("required-utc-days-v1", merge_intervals((d, d + DAY) for d in days))
    values = minute_rows(monthly["path"])
    if any(t < start or t >= end for t in values):
        raise ValueError(f"monthly timestamp outside calendar: {monthly['path']}")
    missing_days = [day for day in days if any(t not in values for t in range(day, day + DAY, MINUTE))]
    if not missing_days:
        return monthly if required_intervals is None else {**monthly, "validation": scope}
    sources = [monthly]
    for day in missing_days:
        date = dt.datetime.fromtimestamp(day / 1000, UTC).date().isoformat()
        daily = archive(cache, symbol, kind, date, "daily")
        replacement = minute_rows(daily["path"])
        if set(replacement) != set(range(day, day + DAY, MINUTE)):
            raise ValueError(f"official daily archive still incomplete: {daily['url']}")
        values.update(replacement)
        sources.append(daily)
    payload = ("\n".join(values[t] for t in sorted(values)) + "\n").encode()
    output = content_addressed(cache / symbol / kind / "derived", payload, ".csv")
    metadata = {"path": str(output.resolve()), "csvSha256": digest(output), "sources": sources,
                "replacedDays": [dt.datetime.fromtimestamp(day / 1000, UTC).date().isoformat() for day in missing_days]}
    if required_intervals is not None:
        metadata["validation"] = scope
    if not output.with_suffix(".json").exists():
        write_once(output.with_suffix(".json"), metadata)
    print(f"restored {symbol}/{kind}/{month}: {len(missing_days)} days from official daily ZIPs", flush=True)
    return metadata


def replay_partitions(cache, symbol, month, candles, marks, required_intervals):
    """Adapt scoped archives to the frozen CLI's contiguous, aligned CSV contract.

    Full aligned months retain their existing paths/bytes. Otherwise publish one
    pair per required continuous range; raw sources and repaired rows stay intact.
    Separate ranges are separate partitions, never bridged with invented bars.
    """
    intervals = month_intervals(month, required_intervals)
    if not intervals:
        return [], []
    sources = (candles, marks)
    values = [minute_rows(source["path"]) for source in sources]
    start, end = month_intervals(month)[0]
    full = set(range(start, end, MINUTE))
    if all(set(rows) == full for rows in values):
        return [{"month": month, "candles": candles["path"], "marks": marks["path"]}], []
    partitions, receipts = [], []
    for start, end in intervals:
        part = {"month": month, "from": start, "to": end}
        for key, kind, source, rows in zip(("candles", "marks"), ("klines", "markPriceKlines"), sources, values):
            if any(t not in rows for t in range(start, end, MINUTE)):
                raise ValueError(f"missing required replay minute: {symbol}/{kind}/{month}")
            payload = ("\n".join(rows[t] for t in range(start, end, MINUTE)) + "\n").encode()
            output = content_addressed(cache / symbol / kind / "replay", payload, ".csv")
            metadata = {"path": str(output.resolve()), "csvSha256": digest(output), "sources": [source],
                        "validation": validation_scope("continuous-replay-interval-v1", [(start, end)])}
            if not output.with_suffix(".json").exists():
                write_once(output.with_suffix(".json"), metadata)
            receipts.append(metadata)
            part[key] = metadata["path"]
        partitions.append(part)
    return partitions, receipts


def validate_funding(funding, start, end):
    selected = [f for f in funding if start <= f["time"] < end]
    if not selected:
        raise ValueError("empty funding window")
    for f in selected:
        if not math.isfinite(f["rate"]) or abs(f["rate"]) > 1 or not 0 < f["intervalHours"] <= 24:
            raise ValueError("invalid funding event")
    for a, b in zip(selected, selected[1:]):
        gap = b["time"] - a["time"]
        if gap <= 0 or gap > max(a["intervalHours"], b["intervalHours"]) * 3600000 + 60000:
            raise ValueError("incomplete or unordered funding calendar")
    if selected[0]["time"] - start > selected[0]["intervalHours"] * 3600000 + 60000 or end - selected[-1]["time"] > selected[-1]["intervalHours"] * 3600000 + 60000:
        raise ValueError("funding window has a missing boundary")


def required_months(plan):
    """Union of actual study windows; funding is unnecessary during warmup."""
    price_dates, funding_dates, windows = set(), set(), []
    for window in plan["windows"]:
        if timestamp(window["end"]) <= timestamp(window["start"]):
            raise ValueError("study window must have a positive length")
        days = window_warmup_days(plan, window)
        warmup_start = dt.date.fromisoformat(window["start"]) - dt.timedelta(days=days)
        price_dates.update(months(str(warmup_start), window["end"]))
        funding_dates.update(months(window["start"], window["end"]))
        windows.append({**window, "warmupDays": days, "warmupStart": str(warmup_start)})
    return sorted(price_dates), sorted(funding_dates), windows


def reuse_manifest(plan_path, output):
    manifest_path = output / "manifest.json"
    if not manifest_path.exists():
        return False
    if read(manifest_path)["planSha256"] != digest(plan_path):
        raise ValueError("output contains another frozen plan; choose a new output directory")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/bcr-trend-research")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    ensure_writable(args.output, directory=True)
    ensure_writable(args.cache, directory=True)
    plan = validate_plan(read(args.plan))
    if args.workers < 1:
        raise ValueError("workers must be positive")
    manifest_path = args.output / "manifest.json"
    if reuse_manifest(args.plan, args.output):
        print(f"reusing frozen manifest: {manifest_path}; native replay rechecks source checksums", flush=True)
        return
    args.output.mkdir(parents=True, exist_ok=True)
    dates, funding_dates, warmup_windows = required_months(plan)
    required = merge_intervals((timestamp(w["warmupStart"]), timestamp(w["end"])) for w in warmup_windows)
    jobs = [(symbol, kind, month) for symbol in plan["symbols"]
            for kind in ["klines", "markPriceKlines", "fundingRate"]
            for month in (funding_dates if kind == "fundingRate" else dates)]
    receipts = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(archive, args.cache, *job): job for job in jobs}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            job = futures[future]
            receipts[job] = future.result()
            if index % 30 == 0 or index == len(jobs):
                print(f"verified {index}/{len(jobs)} archives", flush=True)
    repair_jobs = [(symbol, kind, month) for symbol in plan["symbols"] for kind in ["klines", "markPriceKlines"] for month in dates]
    def complete(job):
        return job, complete_partition(args.cache, *job, receipts[job], required_intervals=required)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for job, result in pool.map(complete, repair_jobs):
            receipts[job] = result
    manifest = {"version": 2, "planSha256": digest(args.plan), "warmupPolicy": WARMUP_POLICY,
                "warmupWindows": warmup_windows, "generatorSha256": digest(Path(__file__)),
                "priceValidation": validation_scope("required-utc-days-v1", required),
                "warmupSourceSha256": digest(Path(__file__).with_name("warmup.py")), "symbols": {}}
    for symbol in plan["symbols"]:
        archives = [receipts[symbol, kind, month] for kind in ["klines", "markPriceKlines", "fundingRate"]
                    for month in (funding_dates if kind == "fundingRate" else dates)]
        partitions = []
        for month in dates:
            parts, derived = replay_partitions(args.cache, symbol, month, receipts[symbol, "klines", month],
                                               receipts[symbol, "markPriceKlines", month], required)
            partitions.extend(parts)
            archives.extend(derived)
        funding = []
        for month in funding_dates:
            with Path(receipts[symbol, "fundingRate", month]["path"]).open() as f:
                for row in csv.DictReader(f):
                    funding.append({"time": int(row["calc_time"]), "rate": float(row["last_funding_rate"]),
                                    "intervalHours": float(row["funding_interval_hours"])})
        for window in plan["windows"]:
            validate_funding(funding, timestamp(window["start"]), timestamp(window["end"]))
        funding_path = content_addressed(args.output / "artifacts" / "funding", json.dumps(funding, allow_nan=False).encode(), ".json")
        manifest["symbols"][symbol] = {"archives": archives, "funding": str(funding_path.resolve()), "fundingSha256": digest(funding_path),
            "partitions": partitions}
    write_once(manifest_path, manifest)
    print(f"manifest: {args.output / 'manifest.json'}", flush=True)


if __name__ == "__main__":
    main()
