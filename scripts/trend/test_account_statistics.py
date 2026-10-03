"""Shared account statistics keep calendar, pairing, and provenance contracts."""
import copy
from pathlib import Path
import unittest
from unittest.mock import patch

from account_statistics import account_window, paired_bootstrap
from artifacts import source_fingerprint
import mechanism_evaluation
import search_evaluation
import transfer_evaluation
from test_transfer_evaluation import batch_fixture, plan_fixture


class AccountStatisticsTests(unittest.TestCase):
    def test_named_pairs_share_draws_keep_window_lengths_and_subtract_left_minus_right(self):
        # Two independent windows; the same sampled dates must serve both columns.
        windows = [{"times": [1, 2], "returns": {"left": [1, 3], "right": [0, 2]}},
                   {"times": [10, 11, 12], "returns": {"left": [10, 20, 30], "right": [9, 19, 29]}}]
        with patch("account_statistics.random.Random") as constructor:
            rng = constructor.return_value
            # Replicate 1: [1,0] / [2,0,2]; replicate 2: [0,1] / [0,1,0].
            rng.randrange.side_effect = [1, 2, 2, 0, 0, 0]
            value = paired_bootstrap(windows, ("left", "right"),
                                     {"increment": ("left", "right")}, 2, 2, 17)
        self.assertEqual([call.args[0] for call in rng.randrange.call_args_list], [2, 3, 3] * 2)
        self.assertEqual(value["days"], 5)
        self.assertEqual(value["absolute"]["left"], {"meanDailyReturn": 12.8,
                                                    "meanDailyReturn95CI": [8.8, 14.8]})
        self.assertEqual(value["paired"]["increment"], {"meanDailyReturn": 1.0,
                                                       "meanDailyReturn95CI": [1.0, 1.0]})

    def test_missing_nonfinite_or_unpaired_observations_cannot_be_dropped(self):
        valid = [{"times": [1, 2], "returns": {"a": [0, .1], "b": [.2, .3]}}]
        variants = []
        for mutation in (lambda w: w[0]["returns"].pop("b"),
                         lambda w: w[0]["returns"]["b"].pop(),
                         lambda w: w[0]["returns"]["a"].__setitem__(0, None),
                         lambda w: w[0]["returns"]["a"].__setitem__(0, float("nan"))):
            value = copy.deepcopy(valid)
            mutation(value)
            variants.append(value)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ValueError):
                paired_bootstrap(value, ("a", "b"), {"change": ("a", "b")}, 2, 1, 17)
        with self.assertRaisesRegex(ValueError, "declared series"):
            paired_bootstrap(valid, ("a", "b"), {"change": ("a", "missing")}, 2, 1, 17)

    def test_account_window_includes_initial_capital_first_day_and_rejects_missing_dates(self):
        plan = plan_fixture()
        window = plan["windows"][1]
        batches = batch_fixture(plan, window)
        compact, daily = account_window(plan, batches, "selected", window)
        self.assertEqual(compact["initialCapital"], 200)
        self.assertEqual(compact["days"], 31)
        self.assertAlmostEqual(daily["returns"][0], .002)
        self.assertEqual(len(daily["returns"]), 31)
        for batch in batches:
            row = batch["results"][0]
            row["daily"].pop(0)
            row["metrics"]["evaluation"]["daily"].pop(0)
        with self.assertRaisesRegex(ValueError, "calendar"):
            account_window(plan, batches, "selected", window)

    def test_each_evaluator_fingerprint_binds_shared_statistics_source(self):
        modules = (transfer_evaluation, mechanism_evaluation, search_evaluation)
        with patch("artifacts.sha", return_value="original"):
            before = [source_fingerprint(*module.SOURCES) for module in modules]
        with patch("artifacts.sha", side_effect=lambda path: "changed" if Path(path).name == "account_statistics.py" else "original"):
            after = [source_fingerprint(*module.SOURCES) for module in modules]
        for module, first, second in zip(modules, before, after):
            with self.subTest(module=module.__name__):
                self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
