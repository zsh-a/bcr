"""Review export preserves failed/frozen research and does not fabricate missing runs."""
import copy
import json
from pathlib import Path
import unittest

from review import review_bundle

ROOT = Path(__file__).resolve().parents[2]


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.bundle = json.loads((ROOT / "research/trend/structured-v2/development/results.json").read_text())
        self.identity = self.bundle["evaluationIdentity"]
        self.receipt = json.loads((ROOT / "research/trend/structured-v2/development-seal.json").read_text())

    def test_real_failed_development_is_not_promoted_or_reselected(self):
        original = copy.deepcopy(self.bundle)
        result = review_bundle(self.bundle, self.identity, self.receipt)
        self.assertEqual(result["selected"], "sp-context")
        self.assertEqual(result["verdict"]["status"], "fail")
        self.assertEqual(result["verdict"]["scope"], "development-base-only")
        self.assertEqual(result["verdict"]["stage"], "development")
        self.assertEqual(len(result["rows"]), len(self.bundle["summaries"]["development"]))
        self.assertEqual([w["id"] for w in result["windows"]], ["development"])
        self.assertEqual(self.bundle, original)
        self.assertTrue(any(f["status"] == "fail" and f["actual"] < 0 for f in result["findings"]
                            if f["code"] == "basePositiveReturn"))

    def test_unbound_qualification_is_only_a_record_not_formal_acceptance(self):
        result = review_bundle(self.bundle, self.identity)
        self.assertEqual(result["verdict"]["status"], "unbound")
        self.assertTrue(all(f["status"] == "info" for f in result["findings"]))

    def test_rejects_receipt_from_another_raw_run_even_when_candidate_matches(self):
        self.receipt["rawIdentity"]["rawResultsSha256"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "another run"):
            review_bundle(self.bundle, self.identity, self.receipt)

    def test_rejects_candidate_identity_with_different_effective_risk(self):
        self.bundle["summaries"]["development"][0]["risk"]["riskPct"] = .2
        with self.assertRaisesRegex(ValueError, "parameters change"):
            review_bundle(self.bundle, self.identity)


if __name__ == "__main__":
    unittest.main()
