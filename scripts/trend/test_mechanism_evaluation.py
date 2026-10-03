"""Fixed mechanism contrasts: audited inputs, paired dates and no winner selection."""
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from mechanism_evaluation import evaluate, run, settings_for
from test_transfer_evaluation import batch_fixture, plan_fixture


def mechanism_plan():
    plan = plan_fixture()
    del plan["transferEvaluation"]
    plan.update(selectionMode="fixed", fixedCandidate="baseline",
                candidates=[{"id": name} for name in ["baseline", "selected", "other"]],
                comparisons=[{"id": "first-contrast", "candidate": "selected", "reference": "baseline"},
                             {"id": "second-contrast", "candidate": "other", "reference": "baseline"}],
                mechanismEvaluation={"primary": "baseline", "groups": [{"id": "pooled", "windows": ["first", "second"]},
                                     {"id": "recent", "windows": ["second"]}],
                                     "samples": 80, "seed": 20261003, "blockDays": [7, 28],
                                     "method": "Shared-date circular blocks within each window"})
    return plan


def batches_for(plan, rates=None):
    rates = rates or {"baseline": .001, "baseline-stress": .0005,
                      "selected": .002, "selected-stress": .0015,
                      "other": -.001, "other-stress": -.002}
    return {window["id"]: batch_fixture(plan, window, rates) for window in plan["windows"][1:]}


class MechanismEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.plan = mechanism_plan()
        self.batches = batches_for(self.plan)

    def test_strict_frozen_settings_reject_ambiguous_or_unsupported_parameters(self):
        self.assertEqual(settings_for(self.plan)["primary"], "baseline")
        mutations = [lambda p: p["mechanismEvaluation"].update(extraGate=True),
                     lambda p: p["mechanismEvaluation"].update(primary="missing"),
                     lambda p: p.update(selectionMode="ranked"),
                     lambda p: p.update(fixedCandidate="selected"),
                     lambda p: p["mechanismEvaluation"].update(samples=True),
                     lambda p: p["mechanismEvaluation"].update(samples=0),
                     lambda p: p["mechanismEvaluation"].update(seed=False),
                     lambda p: p["mechanismEvaluation"].update(blockDays=[7, 7]),
                     lambda p: p["mechanismEvaluation"].update(blockDays=[0]),
                     lambda p: p["mechanismEvaluation"].update(method="  "),
                     lambda p: p["mechanismEvaluation"].update(groups=[]),
                     lambda p: p["mechanismEvaluation"]["groups"][1].update(id="pooled"),
                     lambda p: p["mechanismEvaluation"]["groups"][0].update(windows=["first", "first"]),
                     lambda p: p["mechanismEvaluation"]["groups"][0].update(windows=["missing"])]
        for mutation in mutations:
            plan = copy.deepcopy(self.plan)
            mutation(plan)
            with self.subTest(plan=plan["mechanismEvaluation"]), self.assertRaises(ValueError):
                settings_for(plan)

    def test_groups_reject_development_overlap_and_partial_dates(self):
        mutations = [lambda p: p["mechanismEvaluation"]["groups"][0].update(windows=["development"]),
                     lambda p: p["windows"][1].update(start="2019-01-15", end="2019-03-01"),
                     lambda p: p["windows"][2].update(start="2020-01-15"),
                     lambda p: p["windows"][1].update(start="2020-01-01T12:00:00Z"),
                     lambda p: p["windows"][1].update(end="2020-01-01")]
        for mutation in mutations:
            plan = copy.deepcopy(self.plan)
            mutation(plan)
            with self.subTest(plan=plan["windows"]), self.assertRaises(ValueError):
                settings_for(plan)
        # Development role, not its spelling, controls this boundary.
        self.plan["windows"][0]["id"] = "train"
        self.plan["mechanismEvaluation"]["groups"][0]["windows"] = ["train"]
        with self.assertRaisesRegex(ValueError, "development"):
            settings_for(self.plan)

    def test_every_comparison_must_use_the_declared_primary_and_be_unique(self):
        mutations = [lambda p: p.update(comparisons=[]),
                     lambda p: p["comparisons"][0].update(reference="other"),
                     lambda p: p["comparisons"][0].update(candidate="baseline"),
                     lambda p: p["comparisons"][0].update(candidate="missing"),
                     lambda p: p["comparisons"][1].update(candidate="selected"),
                     lambda p: p["comparisons"][1].update(id="first-contrast")]
        for mutation in mutations:
            plan = copy.deepcopy(self.plan)
            mutation(plan)
            with self.assertRaises(ValueError):
                settings_for(plan)

    def test_descriptive_results_keep_winning_and_losing_contrasts_without_reselection(self):
        result = evaluate(self.plan, self.batches)
        self.assertEqual(result["status"], "descriptive-only")
        self.assertEqual(result["primary"], "baseline")
        self.assertFalse(result["selectionRecomputed"])
        self.assertNotIn("acceptance", result)
        group = result["groups"][0]
        self.assertEqual(group["days"], 90)
        self.assertEqual([row["candidate"] for row in group["comparisons"]], ["selected", "other"])
        for comparison, expected in zip(group["comparisons"], [.001, -.002]):
            for interval in comparison["bootstrap"]:
                self.assertAlmostEqual(interval["paired"]["base"]["meanDailyReturn"], expected)
        account = group["windows"][0]["accounts"]["other"]["stress"]
        self.assertLess(account["return"], 0)
        self.assertEqual(account["tradesBySymbol"], {"A": 1, "B": 1})

    def test_all_contrasts_and_costs_share_dates_and_paired_sign_is_comparator_minus_primary(self):
        for window in self.plan["windows"][1:]:
            n = len(self.batches[window["id"]][0]["results"][0]["daily"])
            x = [(-.015, .012, .007, -.004, .02)[i % 5] for i in range(n)]
            rates = {"baseline": x, "baseline-stress": [2 * v for v in x],
                     "selected": [v + .004 for v in x], "selected-stress": [2 * v + .003 for v in x],
                     "other": [v - .005 for v in x], "other-stress": [2 * v - .006 for v in x]}
            self.batches[window["id"]] = batch_fixture(self.plan, window, rates)
        result = evaluate(self.plan, self.batches)
        for group in result["groups"]:
            first, second = group["comparisons"]
            for a, b in zip(first["bootstrap"], second["bootstrap"]):
                self.assertEqual(a["absolute"]["primary"], b["absolute"]["primary"])
                for cost, shift in [("base", .004), ("stress", .003)]:
                    for bound in a["paired"][cost]["meanDailyReturn95CI"]:
                        self.assertAlmostEqual(bound, shift)
                for cost, shift in [("base", -.005), ("stress", -.006)]:
                    for bound in b["paired"][cost]["meanDailyReturn95CI"]:
                        self.assertAlmostEqual(bound, shift)
                for base, stress in zip(a["absolute"]["primary"]["base"]["meanDailyReturn95CI"],
                                        a["absolute"]["primary"]["stress"]["meanDailyReturn95CI"]):
                    self.assertAlmostEqual(stress, 2 * base)

    def test_pool_keeps_window_lengths_day_weights_and_independent_capital_resets(self):
        self.plan["windows"][1].update(end="2020-01-03")
        self.plan["windows"][2].update(end="2022-01-09")
        batches = {}
        for window, rate in zip(self.plan["windows"][1:], [.01, .03]):
            rates = {name + suffix: rate for name in ["baseline", "selected", "other"] for suffix in ["", "-stress"]}
            batches[window["id"]] = batch_fixture(self.plan, window, rates)
        result = evaluate(self.plan, batches)
        for window in result["groups"][0]["windows"]:
            self.assertEqual(window["accounts"]["baseline"]["base"]["initialCapital"], 200)
        for comparison in result["groups"][0]["comparisons"]:
            for interval in comparison["bootstrap"]:
                self.assertEqual(interval["days"], 10)
                primary = interval["absolute"]["primary"]["base"]
                self.assertAlmostEqual(primary["meanDailyReturn"], .026)
                for bound in primary["meanDailyReturn95CI"]:
                    self.assertAlmostEqual(bound, .026)
                self.assertEqual(interval["paired"]["base"]["meanDailyReturn95CI"], [0, 0])
        larger = {**self.plan, "initialCapital": 20000}
        scaled = {window["id"]: batch_fixture(larger, window, {
            name + suffix: rate for name in ["baseline", "selected", "other"] for suffix in ["", "-stress"]})
            for window, rate in zip(larger["windows"][1:], [.01, .03])}
        scaled_result = evaluate(larger, scaled)
        self.assertAlmostEqual(scaled_result["groups"][0]["comparisons"][0]["bootstrap"][0]
                               ["absolute"]["primary"]["base"]["meanDailyReturn"], .026)

    def test_missing_window_cost_sleeve_or_daily_observation_fails_closed(self):
        variants = []
        missing = copy.deepcopy(self.batches)
        del missing["second"]
        variants.append(missing)
        for mutation in [lambda b: b[0]["results"].pop(), lambda b: b.pop(),
                         lambda b: b[0]["results"].append(copy.deepcopy(b[0]["results"][0])),
                         lambda b: b[0]["results"][0]["daily"].pop(),
                         lambda b: (b[0]["results"][0]["daily"].pop(),
                                    b[0]["results"][0]["metrics"]["evaluation"]["daily"].pop())]:
            missing = copy.deepcopy(self.batches)
            mutation(missing["first"])
            variants.append(missing)
        for missing in variants:
            with self.assertRaises(ValueError):
                evaluate(self.plan, missing)

    def test_incompatible_conventions_and_mixed_versions_are_rejected(self):
        batches = copy.deepcopy(self.batches)
        batches["first"][0]["results"][0]["metrics"]["evaluation"]["conventions"]["calendar"] = "local"
        with self.assertRaisesRegex(ValueError, "conventions"):
            evaluate(self.plan, batches)
        batches = copy.deepcopy(self.batches)
        for batch in batches["second"]:
            for row in batch["results"]:
                del row["metrics"]["evaluation"]
        with self.assertRaisesRegex(ValueError, "mixed evaluation versions"):
            evaluate(self.plan, batches)

    def test_undefined_returns_cannot_be_silently_excluded(self):
        for batch in self.batches["first"]:
            row = batch["results"][0]
            row["daily"][0]["equity"] = row["metrics"]["evaluation"]["daily"][0]["equity"] = 0
        with self.assertRaisesRegex(ValueError, "undefined"):
            evaluate(self.plan, self.batches)

    def test_cli_audits_every_window_binds_identity_and_writes_once(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(plan=root / "plan.json", manifest=root / "manifest.json",
                                   input=root / "raw", output=root / "output.json")
            for window in self.plan["windows"]:
                for symbol in self.plan["symbols"]:
                    path = args.input / window["id"] / f"{symbol}.json"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("{}")
            evidence = {"plan": self.plan, "selection": {"id": "baseline"}, "engine": "frozen-engine",
                        "planSha256": "hash", "manifestSha256": "hash"}
            calls = []

            def audited(_, window):
                calls.append(window["id"])
                return self.batches.get(window["id"], self.batches["first"]), [{"window": window["id"], "receipt": "audited"}]

            with patch("mechanism_evaluation.load_evidence", return_value=evidence), \
                 patch("mechanism_evaluation.audit_window", side_effect=audited), \
                 patch("mechanism_evaluation.evaluation_identity", return_value={"rawResultsSha256": "raw-hash"}), \
                 patch("mechanism_evaluation.source_fingerprint", return_value="source-hash"), \
                 patch("mechanism_evaluation.sha", return_value="hash"):
                run(args)
                result = json.loads(args.output.read_text())
                self.assertEqual(calls, ["development", "first", "second"])
                self.assertEqual(result["generatorSha256"], "source-hash")
                self.assertEqual(result["evaluationIdentity"], {"rawResultsSha256": "raw-hash"})
                self.assertEqual(len(result["provenance"]), 3)
                with self.assertRaisesRegex(ValueError, "already exists"):
                    run(args)

    def test_cli_protects_raw_evidence_and_incomplete_studies(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(plan=root / "plan.json", manifest=root / "manifest.json",
                                   input=root / "raw", output=root / "raw" / "output.json")
            with self.assertRaisesRegex(ValueError, "outside"):
                run(args)
            args.output = root / "output.json"
            evidence = {"plan": self.plan, "selection": {"id": "baseline"}}
            with patch("mechanism_evaluation.load_evidence", return_value=evidence):
                with self.assertRaisesRegex(ValueError, "incomplete study"):
                    run(args)
                evidence["selection"]["id"] = "selected"
                with self.assertRaisesRegex(ValueError, "frozen selection"):
                    run(args)
            self.assertFalse(args.output.exists())


if __name__ == "__main__":
    unittest.main()
