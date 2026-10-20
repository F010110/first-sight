import unittest
import numpy as np
from sim.capture.hardware_camera import load_profile,geometry,project


class HardwareCameraTests(unittest.TestCase):
    def test_profile_preserves_unknown_measured_optics(self):
        p=load_profile('cam/camera-profile.json');model,_,_,_=geometry(p)
        self.assertFalse(p['hardwareCalibration']);self.assertIsNone(p['measuredFovDegrees'])
        self.assertAlmostEqual(model['diagonalFovDegrees'],160)
        self.assertLess(model['horizontalFovDegrees'],160)
        self.assertLess(model['verticalFovDegrees'],model['horizontalFovDegrees'])
    def test_projection_is_rectangular_vga_not_square_with_fake_black_corners(self):
        p=load_profile('cam/camera-profile.json')
        image,model=project(np.full((800,800,3),127,dtype=np.uint8),p)
        self.assertEqual(image.shape,(480,640,3));self.assertTrue(np.all(image==127))
        self.assertFalse(model['hardwareCalibration']);self.assertTrue(model['voRequiresExplicitCalibration'])
    def test_refuses_existing_rectangular_narrow_view_as_wide_source(self):
        with self.assertRaises(ValueError):project(np.zeros((480,640,3),dtype=np.uint8),load_profile('cam/camera-profile.json'))


if __name__=='__main__':unittest.main()
