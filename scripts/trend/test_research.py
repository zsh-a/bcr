import importlib.util
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


research, download, warmup = module("research"), module("download"), module("warmup")
artifacts, evaluation, protocol, report = module("artifacts"), module("evaluation"), module("protocol"), module("report")


class ResearchTests(unittest.TestCase):
    @staticmethod
    def evaluation_fixture():
        return json.loads((research.ROOT / "crates/quant/fixtures/trend-evaluation-contract.json").read_text())

    def v2_batches(self, curves):
        plan = {"initialCapital": len(curves) * 10000, "capitalMode": "total-account-equal-sleeves",
                "symbols": {chr(65 + i): {} for i in range(len(curves))},
                "bootstrap": {"samples": 50, "blockDays": 2, "seed": 13}}
        batches = []
        for symbol, curve in zip(plan["symbols"], curves):
            pnl = curve[-1]["equity"] - 10000
            # Per-sleeve metrics stand in for the trusted Rust output; the
            # research layer must not replace them with account statistics.
            metrics = {"finalEquity": curve[-1]["equity"], "trades": 1, "totalReturn": pnl / 10000,
                       "maxDrawdown": -.25, "meanR": pnl / 100, "fees": 3, "funding": -.5}
            metrics["evaluation"] = {**self.evaluation_fixture()["cases"][0]["expected"], "version": 2,
                "conventions": dict(evaluation.RUST_CONVENTIONS), "maxDrawdownDurationMs": 7 * protocol.DAY,
                "costs": {"fees": 3, "funding": -.5, "slippageAndRounding": .25, "total": 2.75,
                          "grossBeforeCosts": pnl + 2.75, "netPnl": pnl, "costToGrossProfit": None}}
            batches.append({"symbol": symbol, "results": [{"id": "c", "daily": copy.deepcopy(curve),
                "trades": [{"netPnl": pnl, "rMultiple": pnl / 100, "side": "long"}], "metrics": metrics}]})
        return plan, batches

    def test_shared_rust_daily_evaluation_contract(self):
        fixture = self.evaluation_fixture()
        self.assertEqual(fixture["conventions"], evaluation.RUST_CONVENTIONS)
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                actual = evaluation.account_evaluation(case["daily"], case["initialCapital"])
                self.assertEqual(actual["durationMs"], case["endTime"] - case["startTime"])
                self.assertEqual(actual["conventions"]["drawdownSampling"], "daily-close")
                for name, expected in case["expected"].items():
                    if expected is None:
                        self.assertIsNone(actual[name], name)
                    else:
                        self.assertAlmostEqual(actual[name], expected, places=10, msg=name)

    def test_v2_account_uses_summed_equity_preserves_sleeves_and_reconciles_costs(self):
        mixed = self.evaluation_fixture()["cases"][0]["daily"]
        opposite = [{**point, "equity": 20000 - point["equity"]} for point in mixed]
        plan, batches = self.v2_batches([mixed, opposite])
        summary = evaluation.summarize(plan, batches, "c")
        self.assertEqual(summary["accountFinalEquity"], 20000)
        self.assertIsNone(summary["dailySharpe"])  # Offsetting sleeves form a flat account.
        self.assertEqual(summary["accountEvaluation"]["dailyMaxDrawdown"], 0)
        self.assertIs(summary["symbols"][0]["metrics"], batches[0]["results"][0]["metrics"])
        self.assertGreater(summary["symbols"][0]["metrics"]["evaluation"]["dailySharpe"], 2)
        costs = summary["accountEvaluation"]["costs"]
        self.assertEqual(costs["fees"], 6)
        self.assertEqual(costs["funding"], -1)
        self.assertEqual(costs["slippageAndRounding"], .5)
        self.assertEqual(costs["total"], 5.5)
        self.assertAlmostEqual(costs["grossBeforeCosts"] - costs["total"], summary["accountNetPnl"])
        self.assertEqual(costs["netPnl"], 0)  # Costs were not deducted again.
        batches[1]["results"][0]["metrics"]["evaluation"]["costs"]["total"] += 1
        with self.assertRaisesRegex(ValueError, "cost attribution"):
            evaluation.summarize(plan, batches, "c")

    def test_v2_short_window_and_mixed_contracts_do_not_silently_select(self):
        short = self.evaluation_fixture()["cases"][2]["daily"]
        plan, batches = self.v2_batches([short, short])
        self.assertIsNone(evaluation.summarize(plan, batches, "c")["dailySharpe"])
        old = copy.deepcopy(batches)
        for batch in old:
            del batch["results"][0]["metrics"]["evaluation"]
        self.assertIsNotNone(evaluation.summarize(plan, old, "c")["dailySharpe"])
        with self.assertRaisesRegex(ValueError, "mixed.*versions"):
            evaluation.summarize(plan, [batches[0], old[1]], "c")
        batches[1]["results"][0]["metrics"]["evaluation"]["conventions"]["annualizationDays"] = 252
        with self.assertRaisesRegex(ValueError, "conventions"):
            evaluation.summarize(plan, batches, "c")

    def test_daily_drawdown_duration_includes_recovery_and_open_drawdown(self):
        start = protocol.timestamp("2024-01-01")
        curve = [{"time": start + (i + 1) * protocol.DAY - 1, "equity": value}
                 for i, value in enumerate([110, 90, 110, 100, 105, 90])]
        value = evaluation.account_evaluation(curve, 100)
        self.assertEqual(value["maxDrawdownDurationMs"], 3 * protocol.DAY)
        self.assertEqual(value["currentDrawdownDurationMs"], 3 * protocol.DAY)
        self.assertAlmostEqual(value["currentDrawdown"], 90 / 110 - 1)
        recovered = evaluation.account_evaluation(curve[:3], 100)
        self.assertEqual(recovered["maxDrawdownDurationMs"], 2 * protocol.DAY)
        self.assertEqual(recovered["currentDrawdownDurationMs"], 0)
        with self.assertRaisesRegex(ValueError, "complete.*UTC"):
            evaluation.account_evaluation(curve[::2], 100)

    def test_insolvent_account_does_not_skip_invalid_return_days(self):
        curve = copy.deepcopy(self.evaluation_fixture()["cases"][1]["daily"])
        curve[2]["equity"] = 0
        value = evaluation.account_evaluation(curve, 10000)
        self.assertEqual(value["totalDays"], 30)
        for key in ["annualizedReturn", "annualizedVolatility", "dailySharpe", "sortino", "calmar", "worstDayReturn"]:
            self.assertIsNone(value[key], key)
        plan, batches = self.v2_batches([curve])
        summary = evaluation.summarize(plan, batches, "c")
        self.assertIsNone(summary["dailyMean95CI"])
        self.assertIsNone(evaluation.paired_comparison(plan, batches, "c", "c")["meanDailyDifference95CI"])
        terminal = copy.deepcopy(self.evaluation_fixture()["cases"][1]["daily"])
        terminal[-1]["equity"] = 0
        loss = evaluation.account_evaluation(terminal, 10000)
        self.assertEqual(loss["annualizedReturn"], -1)
        self.assertEqual(loss["calmar"], -1)
        self.assertEqual(loss["worstDayReturn"], -1)
        terminal[-1]["equity"] = -100
        deficit = evaluation.account_evaluation(terminal, 10000)
        for key in ["annualizedReturn", "annualizedVolatility", "dailySharpe", "sortino", "calmar"]:
            self.assertIsNone(deficit[key], key)
        self.assertEqual(deficit["worstDayReturn"], -1.01)

    def test_missing_funding_cannot_be_treated_as_zero_cost(self):
        start = download.timestamp("2024-01-01")
        events = [{"time": start + h * 3600000, "rate": .0001, "intervalHours": 8} for h in [0, 8, 16]]
        download.validate_funding(events, start, start + 86400000)
        with self.assertRaisesRegex(ValueError, "funding calendar"):
            download.validate_funding([events[0], events[2]], start, start + 86400000)
        with self.assertRaisesRegex(ValueError, "boundary"):
            download.validate_funding(events[:1], start, start + 86400000)

    def test_calendar_block_bootstrap_is_seeded_and_does_not_invent_edge(self):
        self.assertEqual(research.confidence([0.01] * 30, 200, 7, 1), [0.01, 0.01])
        a = research.confidence([-0.01, 0.01] * 30, 200, 7, 2)
        self.assertEqual(a, research.confidence([-0.01, 0.01] * 30, 200, 7, 2))
        self.assertLess(a[0], 0)
        self.assertGreater(a[1], 0)

    def test_fresh_strategy_config_preserves_symbol_costs_and_direction(self):
        plan = json.loads((research.ROOT / "research/trend/slow-plan.json").read_text())
        candidate = next(c for c in plan["candidates"] if c["id"] == "channel-1d-long")
        c = research.config(plan, "DOGEUSDT", candidate, True)
        self.assertEqual(c["strategy"]["direction"], "long")
        self.assertEqual(c["strategy"]["tradeMinutes"], 1440)
        self.assertEqual(c["execution"]["tickSize"], 0.00001)
        self.assertEqual(c["execution"]["slippageBps"], 4)
        self.assertNotIn("id", c["strategy"])
        self.assertEqual(c["version"], 4)
        self.assertNotIn("maxCostAtr", c["strategy"])

    def test_v5_cost_gate_and_total_account_use_real_sleeve_capital(self):
        plan = json.loads((research.ROOT / "research/trend/slow-plan.json").read_text())
        plan.update(configVersion=5, capitalMode="total-account-equal-sleeves", initialCapital=60000)
        candidate = {**plan["candidates"][0], "maxCostAtr": .5}
        c = research.config(plan, "BTCUSDT", candidate)
        self.assertEqual(c["version"], 5)
        self.assertEqual(c["strategy"]["maxCostAtr"], .5)
        self.assertEqual(c["execution"]["initialCapital"], 10000)
        self.assertEqual(research.config(plan, "BTCUSDT", plan["candidates"][0])["strategy"]["maxCostAtr"], 0)
        plan["configVersion"] = 4
        with self.assertRaisesRegex(ValueError, "configVersion 5"):
            research.config(plan, "BTCUSDT", candidate)

    def test_warmup_matches_active_frontend_windows(self):
        fixture = json.loads((research.ROOT / "crates/quant/fixtures/trend-contract.json").read_text())
        self.assertEqual(warmup.WARMUP_POLICY, fixture["warmupPolicy"])
        self.assertEqual(warmup.BACKGROUND_MINUTES, {p["minutes"]: p["backgroundMinutes"] for p in fixture["periods"]})
        for case in fixture["warmupCases"]:
            strategy = {**fixture["defaultConfig"]["strategy"], **case["strategy"]}
            with self.subTest(strategy=strategy):
                self.assertEqual(warmup.warmup_days(strategy), case["days"])

    def test_archive_windows_include_sensitivity_warmup_but_not_unused_calendar(self):
        plan = {"candidates": [{"id": "daily", "tradeMinutes": 1440, "filter": "none"}],
                "sensitivity": [{"id": "longer", "breakoutBars": 60}],
                "windows": [{"id": "development", "start": "2024-03-01", "end": "2024-04-01"},
                            {"id": "fresh-check", "start": "2025-03-01", "end": "2025-04-01"}]}
        prices, funding, windows = download.required_months(plan)
        self.assertEqual(prices, ["2024-02", "2024-03", "2024-12", "2025-01", "2025-02", "2025-03"])
        self.assertEqual(funding, ["2024-03", "2025-03"])
        self.assertEqual([w["warmupDays"] for w in windows], [20, 60])

    def test_explicit_window_roles_override_names_in_download_and_execution(self):
        training = {"id": "train", "role": "development", "start": "2024-03-01", "end": "2024-04-01"}
        diagnostic = {"id": "development", "role": "diagnostic", "start": "2025-03-01", "end": "2025-04-01"}
        plan = {"candidates": [{"id": "daily", "tradeMinutes": 1440, "filter": "none"}],
                "sensitivity": [{"id": "longer", "breakoutBars": 100}], "windows": [training, diagnostic]}
        self.assertTrue(protocol.is_development(training))
        self.assertFalse(protocol.is_development(diagnostic))
        self.assertEqual(warmup.window_warmup_days(plan, training), 20)
        self.assertEqual(warmup.window_warmup_days(plan, diagnostic), 100)
        self.assertEqual(len(protocol.window_candidates(plan, training)), 1)
        self.assertEqual(len(protocol.window_candidates(plan, diagnostic, {"id": "daily"})), 3)
        self.assertEqual([window["warmupDays"] for window in download.required_months(plan)[2]], [20, 100])

    def test_later_windows_stress_baseline_and_selection_without_duplicates(self):
        plan = {"candidates": [{"id": "baseline"}, {"id": "slower"}], "baseline": "baseline",
                "sensitivity": [{"id": "stop-lower", "stopAtr": 1.5}]}
        window = {"id": "fresh-september"}
        rows = research.window_candidates(plan, window, {"id": "slower"})
        self.assertEqual([r["id"] for r in rows], ["baseline", "slower", "slower-stress", "baseline-stress", "slower-stop-lower"])
        rows = research.window_candidates(plan, window, {"id": "baseline"})
        self.assertEqual(sum(r["id"] == "baseline-stress" for r in rows), 1)
        self.assertEqual(len(research.window_candidates(plan, {"id": "development"})), 2)

    def test_development_objective_is_explicit_and_qualification_remains_separate(self):
        summaries = [
            {"id": "high-r", "medianSymbolMeanR": 1.4, "dailySharpe": .4, "profitableSymbols": 4},
            {"id": "high-sharpe", "medianSymbolMeanR": -.1, "dailySharpe": 1.4, "profitableSymbols": 4},
            {"id": "too-few", "medianSymbolMeanR": 5, "dailySharpe": 5, "profitableSymbols": 6},
        ]
        for row in summaries:
            row["symbols"] = [{"metrics": {"trades": 2 if row["id"] == "too-few" else 12}}] * 6
        plan = {"selectionMinTrades": 10}
        self.assertEqual(research.select_development(plan, summaries)[0]["id"], "high-r")
        plan["selectionObjective"] = "dailySharpe"
        best, objective, qualified = research.select_development(plan, summaries)
        self.assertEqual(best["id"], "high-sharpe")
        self.assertEqual(objective, "dailySharpe")
        self.assertFalse(qualified)
        plan["selectionObjective"] = "holdoutReturn"
        with self.assertRaisesRegex(ValueError, "selectionObjective"):
            research.select_development(plan, summaries)

    def test_total_account_cash_reconciles_without_multiplying_returns(self):
        plan = {"initialCapital": 2000, "capitalMode": "total-account-equal-sleeves",
                "symbols": {"A": {}, "B": {}}}
        batches = []
        for symbol, points, pnl, mean_r in [("A", [1020, 1060], 60, 2), ("B", [990, 960], -40, -1)]:
            batches.append({"symbol": symbol, "results": [{"id": "c", "daily": [
                {"time": (i + 1) * research.DAY - 1, "equity": p} for i, p in enumerate(points)],
                "trades": [{"netPnl": pnl, "rMultiple": mean_r, "side": "long"}],
                "metrics": {"totalReturn": pnl / 1000, "maxDrawdown": min(0, pnl / 1000),
                            "meanR": mean_r, "fees": 1, "funding": .5}}]})
        summary = research.summarize(plan, batches, "c", bootstrap=False)
        self.assertEqual(summary["accountInitialCapital"], 2000)
        self.assertEqual(summary["accountFinalEquity"], 2020)
        self.assertEqual(summary["accountNetPnl"], 20)
        self.assertAlmostEqual(summary["equalSleeveReturn"], .01)
        self.assertAlmostEqual(summary["feesToInitialCapital"], .001)
        legacy = research.summarize({**plan, "initialCapital": 1000, "capitalMode": "independent-equal-sleeves"}, batches, "c", bootstrap=False)
        self.assertEqual(legacy["equalSleeveReturn"], summary["equalSleeveReturn"])
        batches[0]["results"][0]["trades"][0]["netPnl"] += 1
        with self.assertRaisesRegex(ValueError, "reconcile"):
            research.summarize(plan, batches, "c", bootstrap=False)

    def test_replay_cache_binds_execution_inputs_but_not_evaluation_or_presentation(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            plan = json.loads((research.ROOT / "research/trend/slow-plan.json").read_text())
            args = SimpleNamespace(output=folder, manifest=folder / "manifest.json", plan=folder / "plan.json", binary=folder / "trend")
            research.write(args.manifest, {"version": 1})
            research.write(args.plan, plan)
            window = {"id": "development", "start": "2024-01-01", "end": "2024-01-03"}
            candidate = plan["candidates"][0]
            def replay(command, check):
                start, end = int(command[4]), int(command[5])
                research.write(Path(command[6]), {"symbol": "BTCUSDT", "window": window["id"],
                    "startTime": start, "endTime": end, "engine": "test-engine", "planSha256": research.sha(args.plan),
                    "results": [{"id": candidate["id"], "config": research.config(plan, "BTCUSDT", candidate),
                    "metrics": {"finalEquity": 10000}, "trades": [],
                    "warmupStart": start - warmup.warmup_days(candidate) * research.DAY,
                    "daily": [{"time": t, "equity": 10000} for t in range(start + research.DAY - 1, end, research.DAY)]}]})
            with patch.object(research.subprocess, "run", side_effect=replay) as call:
                research.run_symbol(args, plan, window, "BTCUSDT", [candidate], "binary-a")
                research.run_symbol(args, plan, window, "BTCUSDT", [candidate], "binary-a")
                self.assertEqual(call.call_count, 1)
                with patch.object(research, "evaluation_fingerprint", return_value="changed-accounting"):
                    research.run_symbol(args, plan, window, "BTCUSDT", [candidate], "binary-a")
                self.assertEqual(call.call_count, 1)
                with patch.object(research, "REPLAY_VERSION", "changed-execution-protocol"):
                    research.run_symbol(args, plan, window, "BTCUSDT", [candidate], "binary-a")
                self.assertEqual(call.call_count, 2)
                research.write(args.manifest, {"version": 2})
                research.run_symbol(args, plan, window, "BTCUSDT", [candidate], "binary-a")
                self.assertEqual(call.call_count, 3)
                research.write(args.plan, {**plan, "description": "new frozen protocol"})
                research.run_symbol(args, plan, window, "BTCUSDT", [candidate], "binary-a")
                self.assertEqual(call.call_count, 4)

    def test_frozen_evidence_and_run_destinations_cannot_be_written(self):
        for path in ["tmp/trend-methods", "tmp/trend-slow/development/BTCUSDT.json",
                     "research/trend/results.json", "research/trend/methods/REPORT.md"]:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "read-only"):
                artifacts.ensure_writable(research.ROOT / path)
        with self.assertRaisesRegex(ValueError, "read-only"):
            artifacts.ensure_writable(research.ROOT / "research/trend", directory=True)
        artifacts.ensure_writable(research.ROOT / "tmp/new-independent-study", directory=True)
        self.assertEqual(artifacts.verify_frozen(), 11)

    def test_content_addressed_artifacts_are_reused_and_tampering_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            one = artifacts.content_addressed(Path(tmp), b"source-a", ".csv")
            two = artifacts.content_addressed(Path(tmp), b"source-b", ".csv")
            self.assertNotEqual(one, two)
            self.assertEqual(artifacts.content_addressed(Path(tmp), b"source-a", ".csv"), one)
            one.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "modified"):
                artifacts.content_addressed(Path(tmp), b"source-a", ".csv")

    def test_atomic_failure_does_not_publish_partial_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.json"
            artifacts.write(path, {"complete": True})
            with self.assertRaises(ValueError):
                artifacts.write(path, {"bad": float("nan")})
            self.assertEqual(artifacts.read(path), {"complete": True})
            self.assertFalse(list(Path(tmp).glob(".pending-*")))

    def test_existing_manifest_is_reused_without_rewriting_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            plan = folder / "plan.json"
            artifacts.write(plan, {"frozen": "A"})
            manifest = folder / "manifest.json"
            artifacts.write(manifest, {"planSha256": artifacts.sha(plan), "generatorSha256": "historical"})
            original = manifest.read_bytes()
            self.assertTrue(download.reuse_manifest(plan, folder))
            self.assertEqual(manifest.read_bytes(), original)
            with self.assertRaises(FileExistsError):
                artifacts.write_once(manifest, {"changed": True})
            self.assertEqual(manifest.read_bytes(), original)
            artifacts.write(plan, {"frozen": "B"})
            with self.assertRaisesRegex(ValueError, "another frozen plan"):
                download.reuse_manifest(plan, folder)

    def test_orphan_source_csv_is_never_overwritten_or_downloaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            source = cache / "BTCUSDT" / "klines" / "BTCUSDT-1m-2024-01.csv"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"frozen source bytes")
            with patch.object(download.urllib.request, "urlopen", side_effect=AssertionError("must not download")):
                with self.assertRaisesRegex(ValueError, "incomplete cached archive"):
                    download.archive(cache, "BTCUSDT", "klines", "2024-01")
            self.assertEqual(source.read_bytes(), b"frozen source bytes")

    def make_evidence(self, folder):
        plan = json.loads((research.ROOT / "research/trend/methods-plan.json").read_text())
        plan.update(initialCapital=2400, symbols={"AAAUSDT": plan["symbols"]["BTCUSDT"], "BBBUSDT": plan["symbols"]["ETHUSDT"]},
                    candidates=[plan["candidates"][0]], sensitivity=[],
                    bootstrap={"samples": 50, "blockDays": 2, "seed": 13},
                    windows=[{"id": "training", "role": "development", "start": "2024-01-01", "end": "2024-01-03"},
                             {"id": "later-custom-window", "role": "diagnostic", "start": "2025-06-01", "end": "2025-06-04"}])
        plan_path, manifest_path, run = folder / "plan.json", folder / "manifest.json", folder / "run"
        artifacts.write(plan_path, plan)
        plan_hash = artifacts.sha(plan_path)
        artifacts.write(manifest_path, {"planSha256": plan_hash, "warmupPolicy": warmup.WARMUP_POLICY,
                                      "symbols": {symbol: {"archives": [], "fundingSha256": "funding-identity"} for symbol in plan["symbols"]}})
        selection = {"id": plan["baseline"], "binarySha256": "historical-binary", "runnerSha256": "historical-source", "developmentQualified": True,
                     "planSha256": plan_hash, "manifestSha256": artifacts.sha(manifest_path)}
        for window in plan["windows"]:
            start, end = protocol.timestamp(window["start"]), protocol.timestamp(window["end"])
            count = (end - start) // protocol.DAY
            batches = []
            for symbol, gain in [("AAAUSDT", 12), ("BBBUSDT", -6)]:
                candidates = protocol.window_candidates(plan, window, selection)
                configs = [{"id": c["id"], "config": protocol.config(plan, symbol, c, c["id"].endswith("-stress"))} for c in candidates]
                rows = [{"id": c["id"], "config": c["config"], "warmupStart": start - warmup.warmup_days(c["config"]["strategy"]) * protocol.DAY,
                         "daily": [{"time": start + (i + 1) * protocol.DAY - 1, "equity": 1200 + gain * (i + 1) / count} for i in range(count)],
                         "trades": [{"netPnl": gain, "rMultiple": gain / 6, "side": "long"}],
                         "metrics": {"finalEquity": 1200 + gain, "trades": 1, "totalReturn": gain / 1200,
                                     "maxDrawdown": min(0, gain / 1200), "meanR": gain / 6, "fees": 1.2, "funding": .2}}
                        for c in configs]
                batch = {"symbol": symbol, "window": window["id"], "startTime": start, "endTime": end,
                         "planSha256": plan_hash, "engine": "historical-executor", "results": rows}
                path = run / window["id"] / f"{symbol}.json"
                config_path = path.with_name(f"{symbol}-configs.json")
                artifacts.write(path, batch)
                artifacts.write(config_path, configs)
                artifacts.write(path.with_suffix(".receipt.json"), {"resultSha256": artifacts.sha(path),
                    "configsSha256": artifacts.sha(config_path), "binarySha256": selection["binarySha256"],
                    "runnerSha256": selection["runnerSha256"], "manifestSha256": selection["manifestSha256"],
                    "planSha256": plan_hash, "window": window})
                batches.append(batch)
            if protocol.is_development(window):
                artifacts.write(run / "training-summary.json", [evaluation.summarize(plan, batches, plan["baseline"])])
                selection["developmentSha256"] = artifacts.sha(run / "training-summary.json")
        artifacts.write(run / "selection.json", selection)
        return plan_path, manifest_path, run

    def test_historical_audit_survives_source_refactoring_and_checks_warmup(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.make_evidence(Path(tmp))
            with patch.object(artifacts, "evaluation_fingerprint", side_effect=AssertionError("current code is irrelevant")):
                evidence = artifacts.load_evidence(*args)
                batches, _ = artifacts.audit_window(evidence, evidence["plan"]["windows"][0])
            self.assertEqual(evidence["engine"], "historical-executor")
            self.assertEqual(len(batches), 2)
            path = args[2] / "training" / "AAAUSDT.json"
            batch = artifacts.read(path)
            batch["results"][0]["warmupStart"] += protocol.DAY
            artifacts.write(path, batch)
            receipt_path = path.with_suffix(".receipt.json")
            receipt = artifacts.read(receipt_path)
            receipt["resultSha256"] = artifacts.sha(path)
            artifacts.write(receipt_path, receipt)
            with self.assertRaisesRegex(ValueError, "warmup"):
                artifacts.audit_window(evidence, evidence["plan"]["windows"][0])

    def test_generic_report_uses_declared_windows_and_actual_account_capital(self):
        with tempfile.TemporaryDirectory() as tmp:
            evidence = artifacts.load_evidence(*self.make_evidence(Path(tmp)))
            bundle, curves = report.build_bundle(evidence)
            output = report.render_report(bundle)
            self.assertIn("2 个独立固定子账户，总初始资金 2,400.00", output)
            self.assertIn("later-custom-window", output)
            self.assertIn("historical-executor", output)
            self.assertNotIn("60,000", output)
            self.assertFalse(bundle["evaluation"]["selectionRecomputed"])
            self.assertEqual(len(curves), 2)
            self.assertEqual(bundle["pairedComparisons"]["later-custom-window"]["days"], 3)

    def test_v2_report_reads_rust_sleeve_metrics_and_keeps_account_sampling_distinct(self):
        mixed = self.evaluation_fixture()["cases"][0]["daily"]
        opposite = [{**point, "equity": 20000 - point["equity"]} for point in mixed]
        plan, batches = self.v2_batches([mixed, opposite])
        with tempfile.TemporaryDirectory() as tmp:
            evidence = artifacts.load_evidence(*self.make_evidence(Path(tmp)))
            evidence["plan"].update(plan)
            evidence["plan"].update(candidates=[{"id": "c"}], baseline="c", windows=[
                {"id": "known-window", "role": "diagnostic", "start": "2024-01-01", "end": "2024-01-31"}])
            evidence["selection"]["id"] = "c"
            with patch.object(report, "audit_window", return_value=(batches, [])):
                bundle, _ = report.build_bundle(evidence)
            rendered = report.render_report(bundle)
            self.assertEqual(bundle["selection"], evidence["selection"])
            self.assertFalse(bundle["evaluation"]["selectionRecomputed"])
            self.assertEqual(bundle["evaluation"]["singleSleeveEvaluationVersion"], 2)
            self.assertIn("diagnostic", rendered)
            self.assertIn("账户 Calmar 使用日终最大回撤", rendered)
            self.assertIn("| known-window / A | 96.54% | 2.184 | 3.821 | 48.035 | -25.00% | 7.000 | 2.75 |", rendered)
            self.assertEqual(bundle["summaries"]["known-window"][0]["accountEvaluation"]["annualizedReturn"], 0)
            self.assertIn("不从净值重复扣除", rendered)
            old = copy.deepcopy(batches)
            for batch in old:
                del batch["results"][0]["metrics"]["evaluation"]
            evidence["plan"]["windows"].append({"id": "old-window"})
            with patch.object(report, "audit_window", side_effect=[(batches, []), (old, [])]):
                with self.assertRaisesRegex(ValueError, "mixed.*versions.*windows"):
                    report.build_bundle(evidence)

    def test_report_destination_binds_study_and_evaluation_but_allows_layout_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            evidence = artifacts.load_evidence(*self.make_evidence(folder))
            output = folder / "report"
            identity = report.prepare_destination(evidence, output)
            artifacts.write(output / "results.json", {"evaluationIdentity": identity, "reportSourceSha256": "old-layout"})
            self.assertEqual(report.prepare_destination(evidence, output), identity)
            with patch.object(report, "evaluation_fingerprint", return_value="new-statistics"):
                with self.assertRaisesRegex(ValueError, "different study or evaluation"):
                    report.prepare_destination(evidence, output)
            with self.assertRaisesRegex(ValueError, "outside"):
                report.prepare_destination(evidence, evidence["directory"] / "report")
            changed = {**evidence, "manifestSha256": "different-data"}
            with self.assertRaisesRegex(ValueError, "different study or evaluation"):
                report.prepare_destination(changed, output)

    def test_invalid_native_result_is_not_published_with_a_trusted_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            plan_path, manifest_path, historical = self.make_evidence(folder)
            plan = artifacts.read(plan_path)
            args = SimpleNamespace(plan=plan_path, manifest=manifest_path, output=folder / "new-run", binary=folder / "binary")
            source = artifacts.read(historical / "training" / "AAAUSDT.json")
            source["symbol"] = "WRONGUSDT"
            def replay(command, check):
                artifacts.write(Path(command[6]), source)
            with patch.object(research.subprocess, "run", side_effect=replay):
                with self.assertRaisesRegex(ValueError, "identity mismatch"):
                    research.run_symbol(args, plan, plan["windows"][0], "AAAUSDT", plan["candidates"], "new-binary")
            self.assertFalse((args.output / "training" / "AAAUSDT.json").exists())
            self.assertFalse((args.output / "training" / "AAAUSDT.receipt.json").exists())

    def test_active_clis_require_explicit_study_and_destinations(self):
        for name in ["download.py", "research.py", "report.py"]:
            with self.subTest(name=name):
                result = subprocess.run([sys.executable, str(Path(__file__).with_name(name))], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("--plan", result.stderr)
                self.assertIn("--output", result.stderr)

    def test_extracted_statistics_exactly_match_archived_account_evaluator(self):
        archived = Path(__file__).with_name("legacy") / "research.py.txt"
        namespace = {"__file__": str(Path(__file__).with_name("research.py")), "__name__": "archived_research"}
        exec(compile(archived.read_text(), str(archived), "exec"), namespace)
        with tempfile.TemporaryDirectory() as tmp:
            evidence = artifacts.load_evidence(*self.make_evidence(Path(tmp)))
            for window in evidence["plan"]["windows"]:
                batches, _ = artifacts.audit_window(evidence, window)
                for candidate in [row["id"] for row in batches[0]["results"]]:
                    before = namespace["summarize"](evidence["plan"], batches, candidate)
                    after = evaluation.summarize(evidence["plan"], batches, candidate)
                    self.assertEqual(after, before)

    def test_missing_official_daily_minutes_fail_instead_of_interpolating(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            monthly, daily = cache / "monthly.csv", cache / "daily.csv"
            start = download.timestamp("2024-01-01")
            monthly.write_text(f"{start},1,1,1,1,0,{start+59999}\n")
            daily.write_text(monthly.read_text())
            with patch.object(download, "archive", return_value={"path": str(daily), "url": "official-daily"}):
                with self.assertRaisesRegex(ValueError, "daily archive still incomplete"):
                    download.complete_partition(cache, "BTCUSDT", "klines", "2024-01", {"path": str(monthly)})
            self.assertEqual(len(monthly.read_text().splitlines()), 1)

    def test_duplicate_minutes_cannot_be_silently_sorted_into_valid_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            monthly = cache / "monthly.csv"
            start = download.timestamp("2024-01-01")
            row = f"{start},1,1,1,1,0,{start+59999}\n"
            monthly.write_text(row + row)
            with self.assertRaisesRegex(ValueError, "duplicate or invalid"):
                download.complete_partition(cache, "BTCUSDT", "klines", "2024-01", {"path": str(monthly)})


if __name__ == "__main__":
    unittest.main()
