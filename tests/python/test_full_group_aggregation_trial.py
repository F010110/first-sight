import unittest
from sim.grouping.full_group_aggregation_trial import hierarchy, affinity


class FullAggregationTests(unittest.TestCase):
    def test_all_groups_and_originals_preserved_until_one(self):
        original = {'a': 'A', 'b': 'B', 'c': 'C'}
        levels = hierarchy(original, {('a', 'b'): .8})
        self.assertEqual([len(level['groups']) for level in levels], [3, 2, 1])
        self.assertEqual(levels[1]['merge']['affinity'], .8)
        self.assertTrue(levels[2]['merge']['forcedUnsupported'])
        self.assertEqual(set(levels[-1]['groups'][0]['observations']), set(original))
        self.assertEqual(original['b'], 'B')

    def test_large_group_not_supported_by_single_matching_member(self):
        self.assertEqual(affinity(['a', 'b'], ['c'], {('a', 'c'): 1}), .5)
        self.assertEqual(affinity(['c'], ['a', 'b'], {('a', 'c'): 1}), .5)


if __name__ == '__main__':
    unittest.main()
