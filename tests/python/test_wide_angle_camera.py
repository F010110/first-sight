import unittest
import numpy as np
from sim.capture.wide_angle_camera import equidistant_fisheye


class WideAngleTests(unittest.TestCase):
    def test_center_and_invalid_corners(self):
        image = np.full((101, 101, 3), 200, np.uint8)
        output, mask = equidistant_fisheye(image, 160)
        self.assertEqual(output.shape, image.shape)
        self.assertTrue(np.all(output[50, 50] == 200))
        self.assertEqual(mask[0, 0], 0)
        self.assertTrue(np.all(output[0, 0] == 0))
        self.assertTrue(np.all(image == 200))

    def test_radial_symmetry(self):
        image = np.full((101, 101), 100, np.uint8)
        _, mask = equidistant_fisheye(image, 160)
        np.testing.assert_array_equal(mask, mask.T)
        np.testing.assert_array_equal(mask, mask[::-1])

    def test_invalid_inputs(self):
        for fov in [0, 180, float('nan')]:
            with self.assertRaises(ValueError):
                equidistant_fisheye(np.zeros((10, 10), np.uint8), fov)
        with self.assertRaises(ValueError):
            equidistant_fisheye(np.zeros((10, 20), np.uint8), 160)


if __name__ == '__main__':
    unittest.main()
