import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('reconcile',Path(__file__).with_name('reconcile-jsg.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ReconciliationTests(unittest.TestCase):
    def test_offline_queries_fail_when_not_frozen(self):
        with tempfile.TemporaryDirectory() as folder:
            queries=module.FrozenQueries(Path(folder))
            with self.assertRaisesRegex(RuntimeError,'uncaptured'): queries.query('SELECT 1')

    def test_comparison_detects_cash_and_positions_even_when_equity_matches(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            day={'date':'2026-04-07','cash':100,'equity':1000,'breadth':[], 'targets':None,'holdings':[{'code':'A','quantity':100}], 'orders':[]}
            (root/'p').write_text(json.dumps(day)+'\n')
            day['cash']=200;day['holdings'][0]['quantity']=80
            (root/'r').write_text(json.dumps(day)+'\n')
            module.compare(root/'p',root/'r',root/'report')
            self.assertEqual(json.loads((root/'report').read_text())['differences'], {'cash':1,'holdings':1})

if __name__=='__main__':unittest.main()
