"""Read-only official-source audit for the frozen cross-symbol holdout.

From the repository root:
  python research/trend/holdout/data-quality-audit.py --output /tmp/holdout-data-quality.json

Refetch every official CHECKSUM and ZIP, compare the original extraction byte
hash, then check all required trade/mark minutes and actual funding records.
Only the new output is written; no cache, strategy result or old evidence changes.
"""
import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import read, sha, write_once
from details_audit import Sources, check

PLAN = ROOT / "research/trend/holdout-plan.json"
MANIFEST = ROOT / "tmp/trend-holdout-v8/manifest.json"
AVAILABILITY = ROOT / "research/trend/holdout/availability.json"
PLAN_SHA = "8255384163aa20d51f9743b15dc74567194d762fdaf359ec9533269779059a8e"
AVAILABILITY_SHA = "d96a204bf9e833c80cf29fce85531541b6d3ca27ccc4650bc8002e50337cb166"
MINUTE, DAY = 60_000, 86_400_000
SYMBOLS = {"LTCUSDT", "LINKUSDT", "ADAUSDT", "BCHUSDT", "ETCUSDT", "TRXUSDT"}


def timestamp(date):
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def warmup(candidate):
    check(candidate["tradeMinutes"] == 30 and candidate["entry"] == "breakout"
          and candidate["management"] == "channel" and candidate["filter"] == "none",
          "unexpected holdout warmup mechanism")
    return max(1, math.ceil(max(14, candidate["breakoutBars"], candidate["channelExitBars"]) * 30 / 1440))


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
        check(set(daily) == set(range(first, first + DAY, MINUTE)), "official daily repair missing minute")
        rows.update(daily)
    digest = hashlib.sha256()
    for time in sorted(rows):
        digest.update((rows[time] + "\n").encode())
    check(digest.hexdigest() == record["csvSha256"], "monthly plus daily lineage differs from derived bytes")


def official_archive(record, preflight):
    """Recheck actual compressed bytes and the sole unmodified CSV member."""
    url = record["url"]
    check(url.startswith("https://data.binance.vision/data/futures/um/"), "unofficial archive source")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url + ".CHECKSUM", timeout=45) as response:
                status = response.status
                text = response.read(4096).decode()
            token = text.split()[0].lower()
            check(status == 200 and len(token) == 64 and all(c in "0123456789abcdef" for c in token),
                  "invalid official checksum response")
            check(token == record["zipSha256"], "official archive checksum differs from download receipt: " + url)
            before = preflight.get(url + ".CHECKSUM")
            check(before is not None or "/daily/" in url, "monthly archive absent from frozen preflight")
            if before is not None:
                check(before["status"] == 200 and before["zipSha256"] == token,
                      "official archive changed since preflight: " + url)
            with tempfile.TemporaryFile() as zipped:
                with urllib.request.urlopen(url, timeout=60) as response:
                    check(response.status == 200, "official ZIP response failed")
                    shutil.copyfileobj(response, zipped)
                size = zipped.tell()
                zipped.seek(0)
                check(hashlib.file_digest(zipped, "sha256").hexdigest() == token, "actual ZIP checksum mismatch")
                zipped.seek(0)
                with zipfile.ZipFile(zipped) as archive:
                    entries = archive.infolist()
                    check(len(entries) == 1 and entries[0].filename.endswith(".csv"), "unexpected archive members")
                    with archive.open(entries[0]) as stream:
                        csv_hash = hashlib.file_digest(stream, "sha256").hexdigest()
                    check(csv_hash == record["csvSha256"], "official ZIP member differs from local CSV")
            return {"url": url + ".CHECKSUM", "status": status, "zipSha256": token,
                    "zipBytes": size, "csvPath": record["path"], "csvSha256": csv_hash,
                    "preflightCompared": before is not None, "actualZipAndMemberReverified": True}
        except Exception:
            if attempt == 2:
                raise


