import unittest
import cv2
import numpy as np
from sim.grouping.automatic_boundary_tracks import portal,BoundaryTracker,overlap

class BoundaryTests(unittest.TestCase):
    def test_geometric_candidate_is_not_crossing(self):
        image=np.zeros((320,320),np.uint8);cv2.rectangle(image,(90,30),(230,290),255,3)
        self.assertIsNotNone(portal(image))
        tracker=BoundaryTracker()
        for i in range(8):
            result=tracker.step(f'{i:04d}.jpg',image,'no-visible-motion')
            self.assertEqual(result['events'],[])
    def test_rotation_and_unknown_reset_hypotheses(self):
        image=np.zeros((320,320),np.uint8);cv2.rectangle(image,(90,30),(230,290),255,3)
        tracker=BoundaryTracker();tracker.step('1.jpg',image,'movement-candidate')
        tracker.step('2.jpg',image,'movement-candidate');self.assertIsNotNone(tracker.active)
        tracker.step('3.jpg',image,'skipped-rotation');self.assertIsNone(tracker.active)
    def test_blank_view_abstains(self):
        self.assertIsNone(portal(np.zeros((320,320),np.uint8)))
    def test_unrelated_rectangles_are_not_the_same_track(self):
        self.assertEqual(overlap([0,0,.2,.8],[.7,0,1,.8]),0)
        self.assertEqual(overlap([.2,.1,.8,.9],[.2,.1,.8,.9]),1)
    def test_post_view_can_confirm_after_movement_stops(self):
        tracker=BoundaryTracker()
        tracker.active={'track':'inferred','mode':'open-layout','hist':np.zeros(68),'age':0,'passed':True,'post':0}
        image=np.full((320,320),200,np.uint8)
        result=tracker.step('4.jpg',image,'no-visible-motion')
        self.assertTrue(any(e['kind']=='post-boundary-support' for e in result['events']))
    def test_expanding_then_disappearing_opening_produces_ordered_inferred_events(self):
        tracker=BoundaryTracker();events=[]
        for i,width in enumerate([120,140,190],1):
            image=np.zeros((320,320),np.uint8)
            cv2.rectangle(image,(160-width//2,30),(160+width//2,290),255,3)
            events.extend(tracker.step(f'{i:04d}.jpg',image,'movement-candidate')['events'])
        after=np.full((320,320),200,np.uint8)
        events.extend(tracker.step('0004.jpg',after,'movement-candidate')['events'])
        for i in [5,6]:events.extend(tracker.step(f'{i:04d}.jpg',after,'no-visible-motion')['events'])
        kinds=[e['kind'] for e in events]
        self.assertIn('boundary-approach',kinds);self.assertIn('boundary-passage',kinds)
        self.assertEqual(kinds.count('post-boundary-support'),2)

if __name__=='__main__':unittest.main()
