import importlib.util
from pathlib import Path
import random
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/evaluation'))

spec = importlib.util.spec_from_file_location('budget', Path(__file__).resolve().parents[2] / 'scripts/evaluation/benchmark-ulvn-window-budget.py')
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)


class WindowBudgetTests(unittest.TestCase):
    def test_stop_after_support_preserves_complete_nine_pair_predicate(self):
        rng = random.Random(11)
        for _ in range(300):
            pairs = [{'inliers': rng.choice([12, 59, 60, 110]), 'ratio': rng.choice([.2, .35, .6]),
                      'currentDirection': str(i), 'historicalDirection': str(j),
                      'currentSHA256': 'q'+str(i), 'historicalSHA256': 'h'+str(j)} for i in range(3) for j in range(3)]
            rng.shuffle(pairs)
            prefix = []
            for pair in pairs:
                prefix.append(pair)
                if budget.independent(prefix):
                    break
            self.assertEqual(budget.independent(prefix), budget.independent(pairs))

    def test_identical_pixels_do_not_become_two_independent_cameras(self):
        pairs = [{'inliers': 100, 'ratio': .6, 'currentDirection': str(i),
                  'historicalDirection': str(i), 'currentSHA256': 'same',
                  'historicalSHA256': str(i)} for i in range(2)]
        self.assertFalse(budget.independent(pairs))


if __name__ == '__main__':
    unittest.main()
