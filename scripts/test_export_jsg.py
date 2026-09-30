"""Offline tests for the ClickHouse → Arrow boundary. Run after installing requirements-jsg.txt."""
import datetime as dt
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa

spec = importlib.util.spec_from_file_location("export_jsg", Path(__file__).with_name("export-jsg.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ResearchExportTest(unittest.TestCase):
    def test_calendar_uses_full_exchange_week_beyond_end(self):
        # Friday is a holiday: Thursday really is this week's last exchange session.
        dates = [dt.date(2024, 1, 1) + dt.timedelta(days=i) for i in range(40)]
        dates = [date for date in dates if date.weekday() < 5 and date != dt.date(2024, 2, 2)]
        calendar = [{"date": date.isoformat()} for date in dates]
        sessions, start, end = exporter.sessions(calendar, dt.date(2024, 1, 31), dt.date(2024, 1, 31), 20)
        self.assertFalse(sessions[-1]["rebalance"])
        sessions, _, _ = exporter.sessions(calendar, dt.date(2024, 1, 31), dt.date(2024, 2, 1), 20)
        self.assertTrue(sessions[-1]["rebalance"])
        self.assertEqual(start, end)
        self.assertEqual(len(sessions), 22)

    def test_calendar_rejects_insufficient_warmup_and_missing_future(self):
        calendar = [{"date": "2024-01-01"}, {"date": "2024-01-02"}]
        with self.assertRaisesRegex(ValueError, "warmup"):
            exporter.sessions(calendar, dt.date(2024, 1, 2), dt.date(2024, 1, 2), 20)
        with self.assertRaisesRegex(ValueError, "extend"):
            exporter.sessions(calendar, dt.date(2024, 1, 2), dt.date(2024, 1, 2), 1)

    def test_clickhouse_batches_split_across_days_are_reassembled(self):
        table = pa.table({"date": [20240101, 20240101, 20240102, 20240102, 20240102], "code": ["a", "b", "a", "b", "c"]})
        batches = [table.slice(0, 1).to_batches()[0], table.slice(1, 2).to_batches()[0], table.slice(3).to_batches()[0]]
        daily = list(exporter.daily_batches(iter(batches)))
        self.assertEqual([date for date, _ in daily], [20240101, 20240102])
        self.assertEqual([day.num_rows for _, day in daily], [2, 3])
        self.assertEqual(daily[1][1]["code"].to_pylist(), ["a", "b", "c"])
        backwards = [table.slice(2).to_batches()[0], table.slice(0, 2).to_batches()[0]]
        with self.assertRaisesRegex(ValueError, "order"):
            list(exporter.daily_batches(iter(backwards)))

    def test_normalized_batches_have_exact_rust_schema_and_bounded_partitions(self):
        arrays = {
            "date": [20240101, 20240101], "code": ["a", "b"], "industry_code": ["tech", "unknown"],
            **{field: [10.0, 10.0] for field in ("open", "high", "low", "close", "preclose", "adjfactor", "profit", "shares")},
            **{field: [0, 1] for field in ("is_st", "tradable", "breadth_member", "selection_member")},
        }
        batch = exporter.normalize(pa.table(arrays), {"a": 0, "b": 1}, {"tech": 0, "unknown": 1})
        self.assertEqual(batch.schema, exporter.SCHEMA)
        with tempfile.TemporaryDirectory() as folder:
            parts, days = exporter.write_partitions(Path(folder), ((20240100 + i, batch) for i in range(1, 6)), 2)
            self.assertEqual([p["rows"] for p in parts], [4, 4, 2])
            self.assertEqual(days, [20240101, 20240102, 20240103, 20240104, 20240105])
            for part in parts:
                path = Path(folder) / part["file"]
                self.assertEqual(path.stat().st_size, part["bytes"])
                self.assertLess(part["bytes"], exporter.MAX_BYTES)
                with pa.ipc.open_stream(path) as reader:
                    self.assertEqual(sum(b.num_rows for b in reader), part["rows"])

    def test_ipc_stream_can_be_read_without_loading_all_partitions(self):
        out = io.BytesIO()
        batch = pa.record_batch([pa.array([1, 2], pa.uint32())], names=["date"])
        with pa.ipc.new_stream(out, batch.schema) as writer:
            writer.write_batch(batch)
        out.seek(0)
        self.assertEqual(next(pa.ipc.open_stream(out)).num_rows, 2)


if __name__ == "__main__":
    unittest.main()
