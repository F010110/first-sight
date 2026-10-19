import unittest
import numpy as np
from sim.spatial.continuous_motion_evidence import assess

class MotionTests(unittest.TestCase):
    def test_compensation_and_translation_candidates(self):
        points=np.array([(x,y) for x in [40,140,240] for y in [40,80,140,180,240,280]],dtype=float)
        self.assertEqual(assess(points,points,np.eye(3),320,320)['status'],'rotation-explained')
        self.assertEqual(assess(points,points+[12,0],np.eye(3),320,320)['status'],'movement-candidate')

    def test_concentrated_or_insufficient_tracks_abstain(self):
        points=np.array([[40,40]]*18,dtype=float)
        self.assertEqual(assess(points,points+[12,0],np.eye(3),320,320)['status'],'unknown')
        self.assertEqual(assess(points[:2],points[:2],np.eye(3),320,320)['status'],'unknown')

if __name__=='__main__':unittest.main()
