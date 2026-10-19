import unittest
from sim.grouping.group_aggregation_trial import aggregate


class AggregationTests(unittest.TestCase):
    def test_two_anchors_can_propose_union_without_mutation(self):
        assignments = {'a1': 'a', 'a2': 'a', 'b1': 'b', 'b2': 'b'}
        result, candidates, applied = aggregate(assignments, {('a1', 'b1'): .8, ('a2', 'b2'): .8})
        self.assertEqual(len(set(result.values())), 1)
        self.assertEqual(len(applied), 1)
        self.assertEqual(assignments['b1'], 'b')

    def test_one_repeated_anchor_and_single_link_chain_do_not_merge(self):
        assignments = {'a1': 'a', 'a2': 'a', 'b1': 'b', 'b2': 'b', 'c1': 'c', 'c2': 'c'}
        evidence = {('a1', 'b1'): .8, ('a1', 'b2'): .8}
        self.assertEqual(len(aggregate(assignments, evidence)[2]), 0)
        evidence = {('a1', 'b1'): .8, ('a2', 'b2'): .8, ('b1', 'c1'): .8, ('b2', 'c2'): .8}
        self.assertEqual(len(set(aggregate(assignments, evidence)[0].values())), 2)


if __name__ == '__main__':
    unittest.main()
