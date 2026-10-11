import unittest
import numpy as np
from revisit_geometry import verify

class RevisitGeometryTests(unittest.TestCase):
    def fixture(self):
        rng=np.random.default_rng(19)
        points=rng.uniform(.15,.85,(100,2)).astype(np.float32)
        descriptors=rng.uniform(0,255,(100,128)).astype(np.float32)
        return points,descriptors
    def test_translated_shared_surface_is_verified(self):
        p,d=self.fixture()
        result=verify((p,d),(p+[.04,-.025],d.copy()))
        self.assertIsNotNone(result)
        self.assertEqual(result['inliers'],100)
    def test_concentrated_shared_object_does_not_verify_context(self):
        p,d=self.fixture();p=p*.1+.4
        self.assertIsNone(verify((p,d),(p+[.04,-.025],d.copy())))
    def test_unrelated_positions_reject_even_identical_descriptors(self):
        p,d=self.fixture();q=np.random.default_rng(27).uniform(.15,.85,(100,2)).astype(np.float32)
        self.assertIsNone(verify((p,d),(q,d.copy())))
    def test_missing_features_abstain(self):
        self.assertIsNone(verify((np.zeros((0,2)),None),(np.zeros((0,2)),None)))

if __name__=='__main__':unittest.main()
