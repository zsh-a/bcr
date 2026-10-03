"""Membership time, exclusions and coverage are enforced independently of prices."""
import copy
import unittest

from universe import instant, validate_universe_snapshot


class UniverseTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {"kind": "trend-universe-snapshot", "version": 1, "venue": "binance-usdt-perpetual",
                         "observedAt": "2020-01-01T00:00:00Z", "availableAt": "2020-01-01T01:00:00Z",
                         "source": {"uri": "archive://fixture", "sha256": "a" * 64},
                         "coverage": {"complete": True, "missingSymbols": []},
                         "members": [{"symbol": "A", "eligible": True, "reason": "trading"},
                                     {"symbol": "B", "eligible": False, "reason": "not trading"}]}

    def test_asof_availability_is_distinct_from_observation_time(self):
        before = instant("2020-01-01T00:30:00Z")
        with self.assertRaisesRegex(ValueError, "not available"):
            validate_universe_snapshot(self.snapshot, ["A"], before)
        result = validate_universe_snapshot(self.snapshot, ["A"], instant("2020-01-01T01:00:00Z"))
        self.assertEqual((result["members"], result["eligible"]), (2, 1))

    def test_excluded_and_absent_symbols_cannot_be_selected(self):
        for selected in (["B"], ["C"]):
            with self.subTest(selected=selected), self.assertRaisesRegex(ValueError, "missing or ineligible"):
                validate_universe_snapshot(self.snapshot, selected, instant("2021-01-01T00:00:00Z"))

    def test_missing_coverage_ambiguous_time_and_duplicate_members_fail_closed(self):
        cases = [
            lambda s: s["coverage"].update(complete=False),
            lambda s: s["coverage"].update(missingSymbols=["C"]),
            lambda s: s.update(availableAt="2020-01-01T01:00:00"),
            lambda s: s["members"].append(s["members"][0]),
        ]
        for mutate in cases:
            value = copy.deepcopy(self.snapshot)
            mutate(value)
            with self.assertRaises(ValueError):
                validate_universe_snapshot(value, ["A"], instant("2021-01-01T00:00:00Z"))


if __name__ == "__main__":
    unittest.main()
