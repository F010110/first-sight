import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/evaluation'))
from ulvn_local_domains import investigate


class LocalDomainTests(unittest.TestCase):
    def setup_case(self):
        old=[]
        for index in range(140):
            old.extend({'ordinal':index+1,'direction':d,'sha256':f'h{index}-{d}'} for d in ['front','left','right'])
        current=[{'direction':d,'sha256':'q'+d} for d in ['front','left','right']]
        history=np.tile(np.eye(3,dtype=np.float32)*.1,(140,1))
        history[134*3:135*3]=np.eye(3)
        history[136*3:137*3]=np.eye(3)*1.1
        class Matcher:
            def verify(self,q,h):
                ok=h['ordinal']==137 or h['ordinal']==135 and q['direction']==h['direction']=='right'
                return {'inliers':100 if ok else 10,'ratio':.6 if ok else .2,'good':150}
        return Matcher(),current,np.eye(3),old,history,{i:'place' for i in range(130,139)}

    def test_partial_representative_match_finds_local_other_view(self):
        args=self.setup_case()
        result=investigate(*args,[134],140,{})
        self.assertIn(137,[c['historicalOrdinal'] for c in result['candidates'] if c['supported']])
        self.assertTrue(all(131<=c['historicalOrdinal']<=139 for c in result['candidates']))
        self.assertLessEqual(result['geometryPairs'],24)

    def test_budget_exhaustion_is_explicit_not_a_negative_verdict(self):
        result=investigate(*self.setup_case(),[134],140,{},pair_budget=1)
        self.assertTrue(result['budgetExhausted'])
        self.assertEqual(result['geometryPairs'],1)
        self.assertFalse(any(c['supported'] for c in result['candidates']))


if __name__=='__main__':
    unittest.main()
