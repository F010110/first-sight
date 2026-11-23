import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('range_summary', Path(__file__).resolve().parents[2] / 'scripts/evaluation/summarize-ulvn-operating-range.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(repeat, query, positive):
    return {'backend': 'ulvn', 'repeat': repeat, 'kind': 'retrieval', 'q': query,
            'elapsedMs': 100, 'retrieval': [
                {'radius': radius, 'positiveRefs': ['r'] if positive else [],
                 'geometry': [{'k': k, 'hit': True} for k in [1, 3, 5]] if positive else None,
                 'global': [{'k': k, 'hit': True} for k in [1, 3, 5]] if positive else None}
                for radius in [100, 200, 400]]}


class RangeSummaryTests(unittest.TestCase):
    def test_repeats_do_not_double_accuracy_denominator(self):
        result = module.summarize({'completed': True, 'records': [row(0, 1, True), row(1, 1, True)]})
        labels = result['summary'][1]['physicalRetrievalSensitivity'][0]
        self.assertEqual(labels['eligibleQueries'], 1)
        self.assertEqual(labels['hitCounts']['geometry']['1'], 1)

    def test_no_reference_is_not_a_failed_positive(self):
        result = module.summarize({'completed': True, 'records': [row(1, 1, True), row(1, 2, False)]})
        labels = result['summary'][1]['physicalRetrievalSensitivity'][0]
        self.assertEqual(labels['eligibleQueries'], 1)
        self.assertEqual(labels['archiveWithoutNearReference'], [2])


if __name__ == '__main__':
    unittest.main()
