import copy
import unittest

from setup_diagnostics import audit_snapshot, summarize


def trade():
    return {"entryTime": 101, "entrySignal": {"time": 100, "boundary": 120, "trigger": {
        "kind": "structured-pullback", "impulseStartTime": 10, "impulseConfirmedAt": 20,
        "impulseEndTime": 30, "pullbackStartedAt": 40, "impulseExtreme": 120,
        "referenceAtr": 2, "strengthAtr": 2, "efficiency": .8,
        "pullbackBars": 12, "retracement": .3,
        "turns": [{"kind": "low", "time": 50, "confirmedAt": 70, "price": 114}],
        "pivot": {"pivotTime": 1, "confirmedAt": 5, "retestTime": 60},
        "ema": {"observedAt": 8, "validatedAt": 9, "retestTime": 60},
    }}}


class SetupDiagnosticsTests(unittest.TestCase):
    def test_signal_close_can_confirm_a_prior_turn_but_not_a_future_turn(self):
        value = trade()
        trigger = value["entrySignal"]["trigger"]
        trigger.update({"confirmation": "signal-close", "keyRole": "impulse-context",
                        "gates": dict.fromkeys(("retracement", "key", "shape", "candle"), True)})
        trigger["turns"][0]["confirmedAt"] = 100
        policy = {"confirmation": "signal-close", "keyRole": "impulse-context"}
        audit_snapshot(value, policy)
        for changed in ("confirmation", "future", "gate", "policy"):
            wrong = copy.deepcopy(value)
            t = wrong["entrySignal"]["trigger"]
            if changed == "confirmation":
                t["confirmation"] = "before-breakout"
            elif changed == "future":
                t["turns"][0]["confirmedAt"] = 101
            elif changed == "gate":
                t["gates"]["key"] = False
            else:
                t["keyRole"] = "pullback-retest"
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                audit_snapshot(wrong, policy)

    def test_future_confirmation_retest_and_same_close_fill_are_rejected(self):
        audit_snapshot(trade())
        for change in ["turn", "pivot", "ema", "retest", "fill", "boundary"]:
            value = trade()
            trigger = value["entrySignal"]["trigger"]
            if change == "turn":
                trigger["turns"][0]["confirmedAt"] = 100
            elif change in ("pivot", "ema"):
                trigger[change]["confirmedAt" if change == "pivot" else "validatedAt"] = 11
            elif change == "retest":
                trigger["ema"]["retestTime"] = 100
            elif change == "fill":
                value["entryTime"] = 100
            else:
                value["entrySignal"]["boundary"] = 121
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit_snapshot(value)

    def test_multi_label_counts_do_not_become_unique_trades(self):
        row = {"id": "primary", "config": {"strategy": {"entry": "structured-pullback"}},
               "trades": [trade()], "researchDiagnostics": {"eventCounts": {"signal:structured-pullback": 1},
                   "acceptedShapeCounts": {"twoLegs": 1, "doubleTest": 1}, "completedTrades": 1}}
        result = summarize([{"symbol": "A", "results": [row]},
                            {"symbol": "B", "results": [copy.deepcopy(row)]}])
        self.assertEqual(result["candidates"]["primary"]["completedTrades"], 2)
        self.assertEqual(sum(result["candidates"]["primary"]["acceptedShapeCounts"].values()), 4)
        row["researchDiagnostics"]["completedTrades"] = 2
        with self.assertRaisesRegex(ValueError, "ledger"):
            summarize([{"symbol": "A", "results": [row]}])


if __name__ == "__main__":
    unittest.main()
