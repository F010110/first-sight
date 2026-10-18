import unittest
from build_school_review_video import episode_plan


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


if __name__ == '__main__': unittest.main()
