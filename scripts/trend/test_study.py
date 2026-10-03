"""Study boundaries: metadata-only compilation and audited, immutable gates."""
import copy
import datetime as dt
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import artifacts
from evaluation import EVALUATION_VERSION, fixed_qualification, summarize
import protocol
import study
from test_transfer_evaluation import batch_fixture
import transfer_evaluation


class StudyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        rules = {"tickSize": .01, "quantityStep": .1, "minNotional": 5}
        strategy = {"entry": "breakout", "tradeMinutes": 30, "filter": "none", "management": "channel",
                    "direction": "long", "breakoutBars": 20, "channelExitBars": 10, "stopAtr": 2,
                    "breakEvenAtr": 0, "trailingAtr": 3, "maxCostAtr": 0}
        settings = {"windows": [], "samples": 20, "seed": 7, "blockDays": [7, 28], "minimumDays": 30,
                    "minimumTrades": 1, "minimumTradesPerSymbol": 1, "maxDailyDrawdown": .1,
                    "requireEachWindowPositive": True, "requireDevelopmentQualified": True,
                    "method": "shared calendar blocks", "acceptance": "all checks"}
        self.experiment = {"version": 1, "id": "research", "frozenAt": "2019-12-01T00:00:00Z",
            "protocol": {"version": 1, "configVersion": 8, "capitalMode": "total-account-equal-sleeves", "initialCapital": 10000,
                "costs": {"feeBps": 5, "slippageBps": 2, "stressFeeBps": 10, "stressSlippageBps": 4},
                "risk": {"riskPct": .005, "maxExposurePct": .95, "cooldownLosses": 3, "cooldownMinutes": 60,
                         "dailyLossPct": 0, "flattenMinute": None},
                "bootstrap": {"samples": 20, "seed": 7, "blockDays": 7}, "selectionMode": "fixed",
                "fixedCandidate": "selected", "baseline": "baseline", "selection": "fixed independent hypothesis",
                "selectionMinTrades": 1, "selectionMinProfitableSymbols": 1,
                "candidates": [{"id": name, **strategy} for name in ["selected", "baseline"]],
                "transferEvaluation": settings},
            "universes": [{"id": "core", "role": "development", "symbols": {"A": rules}},
                          {"id": "new", "role": "holdout", "symbols": {"B": rules}}],
            "windows": [{"id": "early", "role": "development", "start": "2020-01-01", "end": "2020-02-05"},
                        {"id": "later", "role": "validation", "start": "2020-03-01", "end": "2020-04-05"},
                        {"id": "future", "role": "holdout", "start": "2020-05-01", "end": "2020-06-05"}],
            "cells": [{"id": "dev", "universe": "core", "window": "early", "dataset": "observed", "claim": "known-reused"},
                      {"id": "val", "universe": "core", "window": "later", "dataset": "observed", "claim": "known-reused"},
                      {"id": "final", "universe": "new", "window": "future", "dataset": "reserved", "claim": "future-time"}],
            "separation": {"purgeDays": 1, "gapDays": 1}}
        self.source = self.folder / "old-manifest.json"
        self.source.write_text(__import__("json").dumps(self.metadata("A", "2019-12-01", "2020-01-01", "2020-04-05")))
        self.catalog = study.catalog_snapshot("prices", [("observed", self.source)])
        self.catalog["datasets"].append({"id": "reserved", "availability": "not-yet-available", "symbols": {},
                                         "coverage": [], "fundingCoverage": []})
        self.catalog_path, self.experiment_path = self.folder / "catalog.json", self.folder / "experiment.json"
        self.save_inputs()

    def metadata(self, symbol, warmup, start, end):
        return {"planSha256": "irrelevant-old-strategy", "warmupWindows": [{"id": "prior", "warmupStart": warmup, "start": start, "end": end}],
                "symbols": {symbol: {"archives": [], "partitions": [], "funding": "/no-price-file-is-opened.json",
                                     "fundingSha256": "0" * 64}}, "priceValidation": {"policy": "synthetic-test-metadata"}}

    def save_inputs(self):
        artifacts.write(self.catalog_path, self.catalog)
        artifacts.write(self.experiment_path, self.experiment)

    def compile(self, cell, receipts=(), catalog=None, suffix=""):
        folder = self.folder / (cell + suffix)
        study.compile_cell(catalog or self.catalog_path, self.experiment_path, cell, folder, receipts)
        return folder / "compilation.json"

    def run_fixture(self, compilation, rates=None):
        """Consistent synthetic account evidence, not a native signal test."""
        compiled = artifacts.read(compilation)
        plan_path, manifest_path = (Path(compiled[key]["path"]) for key in ["plan", "manifest"])
        plan = artifacts.read(plan_path)
        window = plan["windows"][0]
        run = compilation.parent / "run"
        identity = {"planSha256": artifacts.sha(plan_path), "manifestSha256": artifacts.sha(manifest_path),
                    "binarySha256": "a" * 64, "replayVersion": protocol.REPLAY_VERSION}
        days = (protocol.timestamp(window["end"]) - protocol.timestamp(window["start"])) // protocol.DAY
        rates = rates or [.001 + .0005 * (i % 2) for i in range(days)]
        batches = batch_fixture(plan, window, {name: rates for name in ["selected", "baseline", "selected-stress", "baseline-stress"]})
        candidates = protocol.window_candidates(plan, window, {"id": "selected"})
        expected_ids = {c.id for c in candidates}
        for batch in batches:
            batch.update(version=1, planSha256=identity["planSha256"], window=window["id"], engine="trend-continuation-test",
                         startTime=protocol.timestamp(window["start"]), endTime=protocol.timestamp(window["end"]))
            batch["results"] = [r for r in batch["results"] if r["id"] in expected_ids]
            requests = protocol.native_requests(plan, batch["symbol"], candidates)
            configs = {r["id"]: r["config"] for r in requests}
            for row in batch["results"]:
                row["config"] = configs[row["id"]]
                row["warmupStart"] = batch["startTime"] - study.warmup_days(row["config"]["strategy"]) * protocol.DAY
            path = run / window["id"] / (batch["symbol"] + ".json")
            config_path = path.with_name(batch["symbol"] + "-configs.json")
            artifacts.write(config_path, requests)
            artifacts.write(path, batch)
            artifacts.write(path.with_suffix(".receipt.json"), {**identity, "window": window, "warmupPolicy": study.WARMUP_POLICY,
                "resultSha256": artifacts.sha(path), "configsSha256": artifacts.sha(config_path)})
        selection = {**identity, "id": "selected", "evaluationVersion": EVALUATION_VERSION,
                     "evaluationSha256": artifacts.evaluation_fingerprint(), "criterion": plan["selection"]}
        if window["role"] == "development":
            summaries = [summarize(plan, batches, c.id) for c in candidates]
            artifacts.write(run / (window["id"] + "-summary.json"), summaries)
            qualification = fixed_qualification(plan, next(s for s in summaries if s["id"] == "selected"))
            selection.update(selectionMode="fixed", objective="fixed", developmentQualification=qualification,
                             developmentQualified=qualification["status"] == "passed",
                             developmentSha256=artifacts.sha(run / (window["id"] + "-summary.json")))
        else:
            source = artifacts.resolve_selection_source(plan)
            selection.update(selectionMode="inherited", objective="inherited", qualificationScope="source-domain",
                             developmentQualification=source["qualification"], developmentQualified=True,
                             selectionSource=source["identity"])
        artifacts.write(run / "selection.json", selection)
        artifacts.write(run / "run.json", identity)
        return run

    def seal_development(self, rates=None):
        compilation = self.compile("dev")
        run = self.run_fixture(compilation, rates)
        seal = self.folder / "development-seal.json"
        study.seal_stage(compilation, run, seal)
        return seal

    def test_metadata_import_is_plan_independent_and_warmup_is_context_only(self):
        self.assertNotIn("planSha256", self.catalog["datasets"][0])
        cells = study.preflight(self.catalog, self.experiment)["cells"]
        self.assertEqual([c["stage"] for c in cells], ["development", "validation", "holdout"])
        self.assertEqual(cells[2]["status"], "not-yet-available")
        compilation = self.compile("dev")
        value = artifacts.read(compilation)
        plan, manifest = (artifacts.read(value[key]["path"]) for key in ["plan", "manifest"])
        self.assertEqual(plan["windows"][0]["start"], "2020-01-01")
        self.assertEqual(manifest["warmupWindows"][0]["warmupStart"], "2019-12-31")
        self.assertEqual(manifest["planSha256"], artifacts.sha(value["plan"]["path"]))
        with self.assertRaisesRegex(ValueError, "new directory"):
            self.compile("dev")
        with self.assertRaisesRegex(ValueError, "not-yet-available"):
            self.compile("final")

    def test_exposure_cannot_be_deleted_or_relabeled_using_source_metadata(self):
        self.catalog["exposures"] = []
        with self.assertRaisesRegex(ValueError, "omits exposure"):
            study.preflight(self.catalog, self.experiment)
        self.catalog = artifacts.read(self.catalog_path)
        self.experiment["cells"][1]["claim"] = "asset-holdout-known-time"
        with self.assertRaisesRegex(ValueError, "previously exposed"):
            study.preflight(self.catalog, self.experiment)
        self.experiment = artifacts.read(self.experiment_path)
        self.source.write_bytes(self.source.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "SHA mismatch"):
            study.preflight(self.catalog, self.experiment)

    def test_two_axis_time_order_and_purge_apply_even_to_different_symbols(self):
        self.experiment["universes"][1]["role"] = "validation"
        self.experiment["cells"][1]["universe"] = "new"
        self.experiment["windows"][1].update(start="2019-01-01", end="2019-02-05")
        with self.assertRaisesRegex(ValueError, "time roles must advance"):
            study.preflight(self.catalog, self.experiment)
        self.experiment = artifacts.read(self.experiment_path)
        self.experiment["windows"][1]["start"] = "2020-02-06"
        with self.assertRaisesRegex(ValueError, "purge/gap"):
            study.preflight(self.catalog, self.experiment)

    def test_symbol_validation_in_development_time_remains_a_separate_axis(self):
        self.experiment["universes"][1]["role"] = "validation"
        self.experiment["cells"].append({"id": "asset-transfer", "universe": "new", "window": "early",
                                         "dataset": "observed", "claim": "known-reused"})
        cell = study.preflight(self.catalog, self.experiment)["cells"][-1]
        self.assertEqual((cell["stage"], cell["symbolRole"], cell["timeRole"]),
                         ("validation", "validation", "development"))

    def test_duplicate_scored_cell_cannot_multiply_same_market_observations(self):
        self.experiment["cells"].append({**self.experiment["cells"][1], "id": "duplicate"})
        with self.assertRaisesRegex(ValueError, "overlap"):
            study.preflight(self.catalog, self.experiment)

    def test_validation_requires_real_qualified_development_and_freezes_rule(self):
        with self.assertRaisesRegex(ValueError, "prerequisite"):
            self.compile("val")
        seal = self.seal_development()
        self.assertTrue(artifacts.read(seal)["passed"])
        self.assertEqual(artifacts.read(seal)["costScope"], "development-base-only")
        compiled = self.compile("val", [seal])
        plan = artifacts.read(artifacts.read(compiled)["plan"]["path"])
        self.assertEqual(plan["selectionMode"], "inherited")
        self.assertEqual(plan["fixedCandidate"], "selected")
        self.assertEqual(set(plan["stressCandidates"]), {"selected", "baseline"})
        value = artifacts.read(seal); value["passed"] = False; artifacts.write(seal, value)
        with self.assertRaisesRegex(ValueError, "failed stage"):
            self.compile("val", [seal], suffix="-failed")

    def test_development_profit_and_drawdown_are_separate_from_sample_qualification(self):
        rates = [-.15] + [.02] * 34
        seal = self.seal_development(rates)
        value = artifacts.read(seal)
        self.assertTrue(value["checks"]["sourceQualification"])
        self.assertTrue(value["checks"]["basePositiveReturn"])
        self.assertFalse(value["checks"]["baseDailyDrawdown"])
        self.assertFalse(value["passed"])
        value["passed"] = True; artifacts.write(seal, value)
        with self.assertRaisesRegex(ValueError, "not produced by audited"):
            self.compile("val", [seal])

    def test_source_only_changes_preserve_old_gate_but_new_evaluation_semantics_do_not(self):
        seal = self.seal_development()
        real_sha = study.sha
        def source_only_sha(path):
            if Path(path).resolve() in (Path(study.__file__).resolve(), Path(study.__file__).with_name("warmup.py").resolve()):
                return "c" * 64
            return real_sha(path)
        with patch.object(study, "sha", side_effect=source_only_sha), patch("report.evaluation_fingerprint", return_value="d" * 64):
            self.compile("val", [seal])
        with patch.object(study, "EVALUATION_VERSION", "incompatible-next-evaluator"):
            with self.assertRaisesRegex(ValueError, "semantic version"):
                self.compile("val", [seal], suffix="-new-evaluator")

    def test_formal_failed_evaluation_is_recorded_and_cannot_be_replaced_with_boolean(self):
        dev = self.seal_development()
        compilation = self.compile("val", [dev])
        run = self.run_fixture(compilation, [-.001 - .0005 * (i % 2) for i in range(35)])
        value = artifacts.read(compilation)
        evaluation = self.folder / "evaluation.json"
        transfer_evaluation.run(SimpleNamespace(plan=Path(value["plan"]["path"]), manifest=Path(value["manifest"]["path"]), input=run, output=evaluation))
        seal = self.folder / "val-seal.json"
        result = study.seal_stage(compilation, run, seal, evaluation)
        self.assertFalse(result["passed"])
        report = artifacts.read(evaluation); report["acceptance"]["status"] = "passed-for-forward-observation"
        artifacts.write(evaluation, report)
        with self.assertRaisesRegex(ValueError, "differs from recomputed"):
            study.seal_stage(compilation, run, self.folder / "forged.json", evaluation)
        with self.assertRaisesRegex(ValueError, "immutable"):
            study.seal_stage(compilation, run, seal, evaluation)

    def test_reserved_extension_unlocks_future_without_mutating_previous_seals(self):
        dev = self.seal_development()
        val_compilation = self.compile("val", [dev])
        run = self.run_fixture(val_compilation)
        compiled = artifacts.read(val_compilation)
        evaluation = self.folder / "evaluation.json"
        transfer_evaluation.run(SimpleNamespace(plan=Path(compiled["plan"]["path"]), manifest=Path(compiled["manifest"]["path"]), input=run, output=evaluation))
        val = self.folder / "validation-seal.json"
        self.assertTrue(study.seal_stage(val_compilation, run, val, evaluation)["passed"])
        future_manifest = self.folder / "future-manifest.json"
        artifacts.write(future_manifest, self.metadata("B", "2020-04-30", "2020-05-01", "2020-06-05"))
        extension = study.extend_catalog(self.catalog_path, self.experiment_path, "reserved", future_manifest)
        extended_path = self.folder / "catalog-extended.json"
        artifacts.write(extended_path, extension)
        with self.assertRaisesRegex(ValueError, "prerequisite"):
            self.compile("final", [dev], catalog=extended_path)
        compiled_final = self.compile("final", [dev, val], catalog=extended_path)
        self.assertEqual(artifacts.read(compiled_final)["catalog"]["sha256"], artifacts.sha(extended_path))
        self.assertEqual(artifacts.read(dev)["catalog"]["sha256"], artifacts.sha(self.catalog_path))
        for mutation in [lambda x: x["datasets"][0]["symbols"]["A"].update(funding="replacement.json"),
                         lambda x: x.update(exposures=[]), lambda x: x["datasets"][0].update(id="replacement")]:
            changed = copy.deepcopy(extension); mutation(changed)
            with self.assertRaises(ValueError):
                study.preflight(changed, self.experiment)
        self.experiment["protocol"]["risk"]["riskPct"] = .01
        artifacts.write(self.experiment_path, self.experiment)
        with self.assertRaises(ValueError):
            self.compile("final", [dev, val], catalog=extended_path, suffix="-changed")

    def test_reserved_data_cannot_activate_before_full_future_window_or_with_replacement_symbol(self):
        future_manifest = self.folder / "future-manifest.json"
        artifacts.write(future_manifest, self.metadata("C", "2020-04-30", "2020-05-01", "2020-06-05"))
        with self.assertRaisesRegex(ValueError, "universe"):
            study.extend_catalog(self.catalog_path, self.experiment_path, "reserved", future_manifest)
        self.experiment["windows"][2].update(start="2099-05-01", end="2099-06-05")
        self.save_inputs()
        artifacts.write(future_manifest, self.metadata("B", "2099-04-30", "2099-05-01", "2099-06-05"))
        with self.assertRaisesRegex(ValueError, "not yet available"):
            study.extend_catalog(self.catalog_path, self.experiment_path, "reserved", future_manifest)


if __name__ == "__main__":
    unittest.main()
