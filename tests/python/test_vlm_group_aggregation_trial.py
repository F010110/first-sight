import unittest
from sim.grouping.vlm_group_aggregation_trial import validate_answer


class VlmAnswerTests(unittest.TestCase):
    def test_complete_partition_and_explicit_uncertainty(self):
        answer = {'regions': [{'groupIds': ['G01'], 'reason': 'structure', 'evidence': ['G01:a']}], 'uncertainGroupIds': ['G02'], 'uncertaintyReasons': {'G02': 'not enough'}}
        validate_answer(answer, ['G01', 'G02'], {'G01:a'})
        answer['regions'][0]['groupIds'].append('G02')
        with self.assertRaises(ValueError):
            validate_answer(answer, ['G01', 'G02'], {'G01:a'})

    def test_invented_evidence_rejected(self):
        answer = {'regions': [{'groupIds': ['G01'], 'reason': 'structure', 'evidence': ['G02:b']}], 'uncertainGroupIds': []}
        with self.assertRaises(ValueError):
            validate_answer(answer, ['G01'], {'G02:b'})


if __name__ == '__main__':
    unittest.main()
