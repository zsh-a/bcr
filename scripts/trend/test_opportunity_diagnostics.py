import copy
import unittest

import numpy as np

from opportunity_diagnostics import (FIXED, MINUTE, PERIOD, barrier_hit, cash_outcome,
                                    audit_shared_market_set, compare_events, declared_contrast,
                                    label_opportunity, reference_entry,
                                    summarize_events, validate_observer, validate_plan)

BASE = 1_735_689_600_000
EXECUTION = {"tickSize": .01, "feeBps": 5, "slippageBps": 2}


def candles(count, price=100):
    return np.asarray([[BASE+i*MINUTE, price, price+.1, price-.1, price, 1,
                        BASE+(i+1)*MINUTE-1] for i in range(count)], dtype=float)


def event(side="long", time=BASE-1):
    checks = dict.fromkeys(("retracement", "key", "shape", "candle"), True)
    return {"side": side, "entrySignal": {"time": time, "price": 100, "atr": 1,
            "boundary": 99, "trigger": {"kind": "structured-pullback", "setupId": time-10*PERIOD,
                "impulseExtreme": 102 if side == "long" else 98, "impulseStartPrice": 100,
                "confirmation": "before-breakout", "keyRole": "pullback-retest", "gates": checks.copy()}},
            "checks": checks, "screenPassed": True, "keyGeometry": {}}


def label(value=None, minutes=None, funding=None, end=None, execution=None, marks=None):
    minutes = candles(48*30) if minutes is None else minutes
    return label_opportunity(value or event(), minutes, minutes if marks is None else marks,
                             funding or [], EXECUTION if execution is None else execution,
                             BASE-PERIOD, BASE+len(minutes)*MINUTE if end is None else end)


