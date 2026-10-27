"""No models or API required. Validate integration and noise semantics."""
import unittest
import numpy as np
from scipy.spatial.transform import Rotation
from imu_memory_noise import InertialPose


class TestInertial(unittest.TestCase):
    def test_ideal_round_trip(self):
        sim = InertialPose('ideal_imu')
        p = np.eye(4)
        p[1, 3] = 1.5
        sim.advance(p)
        for xyz, deg in [([0,1.5,0],90), ([1,1.5,0],90), ([1,1.5,1],180), ([0,1.5,0],0)]:
            q = np.eye(4)
            q[:3, 3] = xyz
            q[:3, :3] = Rotation.from_euler('y',deg,degrees=True).as_matrix()
            est = sim.advance(q)
            self.assertLess(np.linalg.norm(q[:3,3]-est[:3,3]), .002)
            self.assertLess(Rotation.from_matrix(q[:3,:3].T@est[:3,:3]).magnitude(), 1e-5)

    def test_reproducible_not_reset(self):
        out = []
        for _ in range(2):
            sim = InertialPose('bmi_like', 42)
            p = np.eye(4)
            sim.advance(p)
            p[:3,:3] = Rotation.from_euler('y',120,degrees=True).as_matrix()
            q = sim.advance(p)
            self.assertGreater(np.linalg.norm(q[:3,3]-p[:3,3]), 1e-5)
            before = sim.time
            q2 = sim.advance(p)
            self.assertGreater(sim.time, before)
            self.assertGreater(np.linalg.norm(q2[:3,3]-p[:3,3]), 1e-5)
            out.append(q2)
        np.testing.assert_array_equal(*out)

    def test_bandwidth_conversion(self):
        sim = InertialPose('bmi_like')
        self.assertAlmostEqual(np.rad2deg(sim.ng)*np.sqrt(2), .014)
        self.assertAlmostEqual(sim.na*np.sqrt(2)/9.80665*1e6,175)


if __name__ == '__main__':
    unittest.main()
