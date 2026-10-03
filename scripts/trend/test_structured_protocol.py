"""Research/native configuration boundaries for the structured pullback hypothesis."""
import copy
import unittest

from artifacts import read
from protocol import Candidate, ROOT, config
from warmup import warmup_days


class StructuredProtocolTests(unittest.TestCase):
    def setUp(self):
        self.plan = copy.deepcopy(read(ROOT / "research/trend/search-plan.json"))
        self.plan["configVersion"] = 9
        self.strategy = {
            "entry": "structured-pullback", "filter": "ema", "management": "chandelier",
            "direction": "both", "tradeMinutes": 30, "breakoutBars": 20,
            "stopAtr": 2, "breakEvenAtr": 0, "trailingAtr": 3, "maxCostAtr": 0,
            "structuredPullback": {"keyLevel": "either", "shape": "any", "candle": "none"},
        }

    def compile(self, strategy=None):
        return config(self.plan, "BTCUSDT", Candidate("primary", strategy or self.strategy))

    def test_policy_survives_native_boundary_and_all_ablations_share_warmup(self):
        for key in ["none", "pivot", "validated-ema", "either"]:
            for shape in ["none", "any", "two-legs", "wedge", "channel", "double-test"]:
                s = {**self.strategy, "structuredPullback": {"keyLevel": key, "shape": shape, "candle": "none"}}
                self.assertEqual(self.compile(s)["strategy"]["structuredPullback"], s["structuredPullback"])
                self.assertEqual(warmup_days(s), 4)
        self.assertEqual(warmup_days({**self.strategy, "filter": "none"}), 4)

    def test_new_rule_cannot_masquerade_as_historical_version(self):
        for version in range(4, 9):
            self.plan["configVersion"] = version
            with self.subTest(version=version), self.assertRaises(ValueError):
                self.compile()

    def test_policy_is_exact_typed_and_bound_to_its_entry(self):
        policy = self.strategy["structuredPullback"]
        for value in [None, {}, {**policy, "threshold": 1}, {**policy, "shape": True},
                      {**policy, "keyLevel": []}, {**policy, "candle": "magic"}]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "structured-pullback"):
                self.compile({**self.strategy, "structuredPullback": value})
        with self.assertRaisesRegex(ValueError, "omit structuredPullback"):
            self.compile({**self.strategy, "entry": "breakout"})
        with self.assertRaisesRegex(ValueError, "break-even"):
            self.compile({**self.strategy, "breakEvenAtr": 1})
        with self.assertRaisesRegex(ValueError, "omit staged"):
            self.compile({**self.strategy, "staged": {"breakEvenR": 0, "trailingStartR": 0}})

    def test_old_price_action_warmup_is_unchanged(self):
        old = {**self.strategy, "entry": "price-action", "filter": "slow-ema", "tradeMinutes": 5}
        self.assertEqual(warmup_days(old), 1)
        old["tradeMinutes"] = 30
        self.assertEqual(warmup_days(old), 2)

    def test_v10_semantics_are_explicit_and_cannot_leak_into_v9(self):
        original = copy.deepcopy(self.strategy)
        for confirmation in ["before-breakout", "signal-close"]:
            for role in ["pullback-retest", "impulse-context"]:
                policy = {**original["structuredPullback"], "confirmation": confirmation, "keyRole": role}
                strategy = {**original, "structuredPullback": policy}
                self.plan["configVersion"] = 10
                self.assertEqual(self.compile(strategy)["strategy"]["structuredPullback"], policy)
                self.assertEqual(warmup_days(strategy), 4)
                self.plan["configVersion"] = 9
                with self.assertRaisesRegex(ValueError, "configuration version"):
                    self.compile(strategy)
        self.assertEqual(self.compile()["strategy"], original)
        self.plan["configVersion"] = 10
        with self.assertRaisesRegex(ValueError, "configuration version"):
            self.compile(original)
        for field, value in [("confirmation", None), ("confirmation", "intrabar"),
                             ("keyRole", True), ("keyRole", "look-ahead")]:
            invalid = {**policy, field: value}
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, "configuration version"):
                self.compile({**original, "structuredPullback": invalid})


if __name__ == "__main__":
    unittest.main()
