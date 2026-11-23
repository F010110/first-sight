import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ravel_bpl_run', Path(__file__).resolve().parents[2] / 'scripts/evaluation/run-ulvn-ravel-bpl.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RavelBplScoreTests(unittest.TestCase):
    def test_forced_assignment_outside_map_is_not_positive_success(self):
        predictions = [
            {'nearestReferenceXY': 30, 'nearestReferenceDZ': 0, 'bplXY': 40, 'bplDZ': 0,
             'vprXY': 500, 'vprDZ': 0, 'bplMs': 1},
            {'nearestReferenceXY': 1000, 'nearestReferenceDZ': 0, 'bplXY': 1000, 'bplDZ': 0,
             'vprXY': 1000, 'vprDZ': 0, 'bplMs': 2},
        ]
        scored = module.score(predictions, None)['physicalLocalization'][0]
        self.assertEqual(scored['eligible'], 1)
        self.assertEqual(scored['bplCorrect'], 1)
        self.assertEqual(scored['vprCorrect'], 0)
        self.assertEqual(scored['outsideReferenceCoverage'], 1)

    def test_wrong_floor_is_not_correct_even_at_same_xy(self):
        predictions = [{'nearestReferenceXY': 20, 'nearestReferenceDZ': 0,
                        'bplXY': 0, 'bplDZ': 200, 'vprXY': 30, 'vprDZ': 0, 'bplMs': 1}]
        scored = module.score(predictions, None)['physicalLocalization'][0]
        self.assertEqual(scored['bplCorrect'], 0)
        self.assertEqual(scored['vprCorrect'], 1)


if __name__ == '__main__':
    unittest.main()
