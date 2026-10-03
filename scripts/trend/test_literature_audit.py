"""Counterexamples for the independent channel/episode evidence checks."""
import copy
import unittest

import numpy as np

from literature_audit import MINUTE, PERIOD, compare_baseline, episode_starts, first_mechanical_exit, prior_low


def candles(closes):
    return np.asarray([[i * PERIOD, c, c + 1, c - 1, c, 1] for i, c in enumerate(closes)], dtype=float)


class LiteratureAuditTests(unittest.TestCase):
    def test_episode_uses_frozen_boundary_and_does_not_consume_warmup(self):
        bars = candles([101] * 13 + [101, 103, 99, 101, 102])
        upper = np.asarray([100] * len(bars), dtype=float)
        # Candle 13 breaks in warmup; the first active bar can still open.
        starts, stats = episode_starts(bars, upper, 1, 14 * PERIOD, 18 * PERIOD)
        self.assertEqual(starts, {15 * PERIOD - 1: 100, 17 * PERIOD - 1: 100})
        self.assertEqual(stats, {"rawQualifyingCloses": 3, "resets": 1, "episodes": 2})
        # A rolling high above the close cannot rearm the frozen episode.
        upper[17] = 104
        starts, _ = episode_starts(bars, upper, 1, 14 * PERIOD, 18 * PERIOD)
        self.assertEqual(len(starts), 2)

    def test_unlock_bar_cannot_start_a_new_episode_at_lower_rolling_high(self):
        bars = candles([101] * 13 + [101, 100, 100])
        upper = np.asarray([100] * 14 + [98, 98], dtype=float)
        starts, stats = episode_starts(bars, upper, 1, 13 * PERIOD, 16 * PERIOD)
        self.assertEqual(list(starts), [14 * PERIOD - 1, 16 * PERIOD - 1])
        self.assertEqual(stats["rawQualifyingCloses"], 3)
        self.assertEqual(stats["resets"], 1)

    def test_firsts_ignore_position_availability_so_later_close_is_ineligible(self):
        bars = candles([101] * 17)
        starts, _ = episode_starts(bars, np.full(17, 100.0), 1, 13 * PERIOD, 17 * PERIOD)
        # Even if the account was holding at candle 13, candle 14 is not a first.
        self.assertEqual(list(starts), [14 * PERIOD - 1])
        self.assertNotIn(15 * PERIOD - 1, starts)

    def test_exit_window_excludes_current_and_can_be_independent_of_entry(self):
        bars = candles([100, 80, 100, 100, 100, 1])
        self.assertEqual(prior_low(bars, 2)[5], 99)
        self.assertEqual(prior_low(bars, 4)[5], 79)

    def test_pending_channel_beats_same_open_gap_but_not_prior_minute_stop(self):
        rows = np.asarray([[i * MINUTE, 100, 102, 99, 100, 1, (i + 1) * MINUTE - 1]
                           for i in range(60)], dtype=float)
        bars = candles([100, 100])
        bars[0, 4] = 98
        lower = np.asarray([99.0, 99.0])
        trade = {"entryTime": 0, "exitTime": PERIOD, "initialStop": 95}
        rows[30, 1], rows[30, 3] = 94, 93
        self.assertEqual(first_mechanical_exit(rows, bars, lower, trade), (PERIOD, "channel-exit", 94))
        rows[29, 3] = 94
        self.assertEqual(first_mechanical_exit(rows, bars, lower, trade), (PERIOD - 1, "initial", 95))

    def test_baseline_regression_checks_metrics_and_all_trade_fields(self):
        old = {"trades": [{"netPnl": 1, "entrySignal": {"boundary": 20}}],
               "daily": [{"equity": 10001}], "metrics": {"finalEquity": 10001}, "warmupStart": 0,
               "config": {"execution": {}, "risk": {}, "strategy": {"breakoutBars": 40}}}
        new = copy.deepcopy(old)
        new["config"]["strategy"].update(channelExitBars=20, breakoutReentry="every-close")
        compare_baseline(new, old)
        for key in ["trades", "daily", "metrics"]:
            changed = copy.deepcopy(new)
            changed[key] = []
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                compare_baseline(changed, old)


if __name__ == "__main__":
    unittest.main()
