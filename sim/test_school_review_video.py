import unittest
from build_school_review_video import episode_plan
from attach_school_review_calendar import attach
import tempfile
import json
from pathlib import Path


class EpisodePlanTests(unittest.TestCase):
    def test_never_join_episodes_or_use_synthetic_activity_gaps(self):
        samples = [{'episode': 2, 'sourceAtMs': 2000, 'activityAtMs': 999999},
                   {'episode': 1, 'sourceAtMs': 0, 'activityAtMs': 0},
                   {'episode': 2, 'sourceAtMs': 0, 'activityAtMs': 999997}]
        plan = episode_plan(samples)
        self.assertEqual(len(plan), 2)
        self.assertEqual([r['sourceAtMs'] for r in plan[2]], [0, 2000])

    def test_duplicate_timestamps_rejected(self):
        with self.assertRaises(ValueError):
            episode_plan([{'episode': 1, 'sourceAtMs': 0}, {'episode': 1, 'sourceAtMs': 0}])

    def test_additive_calendar_keeps_data_and_review_fingerprint_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = {'fingerprint': 'old-review-key', 'samples': [{'id': 'o', 'episode': 1, 'sourceAtMs': 0, 'activityAtMs': 10}]}
            (root / 'data.json').write_text(json.dumps(data))
            original = (root / 'data.json').read_bytes()
            clock = {'clock': {'kind': 'assumed', 'wallOrigin': '2026-10-18T09:00:00+08:00', 'sourceOriginMs': 10, 'offsetMinutes': 480}, 'observations': [{'id': 'o', 'recordedTime': '2026-10-18T09:00:00+08:00'}]}
            (root / 'clock.json').write_text(json.dumps(clock))
            attach(root, root / 'clock.json')
            self.assertEqual((root / 'data.json').read_bytes(), original)
            self.assertEqual(json.loads((root / 'calendar.json').read_text(encoding='utf8'))['fingerprint'], 'old-review-key')
            with self.assertRaises(ValueError): attach(root, root / 'clock.json')


if __name__ == '__main__': unittest.main()
