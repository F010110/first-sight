import unittest
from build_region_review_site import make_payload


class ReviewSiteTests(unittest.TestCase):
    def test_prediction_and_ai_labels_separate_sorted_and_boundary_preserved(self):
        windows = [{'endTick': 3}, {'endTick': 6}]
        report = {'finalAssignments': {'observation-2': None, 'observation-1': 'region-1'}, 'boundaryGroups': [{'observationIds': ['observation-2'], 'reason': 'door'}]}
        labels = {'labels': [{'observationId': 'observation-1', 'kind': 'core', 'regions': ['human-convention']}]}
        data = make_payload(windows, report, labels)
        self.assertEqual(data['samples'][0]['id'], 'observation-1')
        self.assertEqual(data['samples'][0]['prediction'], 'region-1')
        self.assertEqual(data['samples'][0]['aiReview']['regions'], ['human-convention'])
        self.assertEqual(data['samples'][1]['boundary']['reason'], 'door')

    def test_misaligned_and_nonchronological_inputs_fail(self):
        report = {'finalAssignments': {'observation-1': None}}
        with self.assertRaises(ValueError):
            make_payload([], report)
        report['finalAssignments']['observation-2'] = None
        with self.assertRaises(ValueError):
            make_payload([{'endTick': 6}, {'endTick': 3}], report)


if __name__ == '__main__':
    unittest.main()
