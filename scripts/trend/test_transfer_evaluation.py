"""Frozen-transfer evaluation: paired dates, independent resets, strict acceptance."""
import copy
import json
from pathlib import Path
import random
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from evaluation import RUST_CONVENTIONS, fixed_qualification
from protocol import DAY, timestamp
from transfer_evaluation import (SERIES, acceptance, account_window, circular_indices,
                                 evaluate, pooled_bootstrap, run, settings_for)


def plan_fixture():
    return {"initialCapital": 200, "capitalMode": "total-account-equal-sleeves", "symbols": {"A": {}, "B": {}},
            "baseline": "baseline", "selectionMinTrades": 1, "selectionMinProfitableSymbols": 1,
            "windows": [{"id": "development", "role": "development", "start": "2019-01-01", "end": "2019-02-01"},
                        {"id": "first", "role": "historical-transfer", "start": "2020-01-01", "end": "2020-02-01"},
                        {"id": "second", "role": "historical-transfer", "start": "2022-01-01", "end": "2022-03-01"}],
            "bootstrap": {"samples": 20, "blockDays": 2, "seed": 11},
            "transferEvaluation": {"windows": ["first", "second"], "samples": 60, "seed": 20261003,
                "blockDays": [7, 28], "minimumDays": 80, "minimumTrades": 4, "minimumTradesPerSymbol": 2,
                "maxDailyDrawdown": .1, "requireEachWindowPositive": True, "requireDevelopmentQualified": True,
                "method": "Within-window paired circular blocks", "acceptance": "Frozen strict tests"}}


def batch_fixture(plan, window, daily_rates=None):
    initial = plan["initialCapital"] / len(plan["symbols"])
    start, end = timestamp(window["start"]), timestamp(window["end"])
    result = []
    daily_rates = daily_rates or {"selected": .002, "baseline": .001,
                                  "selected-stress": .0015, "baseline-stress": .0005}
    for symbol in plan["symbols"]:
        rows = []
        for candidate, rate in daily_rates.items():
            equity, curve = initial, []
            for i, time in enumerate(range(start + DAY - 1, end, DAY)):
                equity *= 1 + (rate[i] if isinstance(rate, list) else rate)
                curve.append({"time": time, "equity": equity})
            net = equity - initial
            trades = [{"netPnl": net, "rMultiple": net / 10, "side": "long"}]
            metrics = {"trades": 1, "finalEquity": equity, "totalReturn": equity / initial - 1,
                       "maxDrawdown": 0, "meanR": net / 10, "fees": 0, "funding": 0,
                       "evaluation": {"version": 2, "conventions": dict(RUST_CONVENTIONS),
                           "daily": [{"from": p["time"] + 1 - DAY, "to": p["time"] + 1,
                                      "equity": p["equity"], "complete": True} for p in curve],
                           "costs": {"fees": 0, "funding": 0, "slippageAndRounding": 0,
                                     "total": 0, "grossBeforeCosts": net, "netPnl": net}}}
            rows.append({"id": candidate, "daily": curve, "metrics": metrics, "trades": trades})
        result.append({"symbol": symbol, "results": rows})
    return result


def development_fixture():
    return {"id": "selected", "dailySharpe": 1, "profitableSymbols": 2, "medianSymbolMeanR": .1,
            "symbols": [{"symbol": symbol, "metrics": {"trades": 30}} for symbol in ["A", "B"]]}


def inherited_fixture():
    source_plan = plan_fixture()
    summary = development_fixture()
    qualification = fixed_qualification(source_plan, summary)
    plan = {**copy.deepcopy(source_plan), "selectionMode": "inherited", "fixedCandidate": "selected",
            "symbols": {"C": {}, "D": {}}, "selectionMinTrades": 9999,
            "selectionSource": {"planSha256": "frozen-source-plan"}}
    plan["windows"] = plan["windows"][1:]
    identity = {**plan["selectionSource"], "selected": "selected", "baseline": "baseline",
                "sourceSymbols": ["A", "B"], "sourceDevelopmentWindow": source_plan["windows"][0]}
    source = {"plan": source_plan, "selection": {"id": "selected", "developmentQualified": True},
              "developmentSummary": summary, "qualification": qualification, "identity": identity}
    selection = {"id": "selected", "developmentQualified": True, "selectionMode": "inherited",
                 "objective": "inherited", "qualificationScope": "source-domain",
                 "selectionSource": identity, "developmentQualification": qualification}
    return plan, selection, source


class TransferEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.plan = plan_fixture()
        self.selection = {"id": "selected", "developmentQualified": True}
        self.batches = {w["id"]: batch_fixture(self.plan, w) for w in self.plan["windows"][1:]}

    def test_frozen_settings_are_consumed_and_ambiguous_windows_rejected(self):
        self.assertEqual(settings_for(self.plan)["blockDays"], [7, 28])
        for mutation in [lambda p: p["transferEvaluation"].update(extraCriterion=True),
                         lambda p: p["transferEvaluation"].update(windows=["first", "missing"]),
                         lambda p: p["windows"][2].update(start="2020-01-15"),
                         lambda p: p["transferEvaluation"].update(blockDays=[7, 7])]:
            plan = copy.deepcopy(self.plan)
            mutation(plan)
            with self.assertRaises(ValueError):
                settings_for(plan)

    def test_circular_wrapping_never_crosses_window_and_keeps_original_length(self):
        class LastIndex:
            def randrange(self, length):
                return length - 1
        self.assertEqual(circular_indices(3, 2, LastIndex()), [2, 0, 2])
        self.assertEqual(circular_indices(2, 7, LastIndex()), [1, 0])
        for length in [1, 7, 61, 365]:
            indices = circular_indices(length, 28, random.Random(3))
            self.assertEqual(len(indices), length)
            self.assertTrue(all(0 <= i < length for i in indices))

    def test_pool_uses_day_weights_not_equal_window_weights_or_cross_gap_blocks(self):
        windows = [{"times": list(range(n)), "returns": {key: [value] * n for key in SERIES}}
                   for n, value in [(2, .01), (8, .03)]]
        result = pooled_bootstrap(windows, 80, 7, 20261003)
        self.assertEqual(result["days"], 10)
        for key in SERIES:
            self.assertAlmostEqual(result["absolute"][key]["meanDailyReturn"], .026)
            for bound in result["absolute"][key]["meanDailyReturn95CI"]:
                self.assertAlmostEqual(bound, .026)

    def test_selected_baseline_and_costs_share_each_resampled_date(self):
        x = [-.03, .005, .04, -.01, .02, -.008, .015]
        series = {"baselineBase": x, "selectedBase": [v + .004 for v in x],
                  "baselineStress": [2 * v for v in x], "selectedStress": [2 * v + .003 for v in x]}
        result = pooled_bootstrap([{"times": list(range(len(x))), "returns": series}], 100, 3, 2)
        for key, expected in [("base", .004), ("stress", .003)]:
            for value in result["paired"][key]["meanDailyReturn95CI"]:
                self.assertAlmostEqual(value, expected)
        for a, b in zip(result["absolute"]["baselineBase"]["meanDailyReturn95CI"],
                        result["absolute"]["baselineStress"]["meanDailyReturn95CI"]):
            self.assertAlmostEqual(2 * a, b)

    def test_independent_capital_resets_and_scale_do_not_create_returns(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        self.assertEqual(result["pooled"]["days"], 90)
        for interval in result["bootstrap"]:
            self.assertAlmostEqual(interval["absolute"]["selectedBase"]["meanDailyReturn"], .002)
        window = self.plan["windows"][2]
        _, first, _ = account_window(self.plan, self.batches["second"], "selected", window)
        larger = {**self.plan, "initialCapital": 20000}
        compact, second, _ = account_window(larger, batch_fixture(larger, window), "selected", window)
        self.assertEqual(compact["initialCapital"], 20000)
        for a, b in zip(first["returns"], second["returns"]):
            self.assertAlmostEqual(a, b)
        self.assertEqual(result["acceptance"]["status"], "passed-for-forward-observation")

    def test_coin_offsetting_is_aggregated_before_paired_daily_sampling(self):
        window = self.plan["windows"][1]
        batches = batch_fixture(self.plan, window)
        for row_a, row_b in zip(batches[0]["results"], batches[1]["results"]):
            # Exact offset of one original sleeve; portfolio is constant.
            for point, observation, a in zip(row_b["daily"], row_b["metrics"]["evaluation"]["daily"], row_a["daily"]):
                point["equity"] = observation["equity"] = 200 - a["equity"]
            net = -row_a["trades"][0]["netPnl"]
            row_b["trades"][0].update(netPnl=net, rMultiple=net / 10)
            row_b["metrics"].update(finalEquity=row_b["daily"][-1]["equity"], totalReturn=net / 100, meanR=net / 10)
            row_b["metrics"]["evaluation"]["costs"].update(grossBeforeCosts=net, netPnl=net)
        compact, series, leave_out = account_window(self.plan, batches, "selected", window)
        self.assertEqual(compact["return"], 0)
        self.assertEqual(series["returns"], [0] * 31)
        self.assertLess(leave_out["A"], 0)
        self.assertGreater(leave_out["B"], 0)

    def test_missing_window_cost_calendar_or_sleeve_fails_closed(self):
        variants = []
        missing = copy.deepcopy(self.batches)
        del missing["second"]
        variants.append(missing)
        missing = copy.deepcopy(self.batches)
        missing["first"][0]["results"].pop()
        variants.append(missing)
        missing = copy.deepcopy(self.batches)
        row = missing["first"][0]["results"][0]
        row["daily"].pop()
        row["metrics"]["evaluation"]["daily"].pop()
        variants.append(missing)
        missing = copy.deepcopy(self.batches)
        missing["first"].pop()
        variants.append(missing)
        for missing in variants:
            with self.assertRaises(ValueError):
                evaluate(self.plan, self.selection, missing, development_fixture())

    def test_positive_points_cannot_pass_zero_absolute_lower_bound(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        intervals = copy.deepcopy(result["bootstrap"])
        intervals[1]["absolute"]["selectedStress"]["meanDailyReturn95CI"][0] = 0
        verdict = acceptance(result["protocol"], result["windows"], result["pooled"], intervals, True)
        self.assertEqual(verdict["status"], "not-established")
        self.assertEqual(verdict["failedCriteria"], ["stress:block28:absolute-lower-bound"])
        intervals[1]["absolute"]["selectedStress"]["meanDailyReturn95CI"][0] = -.0001
        self.assertEqual(acceptance(result["protocol"], result["windows"], result["pooled"], intervals, True)["status"],
                         "not-established")

    def test_both_cost_sample_counts_development_and_every_window_are_required(self):
        result = evaluate(self.plan, self.selection, self.batches, development_fixture())
        windows, pooled = copy.deepcopy(result["windows"]), copy.deepcopy(result["pooled"])
        windows[1]["accounts"]["selectedBase"]["return"] = 0
        windows[0]["accounts"]["selectedStress"]["dailyMaxDrawdown"] = -.101
        pooled["stress"]["tradesBySymbol"]["A"] = 1
        pooled["stress"]["trades"] = 3
        verdict = acceptance(result["protocol"], windows, pooled, result["bootstrap"], False)
        self.assertEqual(set(verdict["failedCriteria"]), {"development-qualified", "base:second:positive-return",
                         "stress:first:daily-drawdown", "stress:minimum-trades:A", "stress:minimum-trades"})

    def test_undefined_daily_return_is_not_dropped(self):
        window = {"times": [1, 2], "returns": {key: [0, None] for key in SERIES}}
        with self.assertRaisesRegex(ValueError, "undefined"):
            pooled_bootstrap([window], 20, 7, 1)

    def test_selected_equal_to_baseline_has_exactly_zero_paired_intervals(self):
        selection = {"id": "baseline", "developmentQualified": True}
        development = {**development_fixture(), "id": "baseline"}
        result = evaluate(self.plan, selection, self.batches, development)
        for interval in result["bootstrap"]:
            for cost in ("base", "stress"):
                self.assertEqual(interval["paired"][cost], {"meanDailyReturn": 0,
                                                            "meanDailyReturn95CI": [0, 0]})

    def test_zero_equity_followed_by_another_day_rejects_undefined_return(self):
        window = self.plan["windows"][1]
        batches = copy.deepcopy(self.batches["first"])
        for batch in batches:
            row = next(r for r in batch["results"] if r["id"] == "selected")
            row["daily"][0]["equity"] = 0
            row["metrics"]["evaluation"]["daily"][0]["equity"] = 0
        with self.assertRaisesRegex(ValueError, "undefined account daily return"):
            account_window(self.plan, batches, "selected", window)

    def test_output_cannot_overwrite_evidence_or_existing_evaluation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw = root / "raw"
            raw.mkdir()
            args = SimpleNamespace(input=raw, output=raw / "transfer-evaluation.json")
            with self.assertRaisesRegex(ValueError, "outside"):
                run(args)
            args.output = root / "existing.json"
            args.output.write_text("frozen")
            with self.assertRaisesRegex(ValueError, "already exists"):
                run(args)
            self.assertEqual(args.output.read_text(), "frozen")

    def test_inherited_selection_uses_only_source_domain_qualification_and_keeps_statistics(self):
        legacy = evaluate(self.plan, self.selection, self.batches, development_fixture())
        plan, selection, source = inherited_fixture()
        batches = {window["id"]: batch_fixture(plan, window) for window in plan["windows"]}
        result = evaluate(plan, selection, batches, selection_source=source)
        self.assertEqual(result["version"], "trend-transfer-evaluation-2")
        self.assertEqual(legacy["version"], "trend-transfer-evaluation-1")
        self.assertEqual(result["bootstrap"], legacy["bootstrap"])
        self.assertEqual(result["developmentQualification"], source["qualification"])
        self.assertEqual(set(result["developmentQualification"]["tradesBySymbol"]), {"A", "B"})
        self.assertEqual(set(result["pooled"]["base"]["tradesBySymbol"]), {"C", "D"})
        self.assertEqual(result["acceptance"]["status"], legacy["acceptance"]["status"])
        self.assertTrue(result["targetDomain"]["disjointSymbols"])
        self.assertFalse(result["targetDomain"]["timeIndependenceClaim"])
        self.assertFalse(result["targetDomain"]["prospective"])
        self.assertEqual(result["qualificationScope"], "source-domain")
        self.assertFalse(result["selectionRecomputed"])

    def test_inherited_cannot_introduce_development_or_substitute_target_summary(self):
        plan, selection, source = inherited_fixture()
        batches = {window["id"]: batch_fixture(plan, window) for window in plan["windows"]}
        with self.assertRaisesRegex(ValueError, "audited source-domain"):
            evaluate(plan, selection, batches)
        with self.assertRaisesRegex(ValueError, "target development summary"):
            evaluate(plan, selection, batches, development_fixture(), selection_source=source)
        with self.assertRaisesRegex(ValueError, "external qualification"):
            evaluate(self.plan, self.selection, self.batches, development_fixture(), selection_source=source)
        plan["windows"][0]["role"] = "development"
        with self.assertRaisesRegex(ValueError, "new development"):
            settings_for(plan)

    def test_inherited_source_failure_remains_failure_without_fallback(self):
        plan, selection, source = inherited_fixture()
        source["developmentSummary"]["profitableSymbols"] = 0
        source["qualification"] = fixed_qualification(source["plan"], source["developmentSummary"])
        source["selection"]["developmentQualified"] = False
        selection.update(developmentQualified=False, developmentQualification=source["qualification"])
        batches = {window["id"]: batch_fixture(plan, window) for window in plan["windows"]}
        result = evaluate(plan, selection, batches, selection_source=source)
        self.assertEqual(result["selected"], "selected")
        self.assertEqual(result["acceptance"]["status"], "not-established")
        self.assertEqual(result["acceptance"]["failedCriteria"], ["development-qualified"])

    def test_inherited_rejects_tampered_source_identity_and_qualification(self):
        mutations = [lambda p, s, c: s.update(id="baseline"),
                     lambda p, s, c: s.update(qualificationScope="target-domain"),
                     lambda p, s, c: s.update(developmentQualified=False),
                     lambda p, s, c: s.update(selectionSource={}),
                     lambda p, s, c: p["selectionSource"].update(planSha256="different"),
                     lambda p, s, c: c["selection"].update(id="baseline"),
                     lambda p, s, c: c["developmentSummary"].update(profitableSymbols=0),
                     lambda p, s, c: c.update(qualification={"status": "passed"})]
        for mutate in mutations:
            plan, selection, source = inherited_fixture()
            mutate(plan, selection, source)
            batches = {window["id"]: batch_fixture(plan, window) for window in plan["windows"]}
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                evaluate(plan, selection, batches, selection_source=source)

    def test_inherited_cli_audits_without_local_development_and_rechecks_source_before_publish(self):
        plan, selection, source = inherited_fixture()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw = root / "raw"
            raw.mkdir()
            args = SimpleNamespace(plan=root / "plan.json", manifest=root / "manifest.json",
                                   input=raw, output=root / "transfer.json")
            evidence = {"plan": plan, "selection": selection, "selectionSource": source,
                        "directory": raw, "planSha256": "hash", "manifestSha256": "hash", "engine": "test"}
            for window in plan["windows"]:
                (raw / window["id"]).mkdir()
                for symbol in plan["symbols"]:
                    (raw / window["id"] / f"{symbol}.json").write_text("{}")

            def audit(_, window):
                return batch_fixture(plan, window), [{"window": window["id"], "sha256": "audited"}]

            with patch("transfer_evaluation.load_evidence", return_value=evidence), \
                    patch("transfer_evaluation.audit_window", side_effect=audit) as audit_mock, \
                    patch("transfer_evaluation.evaluation_identity", return_value={"frozen": True}), \
                    patch("transfer_evaluation.sha", return_value="hash"), \
                    patch("transfer_evaluation.source_fingerprint", return_value="source-hash"), \
                    patch("transfer_evaluation.resolve_selection_source", return_value=source) as resolve, \
                    patch("transfer_evaluation.read", side_effect=AssertionError("No local development summary")):
                run(args)
                self.assertEqual(audit_mock.call_count, len(plan["windows"]))
                resolve.assert_called_once_with(plan)
                result = json.loads(args.output.read_text())
                self.assertEqual(result["selectionSource"], source["identity"])
                self.assertEqual(result["transferSourceSha256"], "hash")
                self.assertEqual(result["generatorSha256"], "source-hash")
                args.output = root / "changed-source.json"
                resolve.return_value = {"identity": {"changed": True}}
                with self.assertRaisesRegex(ValueError, "source evidence changed"):
                    run(args)
                self.assertFalse(args.output.exists())


if __name__ == "__main__":
    unittest.main()
