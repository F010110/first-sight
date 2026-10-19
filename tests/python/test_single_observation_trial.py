import json
import tempfile
import unittest
from pathlib import Path
from sim.hssd.hssd_chunking_trial import partition
from sim.context.single_observation_vlm_trial import usage


class SingleObservationTests(unittest.TestCase):
    def test_no_grouping_means_singletons_not_one_giant_group(self):
        self.assertEqual(partition(['a','b','c'],1),[['a'],['b'],['c']])

    def test_budget_counts_repairs_and_missing_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'attempt-0-response.json').write_text(json.dumps({'usage':{'prompt_tokens':100,'completion_tokens':20,'total_tokens':120}}))
            (root/'attempt-1-response.json').write_text(json.dumps({'usage':{'prompt_tokens':150,'completion_tokens':30,'total_tokens':180}}))
            result=usage(root)
            self.assertEqual(result['requests'],2);self.assertEqual(result['totalTokens'],300)
            self.assertTrue(result['usagePresentInAllResponses'])


if __name__=='__main__':unittest.main()
