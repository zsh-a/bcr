"""Required-window repair uses official rows and the existing native CSV contract."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import download
from protocol import ROOT


class ScopedDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cache = Path(self.temporary.name)
        self.start = download.timestamp("2024-01-01")
        self.end = download.timestamp("2024-02-01")
        self.day = download.DAY
        self.minute = download.MINUTE

    def source(self, name, times, price=100):
        path = self.cache / name
        path.write_text("".join(f"{t},{price},{price + 1},{price - 1},{price},1,{t + self.minute - 1}\n"
                                for t in times))
        return {"path": str(path), "csvSha256": download.digest(path), "url": f"official/{name}"}

    def repair(self, source, required=None):
        return download.complete_partition(self.cache, "BTCUSDT", "klines", "2024-01", source, required)

    def test_outside_missing_day_is_not_downloaded_and_original_rows_remain(self):
        required = [(self.start + self.day, self.start + 2 * self.day)]
        source = self.source("monthly.csv", [self.start, *range(*required[0], self.minute)])
        original = Path(source["path"]).read_bytes()
        with patch.object(download, "archive", side_effect=AssertionError("outside scope")):
            result = self.repair(source, required)
        self.assertEqual(result["path"], source["path"])
        self.assertEqual(Path(result["path"]).read_bytes(), original)
        self.assertEqual(result["validation"]["intervals"], [{"start": required[0][0], "end": required[0][1]}])

    def test_required_gap_replaces_whole_official_day_and_retains_outside_rows(self):
        day = self.start + self.day
        source = self.source("monthly.csv", [self.start, *range(day + self.minute, day + self.day, self.minute)], 101)
        original = Path(source["path"]).read_bytes()
        official = self.source("daily.csv", range(day, day + self.day, self.minute), 102)
        with patch.object(download, "archive", return_value=official) as archive:
            result = self.repair(source, [(day, day + self.day)])
        archive.assert_called_once_with(self.cache, "BTCUSDT", "klines", "2024-01-02", "daily")
        rows = download.minute_rows(result["path"])
        self.assertEqual(len(rows), 1441)
        self.assertIn(",101,", rows[self.start])
        self.assertIn(",102,", rows[day + self.minute])
        self.assertEqual(Path(source["path"]).read_bytes(), original)
        self.assertEqual(result["replacedDays"], ["2024-01-02"])
        self.assertEqual(result["sources"], [source, official])

    def test_required_daily_gap_fails_without_publishing_repair(self):
        day = self.start + self.day
        source = self.source("monthly.csv", [self.start, day])
        official = self.source("daily.csv", range(day + self.minute, day + self.day, self.minute))
        with patch.object(download, "archive", return_value=official):
            with self.assertRaisesRegex(ValueError, "official daily archive still incomplete"):
                self.repair(source, [(day, day + self.day)])
        self.assertFalse((self.cache / "BTCUSDT/klines/derived").exists())

    def test_default_still_demands_full_month(self):
        source = self.source("monthly.csv", range(self.start + self.day, self.end, self.minute))
        with patch.object(download, "archive", side_effect=ValueError("required official day unavailable")) as archive:
            with self.assertRaisesRegex(ValueError, "required official day unavailable"):
                self.repair(source)
        self.assertEqual(archive.call_args.args[3], "2024-01-01")

    def test_full_month_keeps_original_paths_and_bytes(self):
        sources = [self.source(name, range(self.start, self.end, self.minute))
                   for name in ("monthly.csv", "mark.csv")]
        with patch.object(download, "archive", side_effect=AssertionError("complete month")):
            self.assertIs(self.repair(sources[0]), sources[0])
        parts, receipts = download.replay_partitions(self.cache, "BTCUSDT", "2024-01", *sources,
                                                     [(self.start + self.day, self.start + 2 * self.day)])
        self.assertEqual(parts, [{"month": "2024-01", "candles": sources[0]["path"], "marks": sources[1]["path"]}])
        self.assertEqual(receipts, [])

    def test_required_union_merges_overlaps_and_keeps_unrequired_gaps(self):
        plan = {"windows": [{"id": "one", "start": "2024-01-03", "end": "2024-01-06"},
                             {"id": "overlap", "start": "2024-01-06", "end": "2024-01-08"},
                             {"id": "later", "start": "2024-01-20", "end": "2024-01-22"}]}
        with patch.object(download, "window_warmup_days", return_value=1):
            _, _, windows = download.required_months(plan)
        required = download.merge_intervals((download.timestamp(w["warmupStart"]), download.timestamp(w["end"]))
                                            for w in windows)
        self.assertEqual(required, [(self.start + self.day, self.start + 7 * self.day),
                                    (self.start + 18 * self.day, self.start + 21 * self.day)])
        times = [t for a, b in required for t in range(a, b, self.minute)]
        source = self.source("monthly.csv", [self.start, *times])
        with patch.object(download, "archive", side_effect=AssertionError("gap is not required")):
            result = self.repair(source, required)
        self.assertEqual(len(download.minute_rows(result["path"])), len(times) + 1)
        february = download.timestamp("2024-02-01")
        self.assertEqual(download.month_intervals("2024-02", [(february - self.day, february + self.day)]),
                         [(february, february + self.day)])

    def test_replay_splits_disjoint_ranges_and_aligns_different_raw_coverage(self):
        required = [(self.start + self.day, self.start + 3 * self.day),
                    (self.start + 19 * self.day, self.start + 21 * self.day)]
        times = [t for a, b in required for t in range(a, b, self.minute)]
        candles = self.source("monthly.csv", [self.start, *times])
        marks = self.source("mark.csv", times)
        original = [Path(s["path"]).read_bytes() for s in (candles, marks)]
        parts, receipts = download.replay_partitions(self.cache, "BTCUSDT", "2024-01", candles, marks, required)
        self.assertEqual(len(parts), 2)
        self.assertEqual(len(receipts), 4)
        for part, interval in zip(parts, required):
            for kind in ("candles", "marks"):
                self.assertEqual(list(download.minute_rows(part[kind])), list(range(*interval, self.minute)))
        for receipt in receipts:
            self.assertEqual(receipt["csvSha256"], download.digest(Path(receipt["path"])))
            self.assertIn(receipt["sources"][0], [candles, marks])
        self.assertEqual([Path(s["path"]).read_bytes() for s in (candles, marks)], original)

    def test_replay_cannot_crop_away_required_missing_minute(self):
        required = [(self.start + self.day, self.start + 2 * self.day)]
        candles = self.source("monthly.csv", range(*required[0], self.minute))
        marks = self.source("mark.csv", range(required[0][0] + self.minute, required[0][1], self.minute))
        with self.assertRaisesRegex(ValueError, "missing required replay minute"):
            download.replay_partitions(self.cache, "BTCUSDT", "2024-01", candles, marks, required)

    def test_duplicate_outside_scope_is_still_rejected(self):
        source = self.source("monthly.csv", [self.start, self.start])
        with self.assertRaisesRegex(ValueError, "duplicate or invalid minute"):
            self.repair(source, [(self.start + self.day, self.start + 2 * self.day)])

    def test_scoped_partitions_pass_frozen_native_cli_without_filling_gap(self):
        binary = ROOT / "crates/quant/target/release/trend"
        if not binary.exists():
            self.skipTest("existing native release is unavailable; never build it in this test")
        binary_hash = download.digest(binary)
        required = [(self.start + self.day, self.start + 3 * self.day),
                    (self.start + 19 * self.day, self.start + 21 * self.day)]
        times = [t for a, b in required for t in range(a, b, self.minute)]
        candles = self.source("monthly.csv", [self.start, *times])
        marks = self.source("mark.csv", times)
        parts, receipts = download.replay_partitions(self.cache, "BTCUSDT", "2024-01", candles, marks, required)
        funding = self.cache / "funding.json"
        funding.write_text(json.dumps([{"time": day + hour * 3600000, "rate": 0, "intervalHours": 8}
                                       for day in [self.start + 2 * self.day, self.start + 20 * self.day]
                                       for hour in (0, 8, 16)]))
        manifest = self.cache / "manifest.json"
        manifest.write_text(json.dumps({"planSha256": "synthetic", "symbols": {"BTCUSDT": {
            "archives": [candles, marks, *receipts], "partitions": parts, "funding": str(funding),
            "fundingSha256": download.digest(funding)}}}))
        config = copy.deepcopy(json.loads((ROOT / "crates/quant/fixtures/trend-contract.json").read_text())["defaultConfig"])
        # This is a reader compatibility check against the preserved executable,
        # not a request to run a newly introduced strategy/schema on an old binary.
        config["version"] = 8
        config["strategy"].update({"filter": "none", "tradeMinutes": 1, "breakoutBars": 2})
        configs = self.cache / "configs.json"
        configs.write_text(json.dumps([{"id": "synthetic", "config": config}]))
        for index, (start, end) in enumerate(required):
            output = self.cache / f"result-{index}.json"
            process = subprocess.run([str(binary), str(manifest), "BTCUSDT", str(configs), str(start + self.day),
                                      str(end), str(output), "synthetic"], capture_output=True, text=True, timeout=30)
            self.assertEqual(process.returncode, 0, process.stderr)
            result = json.loads(output.read_text())
            self.assertEqual(result["warmupStart"], start)
            self.assertEqual(result["results"][0]["trades"], [])
            self.assertEqual(result["results"][0]["metrics"]["finalEquity"], config["execution"]["initialCapital"])
        self.assertEqual(download.digest(binary), binary_hash)


if __name__ == "__main__":
    unittest.main()
