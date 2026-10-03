"""Candidate daily-loss ablations keep shared plans and legacy requests intact."""
import copy
import math
import unittest
from unittest.mock import patch

from artifacts import read
from protocol import (Candidate, DAY, REPLAY_VERSION, ROOT, config,
                      native_requests, recorded_candidates, timestamp, validate_plan, window_candidates)
from report import build_bundle, render_report


class RiskOverrideTests(unittest.TestCase):
    def setUp(self):
        self.plan = copy.deepcopy(read(ROOT / "research/trend/literature-plan.json"))
        rule = next(c for c in self.plan["candidates"] if c["id"] == "m30-n320-x20")
        rule = {**rule, "id": "guarded", "channelExitBars": 160}
        self.plan.update(candidates=[rule, {**rule, "id": "unguarded", "riskOverrides": {"dailyLossPct": 0}}],
                         baseline="guarded", selectionMode="ranked", stressCandidates=["guarded", "unguarded"],
                         initialCapital=20000, symbols={s: self.plan["symbols"][s] for s in ["BTCUSDT", "ETHUSDT"]},
                         comparisons=[{"id": "guard-ablation", "candidate": "unguarded", "reference": "guarded"}],
                         windows=[{"id": "development", "start": "2024-01-01", "end": "2024-02-01"},
                                  {"id": "diagnostic", "role": "diagnostic-known", "start": "2024-02-01", "end": "2024-03-01"}])
        self.plan.pop("fixedCandidate", None)
        self.plan["bootstrap"].update(samples=10, blockDays=2)
        self.selection = {"id": "unguarded", "replayVersion": REPLAY_VERSION}

    def test_override_merges_only_into_risk_and_does_not_alias_plan(self):
        before = copy.deepcopy(self.plan)
        validate_plan(self.plan)
        candidates = window_candidates(self.plan, self.plan["windows"][0])
        guarded, unguarded = [config(self.plan, "BTCUSDT", c) for c in candidates]
        self.assertEqual(guarded["strategy"], unguarded["strategy"])
        self.assertNotIn("riskOverrides", unguarded["strategy"])
        self.assertEqual(guarded["execution"], unguarded["execution"])
        self.assertEqual(unguarded["risk"], {**guarded["risk"], "dailyLossPct": 0})
        self.assertEqual(guarded["risk"], self.plan["risk"])
        unguarded["risk"]["dailyLossPct"] = .2
        guarded["risk"]["dailyLossPct"] = .4
        self.assertEqual(self.plan, before)
        self.assertEqual(candidates[1].risk_overrides, {"dailyLossPct": 0})
        candidates[1].risk_overrides["dailyLossPct"] = .1
        self.assertEqual(self.plan, before)  # Parsing copies the candidate metadata too.

    def test_numeric_boundaries_and_empty_override_preserve_native_values(self):
        for value in [0, 0.0, .03, .5]:
            definition = {**self.plan["candidates"][0], "riskOverrides": {"dailyLossPct": value}}
            candidate = Candidate.from_definition(definition)
            self.assertEqual(config(self.plan, "BTCUSDT", candidate)["risk"]["dailyLossPct"], value)
        definition = {**self.plan["candidates"][0], "riskOverrides": {}}
        self.assertEqual(config(self.plan, "BTCUSDT", Candidate.from_definition(definition)),
                         config(self.plan, "BTCUSDT", Candidate.from_definition(self.plan["candidates"][0])))

    def test_invalid_shapes_values_and_unknown_risk_keys_are_rejected(self):
        invalid = [None, False, 0, [], "disabled", {"riskPct": .001}, {"dailyLossPct": 0, "extra": 1}]
        invalid += [{"dailyLossPct": value} for value in [None, True, False, "0", [], {}, -.01, .500001,
                                                           math.inf, -math.inf, math.nan]]
        for value in invalid:
            with self.subTest(value=value):
                plan = copy.deepcopy(self.plan)
                plan["candidates"][1]["riskOverrides"] = value
                with self.assertRaisesRegex(ValueError, "riskOverrides"):
                    validate_plan(plan)
                candidate = Candidate("manual", self.plan["candidates"][0], risk_overrides=value)
                with self.assertRaisesRegex(ValueError, "riskOverrides"):
                    config(self.plan, "BTCUSDT", candidate)

    def test_stress_and_strategy_sensitivity_inherit_override(self):
        self.plan["sensitivity"] = [{"id": "wider", "stopAtr": 3}]
        validate_plan(self.plan)
        before = copy.deepcopy(self.plan)
        variants = {c.id: c for c in window_candidates(self.plan, self.plan["windows"][1], self.selection)}
        for candidate_id in ["unguarded", "unguarded-stress", "unguarded-wider"]:
            request = config(self.plan, "BTCUSDT", variants[candidate_id])
            self.assertEqual(request["risk"]["dailyLossPct"], 0)
            self.assertNotIn("riskOverrides", request["strategy"])
        self.assertEqual(config(self.plan, "BTCUSDT", variants["guarded-stress"])["risk"], self.plan["risk"])
        base = config(self.plan, "BTCUSDT", variants["unguarded"])
        stress = config(self.plan, "BTCUSDT", variants["unguarded-stress"])
        sensitivity = config(self.plan, "BTCUSDT", variants["unguarded-wider"])
        self.assertEqual(stress["strategy"], base["strategy"])
        self.assertEqual(stress["risk"], base["risk"])
        self.assertEqual(stress["execution"]["feeBps"], self.plan["costs"]["stressFeeBps"])
        self.assertEqual(sensitivity["strategy"], {**base["strategy"], "stopAtr": 3})
        self.assertEqual(sensitivity["execution"], base["execution"])
        self.assertEqual(self.plan, before)
        self.plan["sensitivity"][0]["riskOverrides"] = {"dailyLossPct": .1}
        with self.assertRaisesRegex(ValueError, "sensitivities inherit"):
            validate_plan(self.plan)

    def test_absent_override_is_identical_to_frozen_native_requests(self):
        checked = 0
        for stem in ["literature", "details"]:
            plan = read(ROOT / f"research/trend/{stem}-plan.json")
            folder = ROOT / f"tmp/trend-{stem}-v8"
            if not (folder / "selection.json").exists():
                continue
            selection = read(folder / "selection.json")
            for window in plan["windows"]:
                variants = recorded_candidates(window_candidates(plan, window, selection), selection["replayVersion"])
                for symbol in plan["symbols"]:
                    saved = read(folder / window["id"] / f"{symbol}-configs.json")
                    self.assertEqual(native_requests(plan, symbol, variants), saved)
                    checked += 1
        if not checked:
            self.skipTest("frozen local native request fixtures unavailable")
        self.assertGreaterEqual(checked, 36)

    def bundle(self):
        def raw(_evidence, window):
            variants = window_candidates(self.plan, window, self.selection)
            output = []
            for symbol in self.plan["symbols"]:
                rows = []
                for index, candidate in enumerate(variants):
                    requested = config(self.plan, symbol, candidate)
                    initial = requested["execution"]["initialCapital"]
                    start, end = timestamp(window["start"]), timestamp(window["end"])
                    daily = [{"time": t, "equity": initial + (i + 1) * (index + 1)}
                             for i, t in enumerate(range(start + DAY - 1, end, DAY))]
                    net = daily[-1]["equity"] - initial
                    rows.append({"id": candidate.id, "config": requested, "daily": daily,
                        "trades": [{"netPnl": net, "rMultiple": net / 100, "side": "long"}],
                        "metrics": {"finalEquity": daily[-1]["equity"], "totalReturn": net / initial,
                                    "trades": 1, "meanR": net / 100, "maxDrawdown": 0, "fees": 0, "funding": 0}})
                output.append({"symbol": symbol, "results": rows})
            return output, []
        evidence = {"plan": self.plan, "selection": self.selection, "engine": "synthetic",
                    "planSha256": "synthetic", "manifestSha256": "synthetic",
                    "manifest": {"symbols": {s: {"archives": []} for s in self.plan["symbols"]}}}
        with patch("report.audit_window", side_effect=raw):
            return build_bundle(evidence)[0]

    def test_report_records_effective_risk_and_does_not_match_another_guard_stress(self):
        self.plan["sensitivity"] = [{"id": "wider", "stopAtr": 3}]
        bundle = self.bundle()
        for rows in bundle["summaries"].values():
            for row in rows:
                expected = 0 if row["id"].startswith("unguarded") else self.plan["risk"]["dailyLossPct"]
                self.assertEqual(row["risk"]["dailyLossPct"], expected)
                self.assertEqual(row["riskOverrides"], {"dailyLossPct": 0} if expected == 0 else {})
                self.assertNotIn("riskOverrides", row["strategy"])
        output = render_report(bundle)
        self.assertIn("| guarded | 3.00% | 继承计划 |", output)
        self.assertIn("| unguarded | 关闭（0） | 候选覆盖 |", output)
        self.assertIn("0 表示关闭日亏损保护", output)
        self.assertIn("跨日持仓可能在仍盈利时触发", output)
        section = output.split("## 同风险预算的基线比较", 1)[1].split("## 事前声明的机制比较", 1)[0]
        # The guarded stress is first and has exactly the same strategy. Only
        # the selected risk policy identifies the correct 1.16% stress result.
        self.assertIn("| diagnostic | 0.29% | 0.58% | 1.16% |", section)
        self.assertNotIn("| diagnostic | 0.29% | 0.58% | 0.87% |", section)


if __name__ == "__main__":
    unittest.main()
