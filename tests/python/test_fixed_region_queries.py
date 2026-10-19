import unittest
from sim.grouping.fixed_region_queries import score_queries


class FixedQueriesTests(unittest.TestCase):
    def test_delayed_repair_and_fixed_scenarios(self):
        contract = {'labels': {'a': 'room', 'b': 'room', 'c': 'other'}, 'queries': [
            {'id': 'a', 'atMs': 0, 'label': 'room', 'scenario': 'new', 'historicalIds': []},
            {'id': 'b', 'atMs': 1, 'label': 'room', 'scenario': 'old', 'historicalIds': ['a']}]}
        snapshots = [{'atMs': 0, 'assignments': {'a': 'one'}}, {'atMs': 1, 'assignments': {'a': 'one', 'b': 'two'}}, {'atMs': 2, 'assignments': {'a': 'one', 'b': 'one', 'c': 'other'}}]
        self.assertEqual(score_queries(contract, snapshots, 0)['overall']['correct'], 1)
        self.assertEqual(score_queries(contract, snapshots)['overall']['correct'], 2)
        snapshots[-1]['assignments']['c'] = 'one'
        self.assertEqual(score_queries(contract, snapshots)['overall']['correct'], 0)

    def test_abstention_stays_in_denominator(self):
        contract = {'labels': {'a': 'room'}, 'queries': [{'id': 'a', 'atMs': 0, 'label': 'room', 'scenario': 'new', 'historicalIds': []}]}
        result = score_queries(contract, [{'atMs': 0, 'assignments': {'a': None}}])
        self.assertEqual(result['overall']['accuracy'], 0)
        self.assertEqual(result['overall']['outcomes']['unknown'], 1)


if __name__ == '__main__':
    unittest.main()
