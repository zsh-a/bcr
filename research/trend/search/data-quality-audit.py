"""Recheck frozen search inputs locally; no strategy execution or network calls.

From the repository root:
  python research/trend/search/data-quality-audit.py --output /tmp/search-data-quality.json
The default output is the frozen attachment; existing output is never replaced.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import read, sha, write_once
from details_audit import Sources, check

PLAN = ROOT / "research/trend/search-plan.json"
MANIFEST = ROOT / "tmp/trend-search-v8/manifest.json"
PRIOR = ROOT / "research/trend/robustness/data-quality.json"
PLAN_SHA = "f6db2c3a71c08fbed0a7a6c2b6f7f1538fbf40d29180aafab216e766f2b62594"
PRIOR_SHA = "8e2f974091d1a35fc2d2b4ef134ecadb1e2dbbfdccd1431506ea52aa00bd8e9a"
MINUTE, DAY = 60_000, 86_400_000


def timestamp(date):
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def warmup(candidate):
    check(candidate["tradeMinutes"] == 30, "frozen search trades only 30-minute bars")
    entry = candidate["entry"]
    bars = {"pullback": 3, "kdj": 9, "price-action": 17}.get(entry, candidate["breakoutBars"])
    exit_bars = candidate.get("channelExitBars", candidate["breakoutBars"] // 2) if candidate["management"] == "channel" else 0
    ema_bars = {"none": 0, "background": 0, "ema": 60, "slow-ema": 63}[candidate["filter"]]
    context = 22 * 120 if entry == "price-action" or candidate["filter"] == "background" else 0
    return max(1, math.ceil(max(max(14, bars, exit_bars, ema_bars) * 30, context) / 1440))


def rows_by_time(path):
    rows = {}
    with Path(path).open() as stream:
        for line in stream:
            if line.startswith("open_time"):
                continue
            time = int(line.split(",", 1)[0])
            check(time not in rows, "duplicate source timestamp")
            rows[time] = line.rstrip("\r\n")
    return rows


def repair_hash(record):
    parents, days = record["sources"], record["replacedDays"]
    check(len(parents) == len(days) + 1, "daily repair parent count")
    rows = rows_by_time(parents[0]["path"])
    for day, source in zip(days, parents[1:]):
        first = timestamp(day)
        daily = rows_by_time(source["path"])
        check(set(daily) == set(range(first, first + DAY, MINUTE)), "official daily repair has a missing minute")
        rows.update(daily)
    digest = hashlib.sha256()
    for time in sorted(rows):
        digest.update((rows[time] + "\n").encode())
    check(digest.hexdigest() == record["csvSha256"], "monthly plus daily lineage differs from derived bytes")


def run(output):
    check(not output.exists(), "choose a new output path; existing evidence is immutable")
    check(sha(PLAN) == PLAN_SHA and sha(PRIOR) == PRIOR_SHA, "frozen evidence identity mismatch")
    plan, manifest, prior = read(PLAN), read(MANIFEST), read(PRIOR)
    manifest_hash = sha(MANIFEST)
    check(manifest["planSha256"] == PLAN_SHA and manifest["warmupPolicy"] == "active-windows-v1", "manifest identity")
    check(set(manifest["symbols"]) == set(plan["symbols"]), "symbol universe mismatch")
    official = {row["url"]: row for row in prior["officialChecksumChecks"]}
    old_hashes = {row["path"]: row["sha256"] for row in prior["sourceHashes"]}
    sources = Sources(manifest)
    receipts, repairs = [], []
    for record in sources.records.values():
        sources.verify(record["path"], record["csvSha256"])
        if "url" in record:
            check(record["url"].startswith("https://data.binance.vision/"), "unofficial archive source")
            before = official.get(record["url"] + ".CHECKSUM")
            check(before is not None and before["status"] == 200 and before["zipSha256"] == record["zipSha256"],
                  "archive lacks the previous frozen official checksum verification")
            check(old_hashes.get(record["path"]) == record["csvSha256"], "raw CSV differs from previously checked source")
            receipt_path = Path(record["path"]).with_suffix(".json")
            receipt = read(receipt_path)
            check(all(receipt[key] == record[key] for key in ("path", "url", "zipSha256", "csvSha256")), "archive receipt mismatch")
            receipts.append({"path": str(receipt_path), "sha256": sha(receipt_path),
                             "archiveUrl": record["url"], "zipSha256": record["zipSha256"]})
        if "replacedDays" in record:
            repair_hash(record)
            repairs.append({"path": record["path"], "csvSha256": record["csvSha256"], "days": record["replacedDays"]})
    print("verified source hashes", len(sources.verified), "cached official receipts", len(receipts), flush=True)
    warmups = [{"candidate": candidate["id"], "days": warmup(candidate)} for candidate in plan["candidates"]]
    maximum = max(row["days"] for row in warmups)
    check(len(warmups) == 32 and maximum == 14, "frozen candidate warmup differs")
    windows = {window["id"]: window for window in manifest["warmupWindows"]}
    check(set(windows) == {window["id"] for window in plan["windows"]}, "manifest window set differs")
    coverage, symbols = [], {}
    for symbol, source in manifest["symbols"].items():
        funding, funding_archives = [], []
        for record in source["archives"]:
            if "/fundingRate/" not in record.get("url", ""):
                continue
            funding_archives.append(record["path"])
            with Path(record["path"]).open() as stream:
                funding.extend({"time": int(row["calc_time"]), "rate": float(row["last_funding_rate"]),
                                "intervalHours": float(row["funding_interval_hours"])} for row in csv.DictReader(stream))
        sources.verify(source["funding"], source["fundingSha256"])
        check(funding == read(source["funding"]), "funding JSON differs from official CSV fields")
        symbols[symbol] = {"fundingArchives": len(funding_archives), "fundingEvents": len(funding),
                           "fundingSha256": source["fundingSha256"], "partitions": len(source["partitions"])}
        # The continuous window is explicitly checked first, then every other
        # declared window; no inference from counts or previous window reports.
        ordered = sorted(plan["windows"], key=lambda window: window["id"] != "validation-continuous")
        for window in ordered:
            recorded = windows[window["id"]]
            start, end = timestamp(window["start"]), timestamp(window["end"])
            begin = start - maximum * DAY
            check(recorded["warmupDays"] == maximum and timestamp(recorded["warmupStart"]) == begin
                  and all(recorded[key] == window[key] for key in window), "manifest window/warmup differs")
            minutes, marks, events = sources.load(symbol, begin, start, end)
            coverage.append({"window": window["id"], "symbol": symbol, "activeDays": (end - start) // DAY,
                             "warmupStart": begin, "startTime": start, "endTime": end,
                             "priceRowsPerSource": len(minutes), "expectedRowsPerSource": (end - begin) // MINUTE,
                             "firstMinute": int(minutes[0, 0]), "lastMinute": int(minutes[-1, 0]),
                             "fundingEventsInActiveWindow": len(events), "fundingFirst": events[0]["time"],
                             "fundingLast": events[-1]["time"], "status": "passed"})
            print("calendar", symbol, window["id"], len(minutes), "funding", len(events), flush=True)
            del minutes, marks
    check(sum((timestamp(w["end"]) - timestamp(w["start"])) // DAY for w in plan["windows"]) == 2037, "declared day count")
    continuous = [row for row in coverage if row["window"] == "validation-continuous"]
    check(len(continuous) == 6 and all(row["activeDays"] == 760 and row["priceRowsPerSource"] == 774 * 1440
                                     for row in continuous), "760-day complete continuous coverage")
    check(sha(PLAN) == PLAN_SHA and sha(MANIFEST) == manifest_hash, "source identity changed during audit")
    result = {"version": "trend-search-data-quality-1", "status": "passed", "planSha256": PLAN_SHA,
              "manifestSha256": manifest_hash, "validatorScriptSha256": sha(__file__),
              "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "priorOfficialChecksumEvidence": {"path": str(PRIOR.relative_to(ROOT)), "sha256": PRIOR_SHA},
              "warmupPolicy": manifest["warmupPolicy"], "candidateWarmupDays": warmups,
              "warmupWindows": manifest["warmupWindows"], "priceValidation": manifest["priceValidation"],
              "coverage": coverage, "symbols": symbols,
              "counts": {"windows": 6, "activeDays": 2037, "symbols": 6, "windowSymbolChecks": len(coverage),
                         "priceRowsPerSourceAcrossWindowChecks": sum(row["priceRowsPerSource"] for row in coverage),
                         "continuousActiveDays": 760, "continuousRowsPerSourcePerSymbolIncludingWarmup": 774 * 1440,
                         "sourceFilesRehashed": len(sources.verified), "cachedOfficialArchiveReceiptsVerified": len(receipts),
                         "officialArchiveChecksumsRefetched": 0, "repairedPartitionsVerified": len(repairs),
                         "continuousReplaySlicesVerified": sum(row.get("validation", {}).get("policy") == "continuous-replay-interval-v1"
                                                                for row in sources.records.values())},
              "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
              "cachedReceipts": receipts, "repairs": repairs,
              "scope": "All six declared windows and fixed six symbols. Rehash raw/derived CSV parents and funding JSON; reconstruct monthly+daily repairs and exact scoped slices; validate every required chronological trade/mark minute, OHLC and aligned calendar; reconstruct funding JSON from official CSV records and validate each active funding calendar. No strategy results read or replayed.",
              "limits": ["Official ZIP CHECKSUM verification is reused from the identified prior frozen audit; no network checks or ZIP downloads occur in this audit. Local receipts and current CSV bytes are rechecked.",
                         "Counts across windows include repeated warmup dates. Gaps outside declared required ranges remain unsupported; no interpolation or synthetic funding.",
                         "All 2037 active historical days were already observed. Source completeness does not provide new independent strategy evidence."]}
    write_once(output, result)
    print("PASSED", json.dumps(result["counts"]), "MANIFEST_SHA", manifest_hash, "OUTPUT_SHA", sha(output), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/search/data-quality.json")
    run(parser.parse_args().output)
