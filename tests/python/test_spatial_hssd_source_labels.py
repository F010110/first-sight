import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('source_labels', Path(__file__).resolve().parents[2] / 'scripts/datasets/label-spatial-hssd-source.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourcePolygonLabels(unittest.TestCase):
    def setUp(self):
        self.region = {'floor_height': 0, 'poly_loop': [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]], 'label': 'room'}

    def test_core_edge_buffer_and_unknown_do_not_use_nearest_region(self):
        self.assertEqual(module.classify([2, 0, 2], [self.region], .35)[:2], ('core', 0))
        self.assertEqual(module.classify([.2, 0, 2], [self.region], .35)[:2], ('boundary', None))
        self.assertEqual(module.classify([0, 0, 2], [self.region], .35)[:2], ('boundary', None))
        self.assertEqual(module.classify([-1, 0, 2], [self.region], .35)[:2], ('unknown', None))
        self.assertEqual(module.classify([2, 2, 2], [self.region], .35)[:2], ('unknown', None))

    def test_overlapping_regions_not_arbitrarily_resolved_and_invalid_geometry_rejected(self):
        self.assertEqual(module.classify([2, 0, 2], [self.region, self.region], .35)[:2], ('boundary', None))
        with self.assertRaises(ValueError):
            module.classify([float('nan'), 0, 0], [self.region], .35)
        with self.assertRaises(ValueError):
            module.classify([2, 0, 2], [{'poly_loop': []}], .35)


if __name__ == '__main__':
    unittest.main()
