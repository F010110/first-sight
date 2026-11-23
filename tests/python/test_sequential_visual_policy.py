import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sequential_visual_policy', Path(__file__).resolve().parents[2] / 'scripts/evaluation/sequential_visual_policy.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def evidence(current, historical, current_hash=None, historical_hash=None):
    return {'inliers': 80, 'ratio': .5, 'currentDirection': current,
            'historicalDirection': historical, 'currentSHA256': current_hash or current,
            'historicalSHA256': historical_hash or historical}


class SequentialVisualPolicyTests(unittest.TestCase):
    def test_selected_pairs_cover_both_camera_sets_before_duplicates(self):
        pairs = module.select_direction_pairs([[.99, .98, .97], [.96, .9, .1], [.95, .2, .8]])
        self.assertEqual(pairs[:3], [(0, 0), (1, 1), (2, 2)])
        self.assertEqual(len(pairs), 4)

    def test_one_view_never_confirms_revisit(self):
        self.assertFalse(module.independent_view_support([evidence('right', 'right')]))
        self.assertFalse(module.independent_view_support([evidence('right', 'right'), evidence('right', 'left')]))

    def test_two_distinct_camera_correspondences_support_revisit(self):
        self.assertTrue(module.independent_view_support([evidence('front', 'left'), evidence('right', 'front')]))

    def test_duplicate_pixels_are_not_independent_views(self):
        self.assertFalse(module.independent_view_support([evidence('front', 'left', 'same'), evidence('right', 'front', 'same')]))

    def test_time_gap_or_recording_switch_disables_continuity(self):
        previous = {'ordinal': 1, 'sourceTimeMs': 0, 'recordingId': 'a'}
        self.assertTrue(module.continuous_sources(previous, {'ordinal': 2, 'sourceTimeMs': 500, 'recordingId': 'a'}))
        self.assertFalse(module.continuous_sources(previous, {'ordinal': 2, 'sourceTimeMs': 5000, 'recordingId': 'a'}))
        self.assertFalse(module.continuous_sources(previous, {'ordinal': 2, 'sourceTimeMs': 500, 'recordingId': 'b'}))

    def test_provisional_continuity_does_not_swallow_confirmed_revisit(self):
        def candidate(group, confirmed, belief):
            return {'group': group, 'identityConfirmed': confirmed, 'belief': belief,
                    'anchorEvidence': {'best': {'inliers': 100}}}
        supported = {0: candidate(0, False, .99), 1: candidate(1, True, .01)}
        self.assertEqual(module.choose_supported_group(supported, 0)['group'], 1)


if __name__ == '__main__':
    unittest.main()