class OpportunityDiagnosticsTests(unittest.TestCase):
    def test_later_stage_missing_ablation_is_not_run_and_shared_set_includes_stress(self):
        contrast = {"id": "a", "reference": "strict", "candidate": "confirm"}
        result = declared_contrast(contrast, {"context": [], "base": []})
        self.assertEqual(result["status"], "not-run")
        self.assertNotIn("matched", result)
        observed = [{"id": "context", "opportunities": [event()]},
                    {"id": "context-stress", "opportunities": [event()]}]
        self.assertEqual(audit_shared_market_set(observed)["sharedFirstBreaks"], 1)
        observed[1]["opportunities"] = []
        with self.assertRaisesRegex(ValueError, "identities"):
            audit_shared_market_set(observed)

    def test_protocol_disallows_unfrozen_horizon_or_barrier_search(self):
        value = {**copy.deepcopy(FIXED), "contrasts": [{"id": "a", "reference": "a", "candidate": "b"},
                                                       {"id": "b", "reference": "a", "candidate": "c"}]}
        validate_plan(value, {"a", "b", "c"})
        for key, wrong in (("horizonsBars", [24]), ("targetsR", [3]), ("adverseR", 2)):
            changed = copy.deepcopy(value); changed[key] = wrong
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_plan(changed, {"a", "b", "c"})

    def test_entry_and_costs_mirror_sides_and_never_subtract_slippage_twice(self):
        for side in ("long", "short"):
            entry, stop, distance = reference_entry(100, 1, side, EXECUTION)
            self.assertAlmostEqual(entry, 100.02 if side == "long" else 99.98)
            self.assertAlmostEqual(stop, 98.02 if side == "long" else 101.98)
            self.assertAlmostEqual(distance, 2)
            out = cash_outcome(100, entry, 100, side, distance, EXECUTION, .01)
            self.assertAlmostEqual(out["grossBeforeCostsR"], 0)
            self.assertAlmostEqual(out["netR"], out["grossFillR"]-out["feesR"]-out["fundingR"])
            self.assertAlmostEqual(out["netR"], -out["slippageAndRoundingR"]-out["feesR"]-out["fundingR"])

    def test_open_precedes_unordered_range_on_both_sides(self):
        for side in ("long", "short"):
            path = candles(1)
            stop, target = (98, 102) if side == "long" else (102, 98)
            path[0, 1:5] = [103 if side == "long" else 97, 104, 96, 100]
            hit = barrier_hit(path, side, stop, target, .01)
            self.assertEqual((hit["status"], hit["phase"]), ("target", "open"))
            path[0, 1] = 100
            hit = barrier_hit(path, side, stop, target, .01)
            self.assertEqual((hit["status"], hit["phase"]), ("ambiguous", "range"))
            path[0, 1] = 97 if side == "long" else 103
            self.assertEqual(barrier_hit(path, side, stop, target, .01)["status"], "stop")

    def test_exact_tick_representation_is_reached_but_real_shortfall_is_not(self):
        path = candles(1, 1.1); path[0, 2:5] = [1.2, 1.1, 1.1]
        target = 1.1 + (1.1-1.)
        self.assertGreater(target, 1.2)
        self.assertEqual(barrier_hit(path, "long", 1., target, .1)["status"], "target")
        path[0, 2] = 1.2-1e-7
        self.assertEqual(barrier_hit(path, "long", 1., target, .1)["status"], "horizon-censored")

    def test_full_fixed_horizon_excursions_continue_after_the_first_stop(self):
        path = candles(48*30)
        path[0, 3] = 97
        path[300, 2] = 110
        value = label(minutes=path)
        horizon = value["horizons"]["12"]
        self.assertEqual(horizon["targets"]["1"]["status"], "stop")
        self.assertAlmostEqual(horizon["mfeR"], (110-value["entryPrice"])/value["initialPriceR"])
        self.assertGreater(horizon["mfeR"], 4)

    def test_tail_is_excluded_per_horizon_not_misreported_as_timeout(self):
        value = label(minutes=candles(12*30))
        self.assertEqual(value["horizons"]["12"]["status"], "complete")
        self.assertEqual(value["horizons"]["12"]["targets"]["1"]["status"], "horizon-censored")
        self.assertEqual(value["horizons"]["48"]["status"], "tail-excluded")
        no_entry = event(time=BASE+12*PERIOD-1)
        value = label(no_entry, minutes=candles(12*30))
        self.assertEqual(value["entryStatus"], "sample-tail-no-entry")
        self.assertTrue(all(h["status"] == "tail-excluded" for h in value["horizons"].values()))

    def test_missing_minute_is_a_data_error_not_censoring(self):
        path = np.delete(candles(48*30), 50, axis=0)
        with self.assertRaises(ValueError):
            label(minutes=path, end=BASE+48*PERIOD)

    def test_funding_excludes_entry_minute_includes_exit_and_respects_side(self):
        path = candles(48*30)
        marks = candles(48*30, price=200)
        funding = [{"time": BASE, "rate": .01}, {"time": BASE+MINUTE, "rate": .001},
                   {"time": BASE+12*PERIOD-MINUTE, "rate": -.0005},
                   {"time": BASE+12*PERIOD, "rate": .02}]
        for side in ("long", "short"):
            value = label(event(side), path, funding, marks=marks)
            self.assertAlmostEqual(value["horizons"]["12"]["fixedHorizon"]["fundingR"],
                                   (.2-.1)/2*(1 if side == "long" else -1))
            self.assertAlmostEqual(value["horizons"]["48"]["fixedHorizon"]["fundingR"],
                                   (.2-.1+4)/2*(1 if side == "long" else -1))

    def test_ambiguity_reports_two_costed_outcomes_without_picking_a_path(self):
        path = candles(48*30); path[1, 2:4] = [105, 97]
        value = label(minutes=path)
        target = value["horizons"]["12"]["targets"]["2"]
        self.assertEqual(target["status"], "ambiguous")
        self.assertNotIn("outcome", target)
        self.assertLess(target["outcomeBounds"]["stopFirst"]["netR"], -1)
        self.assertLess(target["outcomeBounds"]["targetFirst"]["netR"], 2)

    def test_denominators_include_censored_ambiguous_and_exclude_only_tail(self):
        events = [label() for _ in range(4)]
        for i, status in enumerate(("target", "ambiguous", "horizon-censored")):
            events[i]["horizons"]["12"]["targets"]["1"]["status"] = status
        events[3]["horizons"]["12"] = {"status": "tail-excluded"}
        result = summarize_events(events)["horizons"]["12"]["all"]
        self.assertEqual((result["complete"], result["tailExcluded"]), (3, 1))
        self.assertAlmostEqual(result["targets"]["1"]["definiteTargetRate"], 1/3)
        self.assertAlmostEqual(result["targets"]["1"]["targetRateUpperBound"], 2/3)

    def test_pairs_keep_same_episode_and_report_unmatched_instead_of_forcing_match(self):
        left = label(); left["screenPassed"] = False; left["checks"]["key"] = False
        right = copy.deepcopy(left); right["screenPassed"] = True; right["checks"]["key"] = True
        extra = copy.deepcopy(right); extra["entrySignal"]["trigger"]["setupId"] += 1
        result = compare_events([left], [right, extra])
        self.assertEqual((result["matched"], result["candidateOnly"]), (1, 1))
        self.assertEqual(result["screenTransitionsReferenceToCandidate"], {"fail->pass": 1})
        self.assertEqual(result["addedAccepted"]["firstBreaks"], 1)
        extra["entrySignal"]["trigger"]["setupId"] -= 1
        with self.assertRaisesRegex(ValueError, "duplicate"):
            compare_events([left], [right, extra])

    def test_observer_identity_and_parallel_gate_boolean_contract(self):
        policy = {"confirmation": "before-breakout", "keyRole": "pullback-retest"}
        observed = {"id": "a", "warmupStart": BASE,
                    "counts": {"setup:sp-first-break": 1, "setup:sp-accepted": 1}, "opportunities": [event()]}
        batch = {"results": [{"id": "a", "warmupStart": BASE,
                             "config": {"strategy": {"structuredPullback": policy}}}],
                 "opportunityDiagnostics": {"version": 1, "scope": FIXED["scope"], "results": [observed]}}
        validate_observer(batch)
        observed["opportunities"][0]["checks"]["key"] = False
        with self.assertRaisesRegex(ValueError, "conjunction"):
            validate_observer(batch)


if __name__ == "__main__":
    unittest.main()
