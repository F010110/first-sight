import unittest
from record_hssd import region_at, indoor_scope
from prelabel_hssd import validate


def square(label='office', height=0, offset=0):
    return {'label':label, 'floor_height':height, 'poly_loop':[[offset,0,0],[offset+2,0,0],[offset+2,0,2],[offset,0,2]]}


class IndoorCaptureTests(unittest.TestCase):
    def test_indoor_and_outside(self):
        self.assertEqual(region_at([1,0,1],[square()]),0)
        self.assertIsNone(region_at([3,0,1],[square()]))

    def test_roof_and_other_floor_are_not_indoor(self):
        self.assertIsNone(region_at([1,3,1],[square()]))
        self.assertEqual(region_at([1,3,1],[square(height=3)]),0)

    def test_exterior_and_overlap_rejected(self):
        for label in ['outdoor','balcony','porch/terrace/deck/driveway']:
            self.assertIsNone(region_at([1,0,1],[square(label)]))
            self.assertIsNone(region_at([1,0,1],[square(),square(label)]))

    def test_empty_polygon_and_missing_region(self):
        self.assertIsNone(region_at([1,0,1],[]))
        self.assertIsNone(region_at([1,0,1],[{'label':'office'}]))

    def test_prelabels_preserve_unknown_and_reject_missing_inventory(self):
        row = {'observationId':'observation-1','kind':'unknown','regions':[],'reason':'证据不足'}
        self.assertEqual(validate({'labels':[row]},['observation-1']),[row])
        with self.assertRaises(ValueError):
            validate({'labels':[row]},['observation-1','observation-2'])

    def test_prelabels_reject_duplicate_and_false_boundary_schema(self):
        row = {'observationId':'observation-1','kind':'boundary','regions':['走廊'],'reason':'门可见'}
        with self.assertRaises(ValueError):
            validate({'labels':[row]},['observation-1'])
        with self.assertRaises(ValueError):
            validate({'labels':[row,row]},['observation-1','observation-2'])

    def test_small_unlabelled_doorway_not_outdoor_or_physical_identity(self):
        self.assertIsNone(region_at([2.2,0,1],[square()]))
        self.assertTrue(indoor_scope([2.2,0,1],[square()]))
        self.assertFalse(indoor_scope([2.6,0,1],[square()]))
        self.assertFalse(indoor_scope([2.2,0,1],[square(),square('outdoor',offset=2)]))


if __name__ == '__main__':
    unittest.main()
