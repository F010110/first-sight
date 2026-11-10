"""Free protocol/scheduling tests; no model imports/downloads."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ulvn_match', Path(__file__).resolve().parents[2] / 'scripts/media/ulvn_match.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UlvnSchedulingTests(unittest.TestCase):
    def test_all_current_views_before_second_neighbor(self):
        scores = [[.1, .9, .4], [.8, .2, .1], [.3, .5, .7]]
        self.assertEqual(module.geometry_schedule(scores, 2, 4), [(0, 1), (1, 0), (2, 2), (0, 2)])

    def test_budget_is_bounded_and_ties_deterministic(self):
        self.assertEqual(module.geometry_schedule([[1, 1]] * 60, 2, 96).__len__(), 96)
        self.assertEqual(module.geometry_schedule([[1, 1]], 1, 1), [(0, 0)])

    def test_feature_cache_is_bounded(self):
        from collections import OrderedDict
        cache = OrderedDict()
        for i in range(100):
            module.bounded_put(cache, i, str(i), 3)
        self.assertEqual(list(cache), [97, 98, 99])


if __name__ == '__main__':
    unittest.main()
