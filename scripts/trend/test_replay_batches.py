"""Bound native calls without splitting the study, selection or evidence ledger."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import artifacts
import protocol
import research
from warmup import WARMUP_POLICY, warmup_days


class ReplayBatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.plan = artifacts.read(protocol.ROOT / "research/trend/robustness-plan.json")
        self.rule = self.plan["candidates"][0]
        self.plan.update(symbols={"BTCUSDT": self.plan["symbols"]["BTCUSDT"]}, initialCapital=10000,
                         baseline="c00", fixedCandidate="c00", comparisons=[], sensitivity=[],
                         windows=[{"id": "development", "start": "2024-01-10", "end": "2024-01-13"},
                                  {"id": "later", "start": "2024-01-13", "end": "2024-01-16"}])
        self.window = self.plan["windows"][0]
        self.args = SimpleNamespace(plan=self.folder / "plan.json", manifest=self.folder / "manifest.json",
                                    binary=self.folder / "trend", output=self.folder / "run")
        self.args.binary.write_bytes(b"one frozen native executable identity")
        self.fingerprint = artifacts.sha(self.args.binary)
        self.manifest = {"version": 2, "symbols": {"BTCUSDT": {"fundingSha256": "synthetic-funding", "partitions": [
            {"month": "2023-12", "candles": "unused-dec.csv", "marks": "unused-dec-mark.csv"},
            {"month": "2024-01", "candles": "unused-jan.csv", "marks": "unused-jan-mark.csv"}]}}}
        self.calls = []
        self.configure(33)

    def configure(self, count):
        self.plan["candidates"] = [{**self.rule, "id": f"c{i:02d}", "breakoutBars": 20 if i < 16 else 640,
                                   "channelExitBars": 10 if i < 16 else 320} for i in range(count)]
        self.plan["stressCandidates"] = [row["id"] for row in self.plan["candidates"]]
        artifacts.write(self.args.plan, self.plan)
        self.manifest["planSha256"] = artifacts.sha(self.args.plan)
        artifacts.write(self.args.manifest, self.manifest)

    def native(self, requests, window=None):
        """A candidate's deterministic ledger depends on its own config only."""
        window = window or self.window
        start, end = protocol.timestamp(window["start"]), protocol.timestamp(window["end"])
        rows = []
        for request in requests:
            config = request["config"]
            initial = config["execution"]["initialCapital"]
            gain = (config["strategy"]["breakoutBars"] - config["execution"]["feeBps"]) / 100
            daily = [{"time": time, "equity": initial + gain * (i + 1)}
                     for i, time in enumerate(range(start + protocol.DAY - 1, end, protocol.DAY))]
            net = daily[-1]["equity"] - initial
            rows.append({**request, "warmupStart": start - warmup_days(config["strategy"]) * protocol.DAY,
                         "daily": daily, "trades": [{"netPnl": net, "rMultiple": net / 100, "side": "long"}],
                         "metrics": {"finalEquity": initial + net, "trades": 1, "totalReturn": net / initial,
                                     "maxDrawdown": 0, "meanR": net / 100, "fees": 0, "funding": 0}})
        warmup = min(row["warmupStart"] for row in rows)
        return {"version": 1, "symbol": "BTCUSDT", "window": window["id"], "engine": "synthetic-native",
                "planSha256": artifacts.sha(self.args.plan), "startTime": start, "endTime": end,
                "warmupStart": warmup, "partitions": artifacts.replay_partitions(self.manifest, "BTCUSDT", warmup, end),
                "results": rows}

    def invoke(self, args=None, candidates=None, mutate=None, fail_at=None):
        args = args or self.args
        candidates = candidates or protocol.window_candidates(self.plan, self.window)
        def replay(command, check):
            chunk = artifacts.read(command[3])
            self.assertLessEqual(len(chunk), 16)
            self.calls.append([row["id"] for row in chunk])
            if fail_at == len(self.calls):
                raise subprocess.CalledProcessError(1, command)
            result = self.native(chunk)
            if mutate:
                mutate(result, len(self.calls))
            artifacts.write(Path(command[6]), result)
        with patch.object(research.subprocess, "run", side_effect=replay), contextlib.redirect_stdout(io.StringIO()):
            return research.run_symbol(args, self.plan, self.window, "BTCUSDT", candidates, self.fingerprint)

    def paths(self, args=None):
        output = (args or self.args).output / self.window["id"] / "BTCUSDT.json"
        return output, output.with_suffix(".receipt.json"), output.with_name("BTCUSDT-configs.json")

    def audit(self):
        evidence = {"plan": self.plan, "selection": {"id": "c00", "replayVersion": protocol.REPLAY_VERSION,
                    "binarySha256": self.fingerprint}, "directory": self.args.output,
                    "manifest": self.manifest, "planSha256": artifacts.sha(self.args.plan),
                    "manifestSha256": artifacts.sha(self.args.manifest), "engine": None}
        return artifacts.audit_window(evidence, self.window)

    def test_deterministic_chunks_preserve_all_ledgers_and_individual_warmups(self):
        result = self.invoke()
        self.assertEqual([len(chunk) for chunk in self.calls], [16, 16, 1])
        candidates = protocol.window_candidates(self.plan, self.window)
        requests = protocol.native_requests(self.plan, "BTCUSDT", candidates)
        self.assertEqual(result, self.native(requests))
        self.assertEqual(result["results"][0]["warmupStart"], protocol.timestamp("2024-01-09"))
        self.assertEqual(result["results"][16]["warmupStart"], protocol.timestamp("2023-12-27"))
        self.assertEqual(result["partitions"], ["2023-12", "2024-01"])
        _, receipt_path, _ = self.paths()
        receipt = artifacts.read(receipt_path)
        self.assertEqual(len(receipt["shards"]), 3)
        self.assertEqual(artifacts.read(receipt_path.parent / receipt["shards"][0]["resultPath"])["partitions"], ["2024-01"])
        self.assertEqual(self.audit()[0], [result])

    def test_small_batch_retains_single_native_output_and_matches_large_batch(self):
        large = self.invoke()
        candidates = protocol.window_candidates(self.plan, self.window)[:8]
        args = SimpleNamespace(**{**vars(self.args), "output": self.folder / "small"})
        small = self.invoke(args=args, candidates=candidates)
        self.assertEqual(self.calls[-1], [c.id for c in candidates])
        self.assertEqual(small["results"], large["results"][:8])
        output, receipt, _ = self.paths(args)
        self.assertEqual(output.read_bytes(), (json.dumps(small, indent=2, allow_nan=False) + "\n").encode())
        self.assertNotIn("shards", artifacts.read(receipt))

    def structured_observer(self):
        self.plan["configVersion"] = 10
        self.plan["candidates"] = [{"id": f"c{i:02d}", "entry": "structured-pullback", "filter": "ema",
            "management": "chandelier", "direction": "both", "tradeMinutes": 30, "breakoutBars": 20,
            "stopAtr": 2, "breakEvenAtr": 0, "trailingAtr": 3, "maxCostAtr": 0,
            "structuredPullback": {"keyLevel": "none", "shape": "none", "candle": "none",
                                   "confirmation": "signal-close", "keyRole": "impulse-context"}}
            for i in range(33)]
        artifacts.write(self.args.plan, self.plan)
        self.manifest["planSha256"] = artifacts.sha(self.args.plan)
        artifacts.write(self.args.manifest, self.manifest)
        native = self.native
        def observed(requests, window=None):
            batch = native(requests, window)
            batch["opportunityDiagnostics"] = {"version": 1, "scope": "synthetic shared market observer",
                "results": [{"id": r["id"], "counts": {}, "opportunities": []} for r in requests]}
            return batch
        self.native = observed

    def test_market_opportunity_records_survive_shard_merge_and_receipt_audit(self):
        self.structured_observer()
        result = self.invoke()
        expected_ids = [c["id"] for c in self.plan["candidates"]]
        self.assertEqual([r["id"] for r in result["opportunityDiagnostics"]["results"]], expected_ids)
        self.assertEqual(self.audit()[0], [result])
        small_args = SimpleNamespace(**{**vars(self.args), "output": self.folder / "observed-small"})
        small = self.invoke(args=small_args, candidates=protocol.window_candidates(self.plan, self.window)[:8])
        self.assertEqual(small["opportunityDiagnostics"]["results"], result["opportunityDiagnostics"]["results"][:8])

    def test_missing_or_inconsistent_market_observer_cannot_be_published(self):
        self.structured_observer()
        mutations = [lambda b: b.pop("opportunityDiagnostics"),
                     lambda b: b["opportunityDiagnostics"]["results"].pop(),
                     lambda b: b["opportunityDiagnostics"].update(scope="different-observer")]
        for i, mutation in enumerate(mutations):
            self.calls.clear()
            args = SimpleNamespace(**{**vars(self.args), "output": self.folder / f"observer-invalid-{i}"})
            with self.subTest(i=i), self.assertRaisesRegex(ValueError, "opportunity"):
                self.invoke(args=args, mutate=lambda b, n: mutation(b) if n == 2 else None)
            self.assertFalse(self.paths(args)[0].exists())

    def test_late_failure_publishes_no_merged_result_config_or_receipt(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke(fail_at=3)
        self.assertEqual([len(chunk) for chunk in self.calls], [16, 16, 1])
        for path in self.paths():
            self.assertFalse(path.exists(), path)
        self.assertFalse(list(self.args.output.rglob("*-shards")))

    def test_failed_replacement_preserves_prior_complete_evidence(self):
        self.invoke()
        originals = {path: path.read_bytes() for path in self.paths()}
        self.manifest["description"] = "different frozen input identity"
        artifacts.write(self.args.manifest, self.manifest)
        self.calls.clear()
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke(fail_at=3)
        self.assertEqual({path: path.read_bytes() for path in self.paths()}, originals)

    def test_invalid_last_shard_cannot_publish(self):
        def wrong_cash(result, index):
            if index == 3:
                result["results"][0]["metrics"]["finalEquity"] += 1
        with self.assertRaisesRegex(ValueError, "reconcile"):
            self.invoke(mutate=wrong_cash)
        self.assertFalse(self.paths()[0].exists())
        self.assertFalse(self.paths()[1].exists())

    def test_mixed_engine_source_warmup_or_order_cannot_merge(self):
        mutations = [lambda b: b.update(engine="another-engine"),
                     lambda b: b.update(partitions=["2024-01"]),
                     lambda b: b.update(warmupStart=b["warmupStart"] + protocol.DAY),
                     lambda b: b["results"].reverse()]
        for index, mutation in enumerate(mutations):
            self.calls.clear()
            args = SimpleNamespace(**{**vars(self.args), "output": self.folder / f"invalid-{index}"})
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.invoke(args=args, mutate=lambda batch, number: mutation(batch) if number == 2 else None)
            self.assertFalse(self.paths(args)[0].exists())

    def test_cache_revalidates_retained_shards_without_reexecution(self):
        result = self.invoke()
        first_calls = len(self.calls)
        self.assertEqual(self.invoke(), result)
        self.assertEqual(len(self.calls), first_calls)
        self.audit()

    def test_tampered_child_is_rejected_by_cache_and_historical_audit(self):
        self.invoke()
        output, receipt_path, _ = self.paths()
        shard = artifacts.read(receipt_path)["shards"][1]
        path = output.parent / shard["resultPath"]
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "shard checksum"):
            self.invoke()
        with self.assertRaisesRegex(ValueError, "shard checksum"):
            self.audit()
        self.assertEqual(len(self.calls), 3)

    def test_child_hash_update_does_not_hide_a_merge_mismatch(self):
        self.invoke()
        output, receipt_path, _ = self.paths()
        receipt = artifacts.read(receipt_path)
        shard = receipt["shards"][1]
        path = output.parent / shard["resultPath"]
        child = artifacts.read(path)
        child["results"][0]["metrics"]["meanR"] += 1
        artifacts.write(path, child)
        shard["resultSha256"] = artifacts.sha(path)
        artifacts.write(receipt_path, receipt)
        with self.assertRaisesRegex(ValueError, "differs from its validated native shards"):
            self.audit()

    def test_changed_input_identity_during_execution_is_rejected(self):
        def mutation(result, index):
            if index == 3:
                self.args.binary.write_bytes(b"different native binary")
        with self.assertRaisesRegex(ValueError, "changed during execution"):
            self.invoke(mutate=mutation)
        self.assertFalse(self.paths()[0].exists())

    def test_base_and_expanded_caps_do_not_change_development_stress_rules(self):
        self.configure(64)
        protocol.validate_plan(self.plan)
        self.assertEqual(len(protocol.window_candidates(self.plan, self.window)), 64)
        later = protocol.window_candidates(self.plan, self.plan["windows"][1], {"id": "c00"})
        self.assertEqual(len(later), 128)
        self.assertEqual(sum(c.cost_scenario == "stress" for c in later), 64)
        self.plan["sensitivity"] = [{"id": "extra", "stopAtr": 3}]
        with self.assertRaisesRegex(ValueError, "128"):
            protocol.validate_plan(self.plan)
        self.configure(65)
        with self.assertRaisesRegex(ValueError, "64"):
            protocol.validate_plan(self.plan)

    def test_v3_uses_explicit_costs_while_only_older_protocols_use_suffix(self):
        candidate = protocol.Candidate("named-stress", {}, "base")
        for version in ["trend-native-replay-3", "trend-native-replay-4"]:
            self.assertEqual(protocol.recorded_candidates([candidate], version)[0].cost_scenario, "base")
        for version in [None, "trend-native-replay-1", "trend-native-replay-2"]:
            self.assertEqual(protocol.recorded_candidates([candidate], version)[0].cost_scenario, "stress")

    def test_research_window_allows_1096_complete_utc_days_only(self):
        self.configure(1)
        self.plan["windows"][0].update(start="2020-01-01", end="2023-01-01")
        protocol.validate_plan(self.plan)
        self.plan["windows"][0]["end"] = "2023-01-02"
        with self.assertRaisesRegex(ValueError, "1096"):
            protocol.validate_plan(self.plan)


if __name__ == "__main__":
    unittest.main()
