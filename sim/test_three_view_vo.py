import unittest
import cv2
import numpy as np
from three_view_vo import classify_view,combine

class VOTests(unittest.TestCase):
    def test_votes_and_rotation_abstention(self):
        v=lambda s:{'status':s}
        self.assertEqual(combine([v('translation-candidate'),v('translation-candidate'),v('unknown')]),'movement-candidate')
        self.assertEqual(combine([v('translation-candidate'),v('translation-candidate'),v('rotation')]),'unknown')
        self.assertEqual(combine([v('rotation'),v('rotation'),v('unknown')]),'skipped-rotation')
        self.assertEqual(combine([v('unknown')]*3),'unknown')
    def test_identical_textured_image(self):
        rng=np.random.default_rng(7)
        image=cv2.GaussianBlur(rng.integers(0,256,(320,320),dtype=np.uint8),(3,3),0)
        self.assertEqual(classify_view(image,image)['status'],'no-visible-motion')
    def test_textureless_abstains(self):
        image=np.zeros((320,320),np.uint8)
        self.assertEqual(classify_view(image,image)['status'],'unknown')
    def test_intrinsics_are_explicit_for_non_square_camera(self):
        image=np.zeros((240,320),np.uint8)
        with self.assertRaises(ValueError):classify_view(image,image)
        k={'fx':160,'fy':160,'cx':160,'cy':120,'width':320,'height':240}
        self.assertEqual(classify_view(image,image,k)['reason'],'no-descriptors')
        k['width']=640
        with self.assertRaises(ValueError):classify_view(image,image,k)

if __name__=='__main__':unittest.main()
