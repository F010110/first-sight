"""Offline research regression suite; never makes model API calls."""
import unittest

MODULES = ['tests.python.test_fixed_region_queries', 'tests.python.test_group_aggregation_trial', 'tests.python.test_full_group_aggregation_trial', 'tests.python.test_vlm_group_aggregation_trial', 'tests.python.test_vlm_boundary_group_trial', 'tests.python.test_build_region_review_site', 'tests.python.test_score_open_living_region', 'tests.python.test_wide_angle_camera', 'tests.python.test_three_view_vo', 'tests.python.test_temporal_classification_standard', 'tests.python.test_grouping_benchmark']

if __name__ == '__main__':
    MODULES.extend(['tests.python.test_boundary_protocol_retries', 'tests.python.test_group_identity_annotations'])
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name) for name in MODULES)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
