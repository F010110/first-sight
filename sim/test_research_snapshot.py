"""Offline research regression suite; never makes model API calls."""
import unittest

MODULES = ['test_fixed_region_queries', 'test_group_aggregation_trial', 'test_full_group_aggregation_trial', 'test_vlm_group_aggregation_trial', 'test_vlm_boundary_group_trial', 'test_build_region_review_site', 'test_score_open_living_region', 'test_wide_angle_camera', 'test_three_view_vo', 'test_temporal_classification_standard', 'test_grouping_benchmark']

if __name__ == '__main__':
    MODULES.extend(['test_boundary_protocol_retries', 'test_group_identity_annotations'])
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name) for name in MODULES)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
