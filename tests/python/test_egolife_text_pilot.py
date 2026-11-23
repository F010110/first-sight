"""Guards for the explicitly non-native, provided-text QA pilot."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('egolife_text_pilot', Path(__file__).resolve().parents[2] / 'scripts/evaluation/run-egolife-text-pilot.py')
pilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pilot)


class TextPilotTest(unittest.TestCase):
    def records(self):
        return pilot.evidence_records([
            {'doc_id': 'past', 'date': 'DAY1', 'start_time': '11000000', 'end_time': '11000100', 'caption_text': 'A red cup on desk', 'transcript_text': 'Jake: cup', 'fine_caption': 'SECRET_ENRICHMENT'},
            {'doc_id': 'overlapping_future', 'date': 'DAY1', 'start_time': '11000000', 'end_time': '12000000', 'caption_text': 'red cup future'},
        ])

    def test_end_time_not_start_time_controls_access(self):
        task = {'question': 'Where cup?', 'choices': {'A': 'desk'}, 'cutoffMs': pilot.AUDIT.clock('DAY1', '11300000')['cutoffMs']}
        selected = pilot.retrieve(task, self.records())
        self.assertEqual([r['id'] for r in selected], ['past'])

    def test_excludes_enrichment(self):
        self.assertNotIn('SECRET', json.dumps(self.records()))

    def test_duplicate_ids_rejected(self):
        row = {'doc_id': 'same', 'date': 'DAY1', 'start_time': '11000000', 'end_time': '11000100', 'caption_text': 'cup'}
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            pilot.evidence_records([row, row])

    def test_empty_history_is_empty(self):
        task = {'question': 'cup?', 'choices': {}, 'cutoffMs': 0}
        self.assertEqual(pilot.retrieve(task, self.records()), [])

    def test_character_limit(self):
        task = {'question': 'cup?', 'choices': {}, 'cutoffMs': 999999999}
        self.assertEqual(pilot.retrieve(task, self.records(), char_limit=1), [])


if __name__ == '__main__':
    unittest.main()
