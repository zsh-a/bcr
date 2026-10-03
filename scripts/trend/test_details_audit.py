"""Synthetic counterexamples for the details study's executed-trade audit."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from artifacts import sha
from details_audit import MINUTE, PERIOD, Sources, audit_row, compare_baseline, first_mechanical_exit
from literature_audit import prior_low
from breakout_study import prior_high

BASE = 1_735_689_600_000  # 2025-01-01 UTC; synthetic values only.


def ledger(side="short", stop_atr=3):
    """Hand-priced one-trade ledger: ATR=2, tick=.1, fee/slip=1% each.

    Positive/negative funding uses mark 200, deliberately far from trade
    prices. A large entry-minute funding event must not charge a new position.
    """
    long = side == "long"
    rows = np.asarray([[i * MINUTE, 100, 101, 99, 100, 1, (i + 1) * MINUTE - 1]
                       for i in range(16 * 30)], dtype=float)
    rows[14 * 30:15 * 30, 1:5] = [100, 102, 100, 100] if long else [100, 100, 98, 100]
    rows[15 * 30 - 1, 4] = 102 if long else 98
    rows[15 * 30:, 1:5] = [103, 104, 102, 103] if long else [97, 98, 96, 97]
    rows[-1, 2:5] = [111, 102, 110] if long else [98, 89, 90]
    rows[:, [0, 6]] += BASE
    marks = rows.copy()
    marks[:, 1:5] = 200
    entry_time, end = BASE + 15 * PERIOD, BASE + 16 * PERIOD
    funding = [{"time": entry_time, "rate": .5},
               {"time": entry_time + MINUTE, "rate": .01},
               {"time": end - MINUTE, "rate": -.005}]
    # Hand calculations include adverse tick rounding on both fills.
    entry, exit_price = (104.1, 108.9) if long else (96, 90.9)
    quantity = 5 if stop_atr == 3 else 7
    stop = (98.1 if stop_atr == 3 else 100.1) if long else (102 if stop_atr == 3 else 100)
    gross, fees, funding_paid, net, slip = {
        ("long", 3): (24, 10.65, 5, 8.35, 11),
        ("short", 3): (25.5, 9.345, -5, 21.155, 9.5),
        ("long", 2): (33.6, 14.91, 7, 11.69, 15.4),
        ("short", 2): (35.7, 13.083, -7, 29.617, 13.3),
    }[(side, stop_atr)]
    initial_risk = 30 if stop_atr == 3 else 28
    trade = {"id": 1, "side": side, "entryTime": entry_time, "exitTime": end - 1,
             "entrySignal": {"time": entry_time - 1, "price": 102 if long else 98, "atr": 2,
                             "boundary": 101 if long else 99, "lookbackBars": 14},
             "entryPrice": entry, "exitPrice": exit_price, "initialStop": stop,
             "quantity": quantity, "grossPnl": gross, "fees": fees, "funding": funding_paid,
             "netPnl": net, "risk": initial_risk, "rMultiple": net / initial_risk,
             "slippageAndRounding": slip, "reason": "end-range"}
    row = {"id": "synthetic", "warmupStart": BASE,
           "config": {"version": 8,
                      "strategy": {"tradeMinutes": 30, "entry": "breakout", "direction": "both",
                                   "filter": "none", "management": "channel", "breakoutBars": 14,
                                   "channelExitBars": 2, "stopAtr": stop_atr, "breakEvenAtr": 0,
                                   "maxCostAtr": 0, "breakoutReentry": "every-close"},
                      "execution": {"initialCapital": 10000, "tickSize": .1, "quantityStep": 1,
                                    "minNotional": 1, "feeBps": 100, "slippageBps": 100},
                      "risk": {"riskPct": .005, "maxExposurePct": .95, "flattenMinute": None}},
           "trades": [trade], "metrics": {"finalEquity": 10000 + net},
           "daily": [{"time": end - 1, "equity": 10000 + net}]}
    return row, {"startTime": BASE + 14 * PERIOD, "endTime": end}, rows, marks, funding


class DetailsAuditTests(unittest.TestCase):
    def test_mirrored_breakout_fills_stop2_stop3_and_signed_funding(self):
        for side in ("long", "short"):
            for stop_atr in (2, 3):
                with self.subTest(side=side, stop_atr=stop_atr):
                    counts = audit_row(*ledger(side, stop_atr))
                    self.assertEqual(counts["trades"], 1)
                    self.assertEqual(counts["side:" + side], 1)

    def test_every_price_risk_and_cost_identity_is_checked(self):
        mutations = [
            ("entryPrice", 97, "adverse entry"),
            ("initialStop", 100, "initial stop"),
            ("quantity", 6, "quantity"),
            ("funding", 5, "funding"),
            ("fees", 0, "fees"),
            ("risk", 45.455, "initial R"),
            ("netPnl", 21.155 - 9.5, "net PnL"),  # Slippage is already in fills.
            ("slippageAndRounding", -9.5, "slippage attribution"),
            ("exitTime", BASE + 16 * PERIOD - 2, "terminal exit"),
        ]
        for key, value, message in mutations:
            args = ledger()
            args[0]["trades"][0][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, message):
                audit_row(*args)

    def test_short_signal_excludes_current_low_and_uses_complete_signal_atr(self):
        # The signal bar's own low is 98, but prior-N low is 99.
        for key, value, message in [("boundary", 98, "previous N boundary"),
                                     ("atr", 2.5, "signal ATR"),
                                     ("lookbackBars", 13, "lookback"),
                                     ("time", BASE + 15 * PERIOD - 2, "next-open")]:
            args = ledger()
            args[0]["trades"][0]["entrySignal"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, message):
                audit_row(*args)

    def test_cash_budget_is_before_entry_fee_and_exposure_cap_includes_fee(self):
        args = ledger("long")
        # Unit loss 7 + roundtrip fee 2.012. Exactly enough for 5 units.
        args[0]["config"]["risk"]["riskPct"] = 45.06 / 10000
        audit_row(*args)
        # Independently bind the notional cap at exactly 5 units incl entry fee.
        args = ledger("long")
        args[0]["config"]["risk"]["maxExposurePct"] = 525.705 / 10000
        audit_row(*args)
        args[0]["config"]["risk"]["maxExposurePct"] = 525 / 10000
        with self.assertRaisesRegex(ValueError, "quantity"):
            audit_row(*args)

    def test_funding_excludes_entry_minute_and_includes_exit_minute(self):
        args = ledger()
        # Changing entry-minute funding has no effect on this new position.
        args[-1][0]["rate"] = -.9
        audit_row(*args)
        # Removing the exit-minute negative rate changes cash and must fail.
        args[-1].pop()
        with self.assertRaisesRegex(ValueError, "funding"):
            audit_row(*args)

    def test_direction_and_executed_cost_gate_are_not_silently_ignored(self):
        args = ledger()
        args[0]["config"]["strategy"]["direction"] = "long"
        with self.assertRaisesRegex(ValueError, "direction"):
            audit_row(*args)
        args = ledger("long")
        args[0]["config"]["strategy"].update(filter="background", maxCostAtr=3)
        self.assertEqual(audit_row(*args)["costGateTrades"], 1)
        args[0]["config"]["strategy"]["maxCostAtr"] = .2
        with self.assertRaisesRegex(ValueError, "cost gate"):
            audit_row(*args)

    def test_channel_priority_mirrors_short_and_ignores_pre_entry_close(self):
        for side in ("long", "short"):
            long = side == "long"
            minutes = np.asarray([[i * MINUTE, 100, 102, 98, 100, 1, (i + 1) * MINUTE - 1]
                                  for i in range(90)], dtype=float)
            bars = np.asarray([[i * PERIOD, 100, 103, 97, 98 if long else 102, 1]
                               for i in range(3)], dtype=float)
            boundary = np.full(3, 99 if long else 101)
            trade = {"side": side, "entryTime": PERIOD, "exitTime": 2 * PERIOD,
                     "initialStop": 95 if long else 105}
            minutes[60, 1] = 94 if long else 106
            minutes[60, 3 if long else 2] = 93 if long else 107
            # Candle before entry cannot queue this trade's exit at entryTime.
            self.assertEqual(first_mechanical_exit(minutes, bars, boundary, trade),
                             (2 * PERIOD, "channel-exit", 94 if long else 106))
            minutes[59, 3 if long else 2] = 94 if long else 106
            self.assertEqual(first_mechanical_exit(minutes, bars, boundary, trade),
                             (2 * PERIOD - 1, "initial", 95 if long else 105))

    def test_channel_is_strict_and_exit_lookback_is_independent(self):
        bars = np.asarray([[i * PERIOD, 100, h, l, 100, 1]
                           for i, (h, l) in enumerate([(101, 99), (120, 80), (101, 99),
                                                      (101, 99), (101, 99), (130, 70)])], dtype=float)
        self.assertEqual((prior_high(bars, 2)[5], prior_high(bars, 4)[5]), (101, 120))
        self.assertEqual((prior_low(bars, 2)[5], prior_low(bars, 4)[5]), (99, 80))
        minutes = np.asarray([[i * MINUTE, 100, 101, 99, 100, 1, (i + 1) * MINUTE - 1]
                              for i in range(60)], dtype=float)
        for side in ("long", "short"):
            trade = {"side": side, "entryTime": 0, "exitTime": PERIOD,
                     "initialStop": 90 if side == "long" else 110}
            self.assertIsNone(first_mechanical_exit(minutes, bars[:2], np.full(2, 100), trade))

    def test_baseline_requires_exact_v8_configuration_warmup_and_ledger(self):
        original = ledger()[0]
        same = copy.deepcopy(original)
        same["id"] = "renamed-only"
        compare_baseline(same, original)
        for key in ("config", "warmupStart", "trades", "daily", "metrics"):
            changed = copy.deepcopy(same)
            changed[key] = None
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                compare_baseline(changed, original)

    def sliced_manifest(self, folder):
        # Two continuous required slices in one month. Missing middle minutes
        # are outside either window, not silently filled or joined across gaps.
        lines = {i: f"{BASE + i * MINUTE},100,101,99,100,1,{BASE + (i + 1) * MINUTE - 1}\n"
                 for i in (0, 1, 4, 5)}
        source = folder / "original.csv"
        source.write_text("".join(lines.values()))
        parent = {"path": str(source), "csvSha256": sha(source)}
        archives, partitions = [parent], []
        for start, end in ((0, 2), (4, 6)):
            path = folder / f"slice-{start}.csv"
            path.write_text("".join(lines[i] for i in range(start, end)))
            archives.append({"path": str(path), "csvSha256": sha(path), "sources": [parent],
                             "validation": {"policy": "continuous-replay-interval-v1",
                                            "intervals": [{"start": BASE + start * MINUTE,
                                                           "end": BASE + end * MINUTE}]}})
            partitions.append({"month": "2025-01", "candles": str(path), "marks": str(path)})
        funding = folder / "funding.json"
        funding.write_text(json.dumps([{"time": BASE + i * MINUTE, "rate": .001, "intervalHours": 8}
                                       for i in (0, 4)]))
        return {"symbols": {"TEST": {"archives": archives, "partitions": partitions,
                                     "funding": str(funding), "fundingSha256": sha(funding)}}}

    def test_multiple_same_month_slices_preserve_actual_window_coverage(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = self.sliced_manifest(Path(folder))
            sources = Sources(manifest)
            minutes, marks, _ = sources.load("TEST", BASE + 4 * MINUTE, BASE + 4 * MINUTE, BASE + 6 * MINUTE)
            self.assertEqual(minutes[:, 0].tolist(), [BASE + 4 * MINUTE, BASE + 5 * MINUTE])
            self.assertTrue(np.array_equal(minutes[:, 0], marks[:, 0]))
            self.assertEqual(len(sources.verified), 4)  # Funding, two slices, original.
            with self.assertRaisesRegex(ValueError, "missing"):
                sources.load("TEST", BASE, BASE, BASE + 6 * MINUTE)

    def test_slice_hash_alone_cannot_hide_changed_prices_or_parent(self):
        for target in ("slice", "parent"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as folder:
                manifest = self.sliced_manifest(Path(folder))
                record = manifest["symbols"]["TEST"]["archives"][1]
                path = Path(record["path"] if target == "slice" else record["sources"][0]["path"])
                path.write_text(path.read_text().replace(",100,101,99,100,", ",100,102,99,100,"))
                if target == "slice":
                    record["csvSha256"] = sha(path)
                with self.assertRaisesRegex(ValueError, "exact declared source|checksum mismatch"):
                    Sources(manifest).verify(record["path"], record["csvSha256"])


if __name__ == "__main__":
    unittest.main()
