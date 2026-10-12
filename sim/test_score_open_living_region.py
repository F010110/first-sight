import unittest
from score_open_living_region import coarsen


class CoarseLabelsTests(unittest.TestCase):
    def test_explicit_mapping_changes_scenario_without_editing_source(self):
        source = {'labels': {'a': 'kitchen-dining', 'b': 'living-sofa', 'c': 'bedroom'}, 'queries': [
            {'id': 'a', 'label': 'kitchen-dining', 'scenario': 'new', 'historicalIds': []},
            {'id': 'b', 'label': 'living-sofa', 'scenario': 'new', 'historicalIds': ['a']}]}
        result = coarsen(source)
        self.assertEqual(result['queries'][1]['scenario'], 'old')
        self.assertEqual(result['labels']['a'], result['labels']['b'])
        self.assertEqual(result['labels']['c'], 'bedroom')
        self.assertEqual(source['queries'][1]['scenario'], 'new')


if __name__ == '__main__':
    unittest.main()
