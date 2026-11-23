import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('policy',Path(__file__).resolve().parents[2]/'scripts/evaluation/ulvn_continuity_policy.py')
policy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class RepresentativesTests(unittest.TestCase):
    def test_farthest_selection_retains_different_views_not_regular_time_samples(self):
        self.assertEqual(policy.farthest_representatives([0,1,2,9,10],3,lambda a,b:abs(a-b)),[0,10,2])

    def test_small_place_preserves_all_sources(self):
        self.assertEqual(policy.farthest_representatives([4,7],8,lambda a,b:abs(a-b)),[4,7])

    def test_ties_are_deterministic_and_do_not_duplicate_sources(self):
        result=policy.farthest_representatives(list(range(20)),8,lambda a,b:0)
        self.assertEqual(result,list(range(8)))

    def test_domain_has_finite_radius(self):
        self.assertEqual(policy.bounded_domain(10,{i:'a' for i in range(30)},4),list(range(6,15)))

    def test_domain_does_not_jump_another_place_or_unassigned_gap(self):
        self.assertEqual(policy.bounded_domain(5,{3:'a',4:'b',5:'a',6:'a',8:'a'},4),[5,6])


if __name__=='__main__':
    unittest.main()