def run(output):
    check(not output.exists(), "choose a new output; existing evidence is immutable")
    check(sha(PLAN) == PLAN_SHA and sha(AVAILABILITY) == AVAILABILITY_SHA, "frozen input identity mismatch")
    plan, manifest, availability = read(PLAN), read(MANIFEST), read(AVAILABILITY)
    manifest_hash = sha(MANIFEST)
    check(manifest["planSha256"] == PLAN_SHA and manifest["warmupPolicy"] == "active-windows-v1", "manifest identity")
    check(set(manifest["symbols"]) == set(plan["symbols"]) == SYMBOLS, "fixed six-symbol universe differs")
    check(len(plan["windows"]) == 1 and plan["windows"][0]["start"] == "2024-09-01"
          and plan["windows"][0]["end"] == "2026-10-01", "fixed continuous holdout dates differ")
    preflight = {row["url"]: row for row in availability["checks"]}
    sources = Sources(manifest)
    raw = [record for record in sources.records.values() if "url" in record]
    check(len([record for record in raw if "/monthly/" in record["url"]]) == 462,
          "expected 312 monthly price/mark and 150 monthly funding archives")
    warmups = [{"candidate": candidate["id"], "days": warmup(candidate)} for candidate in plan["candidates"]]
    check(len(warmups) == 2 and all(row["days"] == 7 for row in warmups), "frozen seven-day warmup differs")
    dependencies = {str(path.relative_to(ROOT)): sha(path) for path in
                    (ROOT / "scripts/trend" / name for name in
                     ("details_audit.py", "literature_audit.py", "breakout_study.py", "download.py", "artifacts.py"))}
    receipts, repairs, coverage, symbols = [], [], [], {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending = [pool.submit(official_archive, record, preflight) for record in raw]
        for record in sources.records.values():
            sources.verify(record["path"], record["csvSha256"])
            if "url" in record:
                receipt_path = Path(record["path"]).with_suffix(".json")
                receipt = read(receipt_path)
                check(all(receipt[key] == record[key] for key in ("path", "url", "zipSha256", "csvSha256")),
                      "archive receipt mismatch")
                receipts.append({"path": str(receipt_path), "sha256": sha(receipt_path)})
            if "replacedDays" in record:
                repair_hash(record)
                repairs.append({"path": record["path"], "csvSha256": record["csvSha256"], "days": record["replacedDays"]})
        print("verified local source hashes", len(sources.verified), "repairs", len(repairs), flush=True)
        window = plan["windows"][0]
        check(len(manifest["warmupWindows"]) == 1, "unexpected manifest window count")
        recorded = manifest["warmupWindows"][0]
        start, end = timestamp(window["start"]), timestamp(window["end"])
        begin = start - 7 * DAY
        check(recorded["warmupDays"] == 7 and timestamp(recorded["warmupStart"]) == begin
              and all(recorded[key] == window[key] for key in window), "manifest warmup identity")
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
            minutes, marks, events = sources.load(symbol, begin, start, end)
            check(len(minutes) == 767 * 1440, "760 active days plus seven complete warmup days")
            coverage.append({"window": window["id"], "symbol": symbol, "activeDays": 760,
                             "warmupStart": begin, "startTime": start, "endTime": end,
                             "priceRowsPerSource": len(minutes), "expectedRowsPerSource": 767 * 1440,
                             "firstMinute": int(minutes[0, 0]), "lastMinute": int(minutes[-1, 0]),
                             "fundingEventsInActiveWindow": len(events), "fundingFirst": events[0]["time"],
                             "fundingLast": events[-1]["time"], "status": "passed"})
            symbols[symbol] = {"fundingArchives": len(funding_archives), "fundingEvents": len(funding),
                               "fundingSha256": source["fundingSha256"], "partitions": len(source["partitions"])}
            print("calendar", symbol, len(minutes), "funding", len(events), flush=True)
            del minutes, marks
        official_checks = []
        for future in concurrent.futures.as_completed(pending):
            official_checks.append(future.result())
            if len(official_checks) % 30 == 0:
                print("independently verified official ZIP/CSV", len(official_checks), "/", len(raw), flush=True)
    check(set(preflight) == {row["url"] for row in official_checks if row["preflightCompared"]}, "preflight archive coverage differs")
    check(sha(PLAN) == PLAN_SHA and sha(MANIFEST) == manifest_hash and sha(AVAILABILITY) == AVAILABILITY_SHA,
          "input identity changed during validation")
    check(all(sha(ROOT / path) == digest for path, digest in dependencies.items()), "audit dependency changed")
    result = {"version": "trend-holdout-data-quality-1", "status": "passed", "planSha256": PLAN_SHA,
              "manifestSha256": manifest_hash, "validatorScriptSha256": sha(__file__), "dependencies": dependencies,
              "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "preflight": {"path": str(AVAILABILITY.relative_to(ROOT)), "sha256": AVAILABILITY_SHA},
              "warmupPolicy": manifest["warmupPolicy"], "candidateWarmupDays": warmups,
              "warmupWindows": manifest["warmupWindows"], "priceValidation": manifest["priceValidation"],
              "coverage": coverage, "symbols": symbols,
              "counts": {"windows": 1, "activeDays": 760, "symbols": 6, "windowSymbolChecks": len(coverage),
                         "priceRowsPerSourceAcrossSymbols": sum(row["priceRowsPerSource"] for row in coverage),
                         "sourceFilesRehashed": len(sources.verified), "officialArchiveChecksumsRefetched": len(official_checks),
                         "actualOfficialZipsAndMembersReverified": len(official_checks), "preflightComparisons": len(preflight),
                         "repairedPartitionsVerified": len(repairs),
                         "continuousReplaySlicesVerified": sum(row.get("validation", {}).get("policy") == "continuous-replay-interval-v1"
                                                                for row in sources.records.values())},
              "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
              "cachedReceipts": receipts, "repairs": repairs,
              "officialChecksumChecks": sorted(official_checks, key=lambda row: row["url"]),
              "scope": "All six fixed symbols, every minute of 2024-08-25..2026-10-01 trade/mark data including seven-day warmup, and actual active funding records. Fresh official CHECKSUM and actual ZIP-byte/member checks against manifest and preflight; local source and derived-lineage hashes; complete aligned calendars and OHLC validation. No strategy result read or replayed.",
              "limits": ["Completeness is established only for required ranges. Official monthly files can retain gaps outside those ranges; no interpolation is accepted.",
                         "Funding completeness uses recorded historical intervalHours and the shared boundary/gap validator, not an assumed fixed eight-hour calendar.",
                         "The six symbols were previously untested within the inspected project, but the period and correlated market regimes were known. This source audit makes no profitability or temporal-out-of-sample claim."]}
    write_once(output, result)
    print("PASSED", json.dumps(result["counts"]), "MANIFEST_SHA", manifest_hash, "OUTPUT_SHA", sha(output), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/holdout/data-quality.json")
    run(parser.parse_args().output)
