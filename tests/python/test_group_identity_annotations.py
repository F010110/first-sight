import unittest
import json
import hashlib
from pathlib import Path
from sim.grouping.vlm_group_identity_annotations_trial import validate, collect_errors, PROMPT
from sim.grouping.vlm_boundary_group_trial import assignments_from_answer


class AnnotationTests(unittest.TestCase):
    def test_frozen_prompt_hash(self):
        contract = json.loads((Path(__file__).resolve().parents[2] / 'docs/research/group-identity-annotations-v3-1.json').read_text(encoding='utf-8'))
        self.assertEqual(contract['promptSha256'], hashlib.sha256(PROMPT.encode()).hexdigest())
    def test_all_errors_reported_with_paths_and_available_refs(self):
        answer = {'regions': [{'groupIds': ['G01', 'G02'], 'reason': 'layout', 'evidence': ['G01:a']}], 'boundaryGroups': [{'groupIds': ['G03'], 'regions': [1]}], 'boundaryObservations': [], 'uncertainGroupIds': [], 'uncertaintyReasons': {}, 'imageAnnotations': []}
        errors = '\n'.join(collect_errors(answer, {'G01', 'G02', 'G03'}, {'G01:a', 'G02:b', 'G03:c'}))
        self.assertIn('G02缺本组引用', errors)
        self.assertIn('G02:b', errors)
        self.assertIn('boundaryGroups[0].reason', errors)
        self.assertIn('boundaryGroups[0].adjacentRegionIndices', errors)
        self.assertIn('G03:c', errors)

    def test_annotation_never_overrides_group(self):
        answer = {'regions': [{'groupIds': ['G01'], 'reason': 'layout', 'evidence': ['G01:a']}], 'boundaryGroups': [], 'boundaryObservations': [], 'uncertainGroupIds': [], 'uncertaintyReasons': {}, 'imageAnnotations': [{'observationRef': 'G01:b', 'kind': 'boundary', 'claimedRegionIndex': None, 'reason': 'doorway'}]}
        groups = {'G01': {'observationIds': ['a', 'b']}}
        validate(answer, groups, {'G01:a', 'G01:b'})
        mapping, _ = assignments_from_answer(answer, groups)
        self.assertEqual(mapping['a'], mapping['b'])
        answer['imageAnnotations'][0]['observationRef'] = 'G01:unshown'
        with self.assertRaises(ValueError):
            validate(answer, groups, {'G01:a', 'G01:b'})


if __name__ == '__main__':
    unittest.main()
