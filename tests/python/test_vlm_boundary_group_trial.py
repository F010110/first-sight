import unittest
import hashlib
import json
from pathlib import Path
from sim.grouping.vlm_boundary_group_trial import validate_boundary_answer, assignments_from_answer, review_boundary_detection, quarantine_unsupported_groups, PROMPT


class BoundaryTests(unittest.TestCase):
    def test_frozen_algorithm_prompt_hash(self):
        contract = json.loads((Path(__file__).resolve().parents[2] / 'docs/research/boundary-region-algorithm-v1.json').read_text(encoding='utf-8'))
        self.assertEqual(contract['promptSha256'], hashlib.sha256(PROMPT.encode()).hexdigest())
        self.assertEqual(contract['model'], 'qwen3.8-flash')
    def test_missing_group_citation_quarantines_without_editing_raw(self):
        answer = {'regions': [{'groupIds': ['G01', 'G02'], 'reason': 'room', 'evidence': ['G01:a']}], 'boundaryObservations': [], 'uncertainGroupIds': [], 'uncertaintyReasons': {}}
        result, quarantined = quarantine_unsupported_groups(answer)
        self.assertEqual(quarantined, ['G02'])
        self.assertEqual(result['regions'][0]['groupIds'], ['G01'])
        self.assertEqual(answer['regions'][0]['groupIds'], ['G01', 'G02'])
    def test_boundary_recall_and_core_false_positive_reported(self):
        result = review_boundary_detection([{'observationIds': ['a', 'c']}], [{'observationId': 'a', 'kind': 'boundary'}, {'observationId': 'b', 'kind': 'boundary'}, {'observationId': 'c', 'kind': 'core'}])
        self.assertEqual(result['precisionOnDevelopmentLabels'], .5)
        self.assertEqual(result['recallOnDevelopmentLabels'], .5)
        self.assertEqual(result['coreFalseBoundaries'], ['c'])
    def test_partial_boundary_does_not_erase_core(self):
        groups = {'G01': {'observationIds': ['a', 'b']}, 'G02': {'observationIds': ['c']}}
        answer = {'regions': [{'groupIds': ['G01'], 'reason': 'same instance', 'evidence': ['G01:b']}], 'boundaryGroups': [{'groupIds': ['G02'], 'reason': 'doorway', 'evidence': ['G02:c'], 'adjacentRegionIndices': [1]}], 'boundaryObservations': [{'observationRef': 'G01:a', 'reason': 'entry', 'adjacentRegionIndices': [1]}], 'uncertainGroupIds': [], 'uncertaintyReasons': {}}
        validate_boundary_answer(answer, groups, {'G01:a', 'G01:b', 'G02:c'})
        assignments, boundaries = assignments_from_answer(answer, groups)
        self.assertIsNone(assignments['a']); self.assertIsNotNone(assignments['b']); self.assertIsNone(assignments['c'])
        self.assertEqual(len(boundaries), 2)
        answer['regions'][0]['evidence'] = ['G01:a']
        with self.assertRaises(ValueError):
            validate_boundary_answer(answer, groups, {'G01:a', 'G01:b', 'G02:c'})

    def test_unshown_boundary_reference_fails(self):
        answer = {'regions': [{'groupIds': ['G01'], 'reason': 'room', 'evidence': ['G01:a']}], 'boundaryGroups': [], 'boundaryObservations': [{'observationRef': 'G01:b', 'reason': 'door', 'adjacentRegionIndices': [1]}], 'uncertainGroupIds': [], 'uncertaintyReasons': {}}
        with self.assertRaises(ValueError):
            validate_boundary_answer(answer, {'G01'}, {'G01:a'})


if __name__ == '__main__':
    unittest.main()
