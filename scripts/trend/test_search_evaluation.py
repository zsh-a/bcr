"""Search-wide max tests, frozen selection and audit publication boundaries."""
import copy
import json
from pathlib import Path
import random
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from search_evaluation import acceptance, bootstrap, evaluate, max_mean_family, run, settings_for
from test_transfer_evaluation import batch_fixture, development_fixture, plan_fixture
from account_statistics import circular_indices


def search_plan():
    plan = plan_fixture()
    previous = plan.pop("transferEvaluation")
    plan["searchEvaluation"] = {**previous, "alpha": .05}
    plan["selectionObjective"] = "dailySharpe"
    plan["candidates"] = [{"id": name} for name in ["baseline", "selected", "other"]]
    return plan


def samples_fixture(plan, rates=None):
    rates = rates or {"baseline": .001, "baseline-stress": .0005,
                      "selected": .002, "selected-stress": .0015,
                      "other": -.001, "other-stress": -.002}
    return {window["id"]: batch_fixture(plan, window, rates) for window in plan["windows"][1:]}


class SearchEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.plan = search_plan()
        self.selection = {"id": "selected", "developmentQualified": True}
        self.batches = samples_fixture(self.plan)

    def test_strict_protocol_rejects_undeclared_gates_missing_dates_and_invalid_numbers(self):
        self.assertEqual(settings_for(self.plan)["windows"], ["first", "second"])
        changes = [lambda p: p["searchEvaluation"].update(newGate=True),
                   lambda p: p["searchEvaluation"].pop("alpha"),
                   lambda p: p["searchEvaluation"].update(alpha=True),
                   lambda p: p["searchEvaluation"].update(alpha=0),
                   lambda p: p["searchEvaluation"].update(alpha=1),
                   lambda p: p["searchEvaluation"].update(maxDailyDrawdown=float("nan")),
                   lambda p: p["searchEvaluation"].update(samples=False),
                   lambda p: p["searchEvaluation"].update(seed=1.5),
                   lambda p: p["searchEvaluation"].update(blockDays=[7, 7]),
                   lambda p: p["searchEvaluation"].update(blockDays=[-1]),
                   lambda p: p["searchEvaluation"].update(requireDevelopmentQualified=1),
                   lambda p: p["searchEvaluation"].update(acceptance=""),
                   lambda p: p["searchEvaluation"].update(windows=["missing"]),
                   lambda p: p["searchEvaluation"].update(windows=["development"]),
                   lambda p: p["windows"][1].update(start="2019-01-15", end="2019-03-01"),
                   lambda p: p["windows"][2].update(start="2020-01-15"),
                   lambda p: p.update(baseline="missing"),
                   lambda p: p["candidates"].append({"id": "baseline-stress"}),
                   lambda p: p.update(candidates=[{"id": f"candidate{i}"} for i in range(33)])]
        for change in changes:
            plan = copy.deepcopy(self.plan)
            change(plan)
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                settings_for(plan)

    def test_max_null_is_centered_and_retains_poor_high_variance_candidates(self):
        means = [.01, -.02]
        values = [[.009, .011, .011, .009], [.08, -.12, .08, -.12]]
        result = max_mean_family(means, values, 100)
        self.assertAlmostEqual(result["globalStatistic"], .1)
        self.assertEqual(result["globalPValue"], 3 / 5)
        self.assertEqual(result["rows"][0]["adjustedPValue"], 3 / 5)
        self.assertEqual(result["rows"][1]["adjustedPValue"], 1)
        filtered = max_mean_family(means[:1], values[:1], 100)
        self.assertEqual(filtered["globalPValue"], 1 / 5)
        # Changing a series' observed mean must not change its centered noise.
        shifted = max_mean_family([.11, .08], [[v + .1 for v in row] for row in values], 100)
        self.assertEqual(shifted["globalPValue"], 1 / 5)

    def test_nonpositive_and_identically_zero_nulls_have_p_one(self):
        result = max_mean_family([0, -.1], [[0] * 7, [-.1] * 7], 10)
        self.assertEqual(result["globalPValue"], 1)
        self.assertTrue(all(row["adjustedPValue"] == 1 for row in result["rows"]))
        positive = max_mean_family([.01], [[.01] * 7], 10)
        self.assertEqual(positive["globalPValue"], 1 / 8)
        for means, values in [([float("nan")], [[0]]), ([0], [[None]]), ([0, 1], [[0]])]:
            with self.assertRaises((ValueError, TypeError)):
                max_mean_family(means, values, 10)

    def test_pooled_prefix_sampler_matches_direct_shared_indices_and_exact_percentile_ranks(self):
        candidates = ["baseline", "selected", "other"]
        windows = []
        for n, offset in [(5, 0), (11, .004)]:
            values = [(-.02, .03, -.001, .012)[i % 4] + offset for i in range(n)]
            windows.append({"times": list(range(n)), "returns": {
                "baseline": {"base": values, "stress": [2 * v for v in values]},
                "selected": {"base": [v + .003 for v in values], "stress": [2 * v + .004 for v in values]},
                "other": {"base": [-v for v in values], "stress": [-2 * v for v in values]}}})
        samples, block, seed, days = 101, 7, 19, 16
        result = bootstrap(windows, candidates, "baseline", samples, block, seed)
        rng = random.Random(seed)
        expected = {(candidate, cost): [] for candidate in candidates for cost in ["base", "stress"]}
        for _ in range(samples):
            indices = [circular_indices(len(w["times"]), block, rng) for w in windows]
            for candidate, cost in expected:
                expected[(candidate, cost)].append(sum(sum(w["returns"][candidate][cost][i] for i in chosen)
                    for w, chosen in zip(windows, indices)) / days)
        for candidate in candidates:
            for cost in ["base", "stress"]:
                ordered = sorted(expected[(candidate, cost)])
                actual = result["candidates"][candidate][cost]["absolute"]
                for a, b in zip(actual["meanDailyReturn95CI"], [ordered[2], ordered[98]]):
                    self.assertAlmostEqual(a, b, places=14)
        for cost, expected_shift in [("base", .003), ("stress", .004)]:
            row = result["candidates"]["selected"][cost]["relativeToBaseline"]
            self.assertAlmostEqual(row["meanDailyReturn"], expected_shift)
            for bound in row["meanDailyReturn95CI"]:
                self.assertAlmostEqual(bound, expected_shift)

    def test_cash_family_contains_both_costs_incremental_excludes_only_baseline(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        for interval in result["bootstrap"]:
            self.assertEqual(interval["families"]["cash"]["seriesCount"], 6)
            self.assertEqual(interval["families"]["baselineIncremental"]["seriesCount"], 4)
            for cost in ["base", "stress"]:
                baseline = interval["candidates"]["baseline"][cost]["relativeToBaseline"]
                self.assertEqual(baseline["meanDailyReturn95CI"], [0, 0])
                self.assertIsNone(baseline["adjustedPValue"])
                self.assertFalse(baseline["includedInFamily"])
                self.assertEqual(interval["candidates"]["other"][cost]["absolute"]["adjustedPValue"], 1)
        self.assertEqual(result["status"], "historical-criteria-passed")
        self.assertFalse(result["selectionRecomputed"])
        self.assertEqual(result["selected"], "selected")
        self.assertEqual(result["selectedSummary"]["id"], "selected")

    def test_duplicate_identical_series_do_not_create_independent_search_trials(self):
        x = [-.01, .03, -.02, .04, .005]
        window = {"times": list(range(5)), "returns": {"baseline": {"base": x, "stress": x}}}
        one = bootstrap([window], ["baseline"], "baseline", 100, 2, 7)
        window["returns"]["clone"] = copy.deepcopy(window["returns"]["baseline"])
        two = bootstrap([window], ["baseline", "clone"], "baseline", 100, 2, 7)
        self.assertEqual(one["families"]["cash"]["globalPValue"], two["families"]["cash"]["globalPValue"])
        self.assertEqual(one["families"]["baselineIncremental"]["seriesCount"], 0)
        for cost in ["base", "stress"]:
            paired = two["candidates"]["clone"][cost]["relativeToBaseline"]
            self.assertEqual(paired["meanDailyReturn95CI"], [0, 0])
            self.assertEqual(paired["adjustedPValue"], 1)

    def test_window_weights_and_capital_resets_do_not_become_cross_gap_returns(self):
        self.plan["windows"][1].update(end="2020-01-03")
        self.plan["windows"][2].update(end="2022-01-09")

        def create(plan):
            return {window["id"]: batch_fixture(plan, window, {
                candidate + suffix: rate for candidate in ["baseline", "selected", "other"] for suffix in ["", "-stress"]})
                for window, rate in zip(plan["windows"][1:], [.01, .03])}

        result = evaluate(self.plan, self.selection, create(self.plan), development_fixture())
        self.assertEqual(result["pooled"]["days"], 10)
        self.assertEqual(result["status"], "not-established")  # Frozen sample minimum remains 80.
        for interval in result["bootstrap"]:
            value = interval["candidates"]["selected"]["base"]["absolute"]
            self.assertAlmostEqual(value["meanDailyReturn"], .026)
            for bound in value["meanDailyReturn95CI"]:
                self.assertAlmostEqual(bound, .026)
        larger = {**self.plan, "initialCapital": 20000}
        scaled = evaluate(larger, self.selection, create(larger), development_fixture())
        self.assertAlmostEqual(scaled["bootstrap"][0]["candidates"]["selected"]["base"]["absolute"]["meanDailyReturn"], .026)

    def test_global_rejection_cannot_certify_frozen_selected_candidate(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        intervals = copy.deepcopy(result["bootstrap"])
        intervals[0]["families"]["cash"]["globalPValue"] = .001
        intervals[0]["candidates"]["selected"]["stress"]["absolute"]["adjustedPValue"] = .25
        verdict = acceptance(result["protocol"], "selected", result["windows"], result["pooled"], intervals, True)
        self.assertEqual(verdict["status"], "not-established")
        self.assertEqual(verdict["failedCriteria"], ["stress:block7:selected-cash-adjusted-p"])
        intervals[0]["candidates"]["selected"]["stress"]["absolute"]["adjustedPValue"] = .05
        self.assertEqual(acceptance(result["protocol"], "selected", result["windows"], result["pooled"], intervals, True)["status"],
                         "historical-criteria-passed")

    def test_all_costs_windows_samples_and_absolute_intervals_enter_acceptance(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        windows, pooled, intervals = (copy.deepcopy(result[key]) for key in ["windows", "pooled", "bootstrap"])
        windows[0]["accounts"]["selected"]["base"]["return"] = 0
        windows[1]["accounts"]["selected"]["stress"]["dailyMaxDrawdown"] = -.101
        pooled["candidates"]["selected"]["stress"]["trades"] = 3
        pooled["candidates"]["selected"]["base"]["tradesBySymbol"]["A"] = 1
        intervals[1]["candidates"]["selected"]["base"]["absolute"]["meanDailyReturn95CI"][0] = 0
        verdict = acceptance(result["protocol"], "selected", windows, pooled, intervals, False)
        self.assertEqual(set(verdict["failedCriteria"]), {"development-qualified", "base:first:positive-return",
            "stress:second:daily-drawdown", "stress:minimum-trades", "base:minimum-trades:A", "base:block28:absolute-lower-bound"})

    def test_incremental_p_is_descriptive_and_does_not_promote_or_reject(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        for interval in result["bootstrap"]:
            interval["families"]["baselineIncremental"]["globalPValue"] = 1
            for cost in ["base", "stress"]:
                interval["candidates"]["selected"][cost]["relativeToBaseline"]["adjustedPValue"] = 1
        verdict = acceptance(result["protocol"], "selected", result["windows"], result["pooled"], result["bootstrap"], True)
        self.assertEqual(verdict["status"], "historical-criteria-passed")

    def test_missing_window_cost_sleeve_or_canonical_day_fails_closed(self):
        variants = []
        missing = copy.deepcopy(self.batches)
        del missing["second"]
        variants.append(missing)
        for mutation in [lambda b: b.pop(), lambda b: b[0]["results"].pop(),
                         lambda b: b[0]["results"].append(copy.deepcopy(b[0]["results"][0])),
                         lambda b: b[0]["results"][0]["daily"].pop(),
                         lambda b: (b[0]["results"][0]["daily"].pop(),
                                    b[0]["results"][0]["metrics"]["evaluation"]["daily"].pop())]:
            missing = copy.deepcopy(self.batches)
            mutation(missing["first"])
            variants.append(missing)
        for missing in variants:
            with self.assertRaises(ValueError):
                evaluate(self.plan, self.selection, missing, development_fixture())

    def test_mixed_conventions_and_undefined_daily_returns_fail_closed(self):
        batches = copy.deepcopy(self.batches)
        batches["first"][0]["results"][0]["metrics"]["evaluation"]["conventions"]["calendar"] = "local"
        with self.assertRaisesRegex(ValueError, "conventions"):
            evaluate(self.plan, self.selection, batches, development_fixture())
        for batch in self.batches["first"]:
            row = batch["results"][0]
            row["daily"][0]["equity"] = row["metrics"]["evaluation"]["daily"][0]["equity"] = 0
        with self.assertRaisesRegex(ValueError, "undefined"):
            evaluate(self.plan, self.selection, self.batches, development_fixture())

    def test_development_qualification_is_verified_without_reranking(self):
        with self.assertRaisesRegex(ValueError, "qualification"):
            evaluate(self.plan, {**self.selection, "developmentQualified": False}, self.batches, development_fixture())
        invalid = {**development_fixture(), "profitableSymbols": 0}
        result = evaluate(self.plan, {**self.selection, "developmentQualified": False}, self.batches, invalid)
        self.assertEqual(result["selected"], "selected")
        self.assertEqual(result["status"], "not-established")
        self.assertIn("development-qualified", result["acceptance"]["failedCriteria"])

    def test_full_32_candidate_universe_includes_64_cash_and_62_incremental_series(self):
        candidates = ["baseline", *[f"candidate{i}" for i in range(31)]]
        window = {"times": [1, 2], "returns": {candidate: {"base": [.01, -.005], "stress": [.009, -.006]}
                                              for candidate in candidates}}
        result = bootstrap([window], candidates, "baseline", 20, 7, 1)
        self.assertEqual(result["families"]["cash"]["seriesCount"], 64)
        self.assertEqual(result["families"]["baselineIncremental"]["seriesCount"], 62)

    def test_cli_audits_every_window_and_never_overwrites_existing_or_raw_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(plan=root / "plan.json", manifest=root / "manifest.json",
                                   input=root / "raw", output=root / "raw" / "result.json")
            with self.assertRaisesRegex(ValueError, "outside"):
                run(args)
            args.output = root / "result.json"
            for window in self.plan["windows"]:
                for symbol in self.plan["symbols"]:
                    path = args.input / window["id"] / f"{symbol}.json"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("{}")
            (args.input / "development-summary.json").write_text(json.dumps([development_fixture()]))
            evidence = {"plan": self.plan, "selection": self.selection, "engine": "frozen-engine",
                        "planSha256": "hash", "manifestSha256": "hash"}
            calls = []

            def audited(_, window):
                calls.append(window["id"])
                return self.batches.get(window["id"], self.batches["first"]), [{"window": window["id"]}]

            with patch("search_evaluation.load_evidence", return_value=evidence), \
                 patch("search_evaluation.audit_window", side_effect=audited), \
                 patch("search_evaluation.evaluation_identity", return_value={"rawResultsSha256": "raw-hash"}), \
                 patch("search_evaluation.source_fingerprint", return_value="source-hash"), \
                 patch("search_evaluation.sha", return_value="hash"):
                run(args)
                result = json.loads(args.output.read_text())
                self.assertEqual(calls, ["development", "first", "second"])
                self.assertEqual(result["generatorSha256"], "source-hash")
                self.assertEqual(result["evaluationIdentity"], {"rawResultsSha256": "raw-hash"})
                self.assertEqual(len(result["provenance"]), 3)
                with self.assertRaisesRegex(ValueError, "already exists"):
                    run(args)


if __name__ == "__main__":
    unittest.main()
