"""A frozen choice may transfer without evaluating the discarded candidates."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from artifacts import read, sha
from evaluation import RUST_CONVENTIONS, account_evaluation, select_development
from plot import load_curves
from protocol import DAY, REPLAY_VERSION, ROOT, timestamp, validate_plan, window_candidates
from report import build_bundle, render_report
from warmup import window_warmup_days


class TransferProtocolTests(unittest.TestCase):
    def setUp(self):
        self.plan = copy.deepcopy(read(ROOT / "research/trend/literature-plan.json"))
        self.plan["candidates"] = self.plan["candidates"][:3]
        self.ids = [candidate["id"] for candidate in self.plan["candidates"]]
        self.plan["symbols"] = {key: value for key, value in self.plan["symbols"].items()
                                if key in ["BTCUSDT", "ETHUSDT"]}
        self.plan["initialCapital"] = 20000
        self.plan["selectionMode"] = "ranked"
        self.plan.pop("fixedCandidate")
        self.plan["selectionObjective"] = "dailySharpe"
        self.plan["selectionCandidates"] = self.ids[:2]
        self.plan["stressCandidates"] = self.ids
        self.plan["bootstrap"]["samples"] = 20
        self.plan["windows"] = [
            {"id": "development", "start": "2020-01-01", "end": "2020-01-31"},
            {"id": "known", "start": "2020-02-01", "end": "2020-03-02", "role": "diagnostic-known"},
            {"id": "transfer", "start": "2020-03-03", "end": "2020-04-02", "role": "historical-transfer",
             "candidateScope": "selected-and-baseline"},
        ]
        self.plan["comparisons"] = [
            {"id": "chosen-vs-base", "candidate": self.ids[1], "reference": self.ids[0]},
            {"id": "diagnostic-vs-base", "candidate": self.ids[2], "reference": self.ids[0]},
        ]
        self.selection = {"id": self.ids[1], "replayVersion": REPLAY_VERSION}

    def test_transfer_runs_only_choice_and_baseline_with_intersected_stress(self):
        validate_plan(self.plan)
        transfer = self.plan["windows"][2]
        candidates = window_candidates(self.plan, transfer, self.selection)
        self.assertEqual([c.id for c in candidates], [*self.ids[:2], *(i + "-stress" for i in self.ids[:2])])
        self.assertEqual([c.cost_scenario for c in candidates], ["base", "base", "stress", "stress"])
        self.plan["stressCandidates"] = self.ids[1:]
        self.assertEqual([c.id for c in window_candidates(self.plan, transfer, self.selection)],
                         [*self.ids[:2], self.ids[1] + "-stress"])
        self.plan["sensitivity"] = [{"id": "do-not-open", "stopAtr": 3}]
        self.assertEqual(len(window_candidates(self.plan, transfer, self.selection)), 3)
        self.assertTrue(any(c.id.endswith("-do-not-open") for c in
                            window_candidates(self.plan, self.plan["windows"][1], self.selection)))

    def test_same_choice_and_baseline_deduplicates_and_omission_preserves_legacy_stress(self):
        self.plan.pop("stressCandidates")
        transfer = self.plan["windows"][2]
        selection = {"id": self.ids[0]}
        self.assertEqual([c.id for c in window_candidates(self.plan, transfer, selection)],
                         [self.ids[0], self.ids[0] + "-stress"])
        known = self.plan["windows"][1]
        old = window_candidates(self.plan, known, self.selection)
        explicit_all = window_candidates(self.plan, {**known, "candidateScope": "all"}, self.selection)
        self.assertEqual(old, explicit_all)
        self.assertEqual([c.id for c in old], [*self.ids, self.ids[1] + "-stress", self.ids[0] + "-stress"])
        self.plan.pop("baseline")
        self.assertEqual([c.id for c in window_candidates(self.plan, transfer, self.selection)],
                         [self.ids[1], self.ids[1] + "-stress"])

    def test_scope_is_explicit_and_cannot_restrict_development(self):
        for scope in [None, True, "selected", [], {}]:
            with self.subTest(scope=scope), self.assertRaisesRegex(ValueError, "candidateScope"):
                validate_plan({**self.plan, "windows": [self.plan["windows"][0],
                    {**self.plan["windows"][2], "candidateScope": scope}]})
        with self.assertRaisesRegex(ValueError, "development"):
            window_candidates(self.plan, {**self.plan["windows"][0],
                              "candidateScope": "selected-and-baseline"}, self.selection)
        with self.assertRaisesRegex(ValueError, "frozen selection"):
            window_candidates(self.plan, self.plan["windows"][2])

    def test_transfer_download_warmup_covers_every_possible_frozen_choice(self):
        self.plan["candidates"][2]["breakoutBars"] = 640
        self.assertEqual(window_warmup_days(self.plan, self.plan["windows"][2]), 14)
        self.assertNotIn(self.ids[2], [c.id for c in
                         window_candidates(self.plan, self.plan["windows"][2], self.selection)])

    def test_diagnostic_neighbor_cannot_win_the_frozen_selection(self):
        summaries = [{"id": candidate, "dailySharpe": score, "profitableSymbols": 2,
                      "medianSymbolMeanR": .2,
                      "symbols": [{"symbol": s, "metrics": {"trades": 30}} for s in self.plan["symbols"]]}
                     for candidate, score in zip(self.ids, [1, 2, 100])]
        selected, objective, qualified = select_development(self.plan, summaries)
        self.assertEqual(selected["id"], self.ids[1])
        self.assertEqual(objective, "dailySharpe")
        self.assertFalse(qualified)  # Descriptive qualification does not silently reselect.

    def bundle(self):
        """Synthetic complete UTC ledgers, with transport audit mocked only."""
        def batches(_evidence, window):
            result = []
            for symbol in self.plan["symbols"]:
                rows = []
                for index, candidate in enumerate(window_candidates(self.plan, window, self.selection)):
                    start = timestamp(window["start"])
                    daily = [{"time": start + (i + 1) * DAY - 1,
                              "equity": 10000 + (i + 1) * (index + 1) + (i % 2)} for i in range(30)]
                    net = daily[-1]["equity"] - 10000
                    evaluation = {**account_evaluation(daily, 10000), "conventions": dict(RUST_CONVENTIONS),
                        "daily": [{"from": p["time"] + 1 - DAY, "to": p["time"] + 1,
                                   "equity": p["equity"], "complete": True} for p in daily],
                        "costs": {"fees": 0, "funding": 0, "slippageAndRounding": 0,
                                  "total": 0, "grossBeforeCosts": net, "netPnl": net}}
                    rows.append({"id": candidate.id, "daily": daily,
                        "trades": [{"netPnl": net, "rMultiple": net / 100, "side": "long"}],
                        "metrics": {"finalEquity": daily[-1]["equity"], "trades": 1, "totalReturn": net / 10000,
                                    "maxDrawdown": 0, "meanR": net / 100, "fees": 0, "funding": 0,
                                    "evaluation": evaluation}})
                result.append({"symbol": symbol, "results": rows})
            return result, []
        evidence = {"plan": self.plan, "selection": self.selection, "engine": "synthetic",
                    "planSha256": "synthetic-plan", "manifestSha256": "synthetic-manifest",
                    "manifest": {"symbols": {s: {"archives": []} for s in self.plan["symbols"]}}}
        with patch("report.audit_window", side_effect=batches):
            return build_bundle(evidence)

    def test_report_marks_unrun_rules_and_never_computes_missing_comparisons(self):
        bundle, _ = self.bundle()
        self.assertEqual(set(bundle["declaredComparisons"]["known"]),
                         {"chosen-vs-base", "diagnostic-vs-base"})
        self.assertEqual(set(bundle["declaredComparisons"]["transfer"]), {"chosen-vs-base"})
        output = render_report(bundle)
        row = next(line for line in output.splitlines() if line.startswith("| " + self.ids[2] + " |"))
        self.assertTrue(row.endswith("| 未运行 |"), row)
        self.assertIn(f"| transfer | {self.ids[2]} − {self.ids[0]} | 未运行 | 未运行 | 未运行 |", output)
        self.assertEqual(len(bundle["summaries"]["transfer"]), 4)

    def test_all_candidate_curves_respect_the_window_scope(self):
        bundle, points = self.bundle()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "curves.json"
            path.write_text(json.dumps(points))
            bundle["curvesSha256"] = sha(path)
            curves = load_curves(bundle, path, all_candidates=True)
            self.assertIn(("development", self.ids[2]), curves)
            self.assertIn(("known", self.ids[2]), curves)
            self.assertNotIn(("transfer", self.ids[2]), curves)
            self.assertEqual(len(curves), 8)
            for window in self.plan["windows"]:
                for row in bundle["summaries"][window["id"]]:
                    if row["id"] in self.ids:
                        self.assertAlmostEqual(curves[window["id"], row["id"]][-1]["nav"] - 1,
                                               row["equalSleeveReturn"])


if __name__ == "__main__":
    unittest.main()
