"""Boundary tests for event identification and forward labels, without market data."""
import copy
import unittest

import numpy as np

from breakout_study import (MINUTE, DAY, bootstrap_weights, breaks, detect_episodes,
                            first_hit, label_event, prior_high, reference_fill,
                            study_symbol, summarize, trading_candles, validate_minutes,
                            validate_study, wilder_atr)

BASE = 1704067200000


def minutes(count, start=BASE):
    t = start + np.arange(count) * MINUTE
    return np.column_stack((t, np.full(count,100.), np.full(count,101.),
                            np.full(count,99.), np.full(count,100.),
                            np.ones(count), t+MINUTE-1))


def bars(count):
    return trading_candles(minutes(count*30))


class BreakoutStudyTests(unittest.TestCase):
    def test_complete_utc_aggregation_crosses_partitions_and_rejects_gaps(self):
        source=minutes(91,BASE+MINUTE)
        joined=np.concatenate((source[:41],source[41:]))
        result=trading_candles(joined)
        self.assertEqual(result.shape,(2,6))
        self.assertEqual(result[:,0].tolist(),[BASE+30*MINUTE,BASE+60*MINUTE])
        self.assertEqual(result[:,5].tolist(),[30,30])
        with self.assertRaisesRegex(ValueError,"missing or unordered"):
            trading_candles(np.delete(source,45,axis=0))
        invalid=source.copy();invalid[1,6]+=1
        with self.assertRaises(ValueError):validate_minutes(invalid)

    def test_native_wilder_seed_and_previous_channel_exclude_signal_candle(self):
        values=bars(16)
        values[:,2]=100+np.arange(1,17)/2
        values[:,3]=100-np.arange(1,17)/2
        atr=wilder_atr(values)
        self.assertEqual(atr[13],7.5)
        self.assertAlmostEqual(atr[14],(7.5*13+15)/14)
        upper=prior_high(values,3)
        self.assertTrue(np.isnan(upper[2]))
        self.assertEqual(upper[3],101.5)
        self.assertNotEqual(upper[3],values[3,2])

    def test_tick_tolerance_and_adverse_fills_follow_native_not_decimal_idealization(self):
        for tick,price in [(0.1,94100.1),(.00001,.1023),(.01,100.1)]:
            self.assertTrue(breaks(price+tick,price,tick))
            self.assertFalse(breaks(price+tick*.999,price,tick))
            atr=min(2.013,price*.02)
            entry,stop,risk=reference_fill(price,atr,tick)
            self.assertGreaterEqual(entry+1e-9,price*1.0002)
            self.assertLessEqual(stop,entry-2*atr+1e-9)
            self.assertLess(risk-2*atr,tick+1e-9)

    def test_shared_episode_is_frozen_and_rearm_bar_cannot_retrigger(self):
        values=bars(48);upper=np.full(48,100.);atr=np.full(48,2.)
        values[20,4]=101;values[21,4]=103;upper[21]=102
        values[22,4]=100;upper[22]=99
        values[23,4]=102;upper[23]=101
        values[45,4]=101
        episodes,raw=detect_episodes(values,atr,upper,.1,BASE+20*30*MINUTE,BASE+48*30*MINUTE)
        self.assertEqual([e["index"] for e in episodes],[20,23,45])
        self.assertEqual(raw,5)
        self.assertEqual([e["sharedNonoverlap"] for e in episodes],[True,False,True])
        self.assertEqual(episodes[0]["boundary"],100)

    def test_window_resets_episode_while_prewindow_bars_only_seed_indicators(self):
        values=bars(45);values[:,4]=102
        episodes,_=detect_episodes(values,np.ones(45),np.full(45,101.),.1,
                                  BASE+30*30*MINUTE,BASE+45*30*MINUTE)
        self.assertEqual([e["index"] for e in episodes],[30])

    def test_buffer_only_first_close_and_two_close_uses_frozen_level_and_second_atr(self):
        minute_data=minutes(60*30)
        values=trading_candles(minute_data)
        values[20,4]=101.1;values[20,2]=103
        values[21,4]=101.5;values[21,2]=104
        atr=np.full(60,2.);atr[21]=3.
        records,_=study_symbol("TEST",{"id":"test","start":"2024-01-01","end":"2024-01-02"},
                                values,atr,minute_data,.1,lookbacks=(20,))
        record=records[0];policies=record["policies"]
        self.assertEqual(record["boundary"],101)
        self.assertFalse(policies["close-buffer"]["accepted"])
        self.assertTrue(policies["two-close"]["accepted"])
        self.assertEqual(policies["two-close"]["atr"],3)
        self.assertEqual(policies["two-close"]["entryTime"],BASE+22*30*MINUTE)
        self.assertEqual(policies["close-tick"]["entryTime"],BASE+21*30*MINUTE)
        self.assertTrue(policies["close-tick"]["falseBreak"])

    def test_open_precedes_ambiguous_intraminute_extremes(self):
        paths=minutes(2)
        paths[0,1:5]=[100,102,98,100]
        self.assertEqual(first_hit(paths,99,101,.01)["status"],"ambiguous")
        paths[0,1]=102
        self.assertEqual(first_hit(paths,99,101,.01)["status"],"target")
        self.assertEqual(first_hit(paths,99,101,.01)["phase"],"open")
        paths[0,1]=98
        self.assertEqual(first_hit(paths,99,101,.01)["status"],"stop")
        paths[0,1:5]=[100,102,99.5,100]
        paths[1,3]=98
        self.assertEqual(first_hit(paths,99,101,.01)["status"],"target")

    def test_1r_can_be_ambiguous_while_2r_is_a_definite_stop(self):
        paths=minutes(1);paths[0,1:5]=[100,101.5,98,100]
        self.assertEqual(first_hit(paths,99,101,.01)["status"],"ambiguous")
        self.assertEqual(first_hit(paths,99,102,.01)["status"],"stop")

    def test_exact_decimal_target_is_hit_without_promoting_a_real_price_shortfall(self):
        entry,stop,risk=reference_fill(1.01,.01,.1)
        target=entry+risk
        self.assertGreater(target,1.2)
        paths=minutes(1);paths[0,1:5]=[1.1,1.2,1.1,1.2]
        self.assertEqual(first_hit(paths,stop,target,.1)["status"],"target")
        paths[0,2]=1.2-.0000001
        self.assertEqual(first_hit(paths,stop,target,.1)["status"],"horizon-censored")
        paths[0,1:5]=[1.2,1.3,.9,1.1]
        self.assertEqual(first_hit(paths,stop,target,.1)["status"],"target")

    def test_full_horizon_censoring_differs_from_deleted_tail_and_extrema_survive_early_stop(self):
        path=minutes(60*30);values=trading_candles(path);atr=np.full(60,2.)
        complete=label_event(20,101,values,atr,path,.01,BASE+60*30*MINUTE)
        self.assertFalse(complete["tailExcluded"])
        self.assertEqual(complete["targets"]["2"]["status"],"horizon-censored")
        tail=label_event(50,101,values,atr,path,.01,BASE+60*30*MINUTE)
        self.assertTrue(tail["tailExcluded"])
        self.assertNotIn("targets",tail)
        path[20*30+29,2]=1000 # Before reference entry: must not pollute MFE.
        path[21*30+1,3]=90 # Stop first.
        path[21*30+100,2]=110 # Later MFE belongs to the fixed horizon nonetheless.
        full=label_event(20,101,values,atr,path,.01,BASE+60*30*MINUTE)
        self.assertEqual(full["targets"]["2"]["status"],"stop")
        self.assertAlmostEqual(full["mfeR"],(110-full["entryPrice"])/full["priceR"])

    def test_summary_uses_all_base_episodes_for_coverage_and_separates_each_outcome(self):
        records=[]
        for i,status in enumerate(["target","stop","ambiguous","horizon-censored"]):
            o={"accepted":True,"rejection":None,"tailExcluded":False,"falseBreak":bool(i%2),
               "mfeR":1,"maeR":1,"targets":{"1":{"status":status},"2":{"status":status}}}
            records.append({"baseTime":BASE+i*MINUTE,"policies":{d:copy.deepcopy(o) for d in
                ("close-tick","close-buffer","two-close")}})
        records[0]["policies"]["close-buffer"]={"accepted":False,"rejection":"buffer-not-met"}
        weights=bootstrap_weights(1,{"samples":20,"seed":1,"blockDays":7})
        base=summarize(records,"close-tick",BASE,BASE+DAY,weights)
        self.assertEqual(base["targets"]["2"]["withinHorizonLower"],.25)
        self.assertEqual(base["targets"]["2"]["withinHorizonUpper"],.5)
        buffered=summarize(records,"close-buffer",BASE,BASE+DAY,weights)
        self.assertEqual(buffered["coverage"],.75)
        self.assertEqual(buffered["skippedBase2R"]["target"],1)
        self.assertEqual(buffered["targets"]["2"]["horizon-censored"],1)
        self.assertEqual(buffered["calendarBlockIntervals95"]["coverage"]["interval"],[.75,.75])
        self.assertTrue(np.all(weights.sum(axis=1)==1))

    def test_frozen_numeric_scope_rejects_an_undeclared_threshold_grid(self):
        from artifacts import read
        from pathlib import Path
        plan=read(Path(__file__).resolve().parents[2]/"research/trend/thirty-minute-plan.json")
        validate_study(plan)
        plan["breakoutStudy"]["bufferAtr"]=.5
        with self.assertRaises(ValueError):validate_study(plan)


if __name__=="__main__":
    unittest.main()
