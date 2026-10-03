"""A new symbol domain inherits identity, never development qualification fitting."""
import contextlib
import copy
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import artifacts
import protocol
import research
from report import render_report
import test_risk_overrides as risk_fixtures
from warmup import window_warmup_days
from download import required_months


class InheritedSelectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.binary = self.folder / "trend"
        self.binary.write_bytes(b"frozen-source-native")
        self.source_plan = artifacts.read(protocol.ROOT / "research/trend/search-plan.json")
        names = {self.source_plan["baseline"], "m30-n320-no-day-guard"}
        self.source_plan.update(candidates=[c for c in self.source_plan["candidates"] if c["id"] in names],
                                stressCandidates=list(sorted(names)), comparisons=[],
                                windows=[self.source_plan["windows"][0]])
        self.source_plan["bootstrap"].update(samples=10, blockDays=2)
        self.source_paths = {key: self.folder / key for key in ["plan.json", "manifest.json", "source-run"]}
        artifacts.write(self.source_paths["plan.json"], self.source_plan)
        manifest = {"planSha256": artifacts.sha(self.source_paths["plan.json"]),
                    "symbols": {symbol: {} for symbol in self.source_plan["symbols"]}}
        artifacts.write(self.source_paths["manifest.json"], manifest)
        self.run = self.source_paths["source-run"]
        summaries = [{"id": c["id"], "dailySharpe": 1, "profitableSymbols": 6, "medianSymbolMeanR": .1,
                      "symbols": [{"symbol": symbol, "metrics": {"trades": 30}}
                                  for symbol in self.source_plan["symbols"]]} for c in self.source_plan["candidates"]]
        artifacts.write(self.run / "development-summary.json", summaries)
        identity = {"planSha256": artifacts.sha(self.source_paths["plan.json"]),
                    "manifestSha256": artifacts.sha(self.source_paths["manifest.json"]),
                    "binarySha256": artifacts.sha(self.binary), "replayVersion": "trend-native-replay-4"}
        self.source_selection = {**identity, "id": "m30-n320-no-day-guard", "developmentQualified": True,
                                 "developmentSha256": artifacts.sha(self.run / "development-summary.json")}
        artifacts.write(self.run / "selection.json", self.source_selection)
        artifacts.write(self.run / "run.json", identity)
        development = self.source_plan["windows"][0]
        for symbol in self.source_plan["symbols"]:
            path = self.run / development["id"] / f"{symbol}.json"
            configs = path.with_name(f"{symbol}-configs.json")
            artifacts.write(configs, protocol.native_requests(self.source_plan, symbol,
                            protocol.window_candidates(self.source_plan, development)))
            artifacts.write(path, {"synthetic": "source receipt bytes, not a replay"})
            artifacts.write(path.with_suffix(".receipt.json"), {**identity, "window": development,
                            "resultSha256": artifacts.sha(path), "configsSha256": artifacts.sha(configs)})
        self.plan = copy.deepcopy(self.source_plan)
        for key in ["selectionObjective", "selectionMinTrades", "selectionMinProfitableSymbols", "searchEvaluation"]:
            self.plan.pop(key, None)
        self.plan.update(selectionMode="inherited", fixedCandidate=self.source_selection["id"],
                         windows=[{"id": "holdout", "role": "historical-symbol-holdout", "start": "2024-09-01", "end": "2024-10-01"}],
                         symbols={symbol: dict(value) for symbol, value in zip(
                             ["LTCUSDT", "LINKUSDT", "ADAUSDT", "BCHUSDT", "ETCUSDT", "TRXUSDT"],
                             self.source_plan["symbols"].values())})
        self.plan["selectionSource"] = {
            "plan": str(self.source_paths["plan.json"]), "manifest": str(self.source_paths["manifest.json"]), "run": str(self.run),
            "planSha256": identity["planSha256"], "manifestSha256": identity["manifestSha256"],
            "runSha256": artifacts.sha(self.run / "run.json"), "selectionSha256": artifacts.sha(self.run / "selection.json"),
            "developmentSha256": self.source_selection["developmentSha256"]}

    def selection(self):
        source = artifacts.resolve_selection_source(self.plan)
        return {"id": self.plan["fixedCandidate"], "selectionMode": "inherited", "objective": "inherited",
                "qualificationScope": "source-domain", "selectionSource": source["identity"],
                "developmentQualification": source["qualification"], "developmentQualified": True,
                "replayVersion": protocol.REPLAY_VERSION}

    def test_no_target_development_and_both_costs_are_present_from_first_window(self):
        protocol.validate_plan(self.plan)
        selected = self.selection()
        protocol.validate_selection(self.plan, selected)
        variants = protocol.window_candidates(self.plan, self.plan["windows"][0], selected)
        self.assertEqual(len(variants), 4)
        self.assertEqual([v.cost_scenario for v in variants], ["base", "base", "stress", "stress"])
        self.assertEqual(window_warmup_days(self.plan, self.plan["windows"][0]), 7)
        prices, funding, windows = required_months(self.plan)
        self.assertEqual(prices, ["2024-08", "2024-09"])
        self.assertEqual(funding, ["2024-09"])
        self.assertEqual(windows[0]["warmupStart"], "2024-08-25")
        self.assertEqual(set(selected["developmentQualification"]["tradesBySymbol"]), set(self.source_plan["symbols"]))
        self.assertFalse(set(self.plan["symbols"]) & set(self.source_plan["symbols"]))

    def test_inherited_shape_rejects_fake_development_selection_and_incomplete_costs(self):
        changes = [lambda p: p["windows"][0].update(role="development"),
                   lambda p: p.update(selectionObjective="dailySharpe"),
                   lambda p: p.update(selectionCandidates=[p["fixedCandidate"]]),
                   lambda p: p.update(selectionMinTrades=1),
                   lambda p: p.update(selectionMinProfitableSymbols=1),
                   lambda p: p.update(sensitivity=[{"id": "new", "stopAtr": 3}]),
                   lambda p: p.update(stressCandidates=[p["fixedCandidate"]]),
                   lambda p: p["selectionSource"].pop("runSha256"),
                   lambda p: p["selectionSource"].update(selectionSha256="bad"),
                   lambda p: p.update(selectionSource=None)]
        for change in changes:
            plan = copy.deepcopy(self.plan); change(plan)
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                protocol.validate_plan(plan)

    def test_new_rules_costs_capital_or_identity_cannot_replace_source(self):
        changes = [lambda p: p.update(fixedCandidate=p["baseline"]),
                   lambda p: p.update(baseline=p["fixedCandidate"]),
                   lambda p: p["candidates"][0].update(stopAtr=3),
                   lambda p: p["risk"].update(riskPct=.01),
                   lambda p: p["costs"].update(feeBps=0),
                   lambda p: p.update(initialCapital=120000),
                   lambda p: p.update(capitalMode="independent-equal-sleeves"),
                   lambda p: p.update(configVersion=7)]
        for change in changes:
            plan = copy.deepcopy(self.plan); change(plan)
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                artifacts.resolve_selection_source(plan)
        # New market precision is permitted; it is the declared instrument change.
        self.plan["symbols"]["LTCUSDT"].update(tickSize=.01, quantityStep=.1, minNotional=5)
        artifacts.resolve_selection_source(self.plan)

    def test_all_five_source_hashes_and_old_receipt_payload_are_checked(self):
        for key in ["planSha256", "manifestSha256", "runSha256", "selectionSha256", "developmentSha256"]:
            plan = copy.deepcopy(self.plan); plan["selectionSource"][key] = "0" * 64
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "checksum"):
                artifacts.resolve_selection_source(plan)
        path = self.run / "development" / "BTCUSDT.json"
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "receipt mismatch"):
            artifacts.resolve_selection_source(self.plan)

    def test_source_qualification_is_checked_against_original_symbols(self):
        summary = artifacts.read(self.run / "development-summary.json")
        next(r for r in summary if r["id"] == self.plan["fixedCandidate"])["profitableSymbols"] = 0
        artifacts.write(self.run / "development-summary.json", summary)
        value = artifacts.sha(self.run / "development-summary.json")
        self.plan["selectionSource"]["developmentSha256"] = value
        self.source_selection["developmentSha256"] = value
        artifacts.write(self.run / "selection.json", self.source_selection)
        self.plan["selectionSource"]["selectionSha256"] = artifacts.sha(self.run / "selection.json")
        with self.assertRaisesRegex(ValueError, "original domain"):
            artifacts.resolve_selection_source(self.plan)

    def test_selection_metadata_cannot_claim_local_development_or_new_qualification(self):
        selected = self.selection()
        for change in [{"developmentSha256": "0" * 64}, {"objective": "dailySharpe"},
                       {"qualificationScope": "target-domain"}, {"id": self.plan["baseline"]},
                       {"developmentQualified": False}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                protocol.validate_selection(self.plan, {**selected, **change})

    def test_runner_records_source_choice_before_target_replay_without_selecting(self):
        plan_path, manifest_path, output = self.folder / "target-plan.json", self.folder / "target-manifest.json", self.folder / "target-run"
        artifacts.write(plan_path, self.plan)
        artifacts.write(manifest_path, {"planSha256": artifacts.sha(plan_path), "symbols": {s: {} for s in self.plan["symbols"]}})
        observed = []
        def replay(args, plan, window, symbol, variants, fingerprint):
            observed.append((symbol, [v.id for v in variants]))
            self.assertEqual(artifacts.read(output / "selection.json")["id"], self.plan["fixedCandidate"])
            return {"symbol": symbol, "results": []}
        def summary(plan, batches, candidate):
            return {"id": candidate, "equalSleeveReturn": -.3, "meanNetR": -1,
                    "profitableSymbols": 0, "sleeveCount": 6}
        command = ["research.py", "--plan", str(plan_path), "--manifest", str(manifest_path),
                   "--output", str(output), "--binary", str(self.binary), "--workers", "1"]
        with patch("sys.argv", command), patch("research.run_symbol", side_effect=replay), \
             patch("research.summarize", side_effect=summary), \
             patch("research.select_development", side_effect=AssertionError("must never select")), \
             patch("research.fixed_qualification", side_effect=AssertionError("must never qualify target")), \
             contextlib.redirect_stdout(io.StringIO()):
            research.main()
        self.assertEqual(len(observed), 6)
        self.assertTrue(all(len(ids) == 4 for _, ids in observed))
        self.assertFalse((output / "development-summary.json").exists())
        saved = artifacts.read(output / "selection.json")
        self.assertTrue(saved["developmentQualified"])
        self.assertEqual(saved["id"], self.plan["fixedCandidate"])
        evidence = artifacts.load_evidence(plan_path, manifest_path, output)
        self.assertEqual(evidence["selectionSource"]["qualification"], saved["developmentQualification"])

    def test_report_explains_source_domain_and_target_is_not_time_oos(self):
        helper = risk_fixtures.RiskOverrideTests(); helper.setUp()
        helper.plan = self.plan; helper.selection = self.selection()
        bundle = helper.bundle()
        text = render_report(bundle)
        self.assertEqual(bundle["qualificationScope"], "source-domain")
        self.assertIn("来源开发域资格", text)
        self.assertIn("目标品种没有开发期", text)
        self.assertIn("新币验证本身不构成时间样本外", text)
        self.assertIn(self.plan["selectionSource"]["selectionSha256"], text)

    def test_v3_v4_v5_explicit_cost_is_preserved(self):
        candidate = protocol.Candidate("name-stress", {}, "base")
        for version in ["trend-native-replay-3", "trend-native-replay-4", "trend-native-replay-5"]:
            self.assertEqual(protocol.recorded_candidates([candidate], version)[0].cost_scenario, "base")


if __name__ == "__main__":
    unittest.main()
