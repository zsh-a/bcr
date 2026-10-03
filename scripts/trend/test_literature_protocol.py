"""The new research knobs cannot leak into historical replay contracts."""
import unittest

from artifacts import read
from protocol import ROOT, Candidate, config, validate_plan, window_candidates
from warmup import warmup_days


class LiteratureProtocolTests(unittest.TestCase):
    def setUp(self):
        self.plan = read(ROOT / "research/trend/literature-plan.json")
        self.reference = self.plan["candidates"][0]

    def test_three_independent_contrasts_and_complete_cost_stress(self):
        validate_plan(self.plan)
        for candidate, expected in zip(self.plan["candidates"][1:],
                                       ["breakoutBars", "breakoutReentry", "channelExitBars"]):
            changed = {key for key in candidate if key != "id" and candidate[key] != self.reference[key]}
            self.assertEqual(changed, {expected})
        self.assertEqual(self.plan["fixedCandidate"], self.plan["baseline"])
        for window in self.plan["windows"][1:]:
            expanded = window_candidates(self.plan, window, {"id": self.plan["fixedCandidate"]})
            self.assertEqual(len(expanded), 8)
            self.assertEqual(sum(c.cost_scenario == "stress" for c in expanded), 4)

    def test_new_fields_and_long_horizon_rejected_by_legacy_versions(self):
        for version in [4, 5, 6, 7]:
            plan = {**self.plan, "configVersion": version}
            legacy = {key: value for key, value in self.reference.items()
                      if key not in ["channelExitBars", "breakoutReentry", "maxCostAtr"]}
            for key in ["channelExitBars", "breakoutReentry"]:
                with self.subTest(version=version, key=key), self.assertRaisesRegex(ValueError, "configVersion 8"):
                    config(plan, "BTCUSDT", Candidate.from_definition({**legacy, key: self.reference[key]}))
            with self.assertRaisesRegex(ValueError, "breakoutBars"):
                config(plan, "BTCUSDT", Candidate.from_definition({**legacy, "breakoutBars": 320}))
            configured = config(plan, "BTCUSDT", Candidate.from_definition(legacy))
            self.assertNotIn("channelExitBars", configured["strategy"])
            self.assertNotIn("breakoutReentry", configured["strategy"])

    def test_inactive_invalid_or_null_settings_are_not_silent_defaults(self):
        for patch in [{"channelExitBars": None}, {"channelExitBars": True},
                      {"channelExitBars": 1.5}, {"channelExitBars": 0}, {"channelExitBars": 1001},
                      {"management": "atr"}, {"breakoutReentry": None},
                      {"breakoutReentry": "sometimes"}, {"entry": "pullback"}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                config(self.plan, "BTCUSDT", Candidate.from_definition({**self.reference, **patch}))

    def test_each_active_window_controls_prehistory_with_a_hard_archive_limit(self):
        self.assertEqual([warmup_days(c) for c in self.plan["candidates"]], [1, 7, 1, 1])
        self.assertEqual(warmup_days({**self.reference, "channelExitBars": 320}), 7)
        self.assertEqual(warmup_days({**self.reference, "tradeMinutes": 1440,
                                     "breakoutBars": 250, "channelExitBars": 250}), 250)
        with self.assertRaisesRegex(ValueError, "250 days"):
            warmup_days({**self.reference, "tradeMinutes": 1440, "channelExitBars": 251})


if __name__ == "__main__":
    unittest.main()
