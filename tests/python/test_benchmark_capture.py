import unittest
from sim.capture.benchmark_capture import add_rotation_probes, split_recorded_turns

class ProbeTests(unittest.TestCase):
    def test_disabled_preserves_route(self):
        self.assertEqual(add_rotation_probes(['MoveAhead', 'RotateLeft'], 0), ['MoveAhead', 'RotateLeft'])

    def test_probes_preserve_translation_and_heading(self):
        original = ['MoveAhead', 'RotateLeft', 'MoveAhead', 'MoveAhead']
        result = add_rotation_probes(original, 2)
        self.assertEqual(result.count('MoveAhead'), 3)
        self.assertEqual(result.count('RotateRight'), 8)
        self.assertEqual(result.count('RotateLeft'), 1)

    def test_varied_angles_restore_heading(self):
        for direction in [1,-1]:
            result = add_rotation_probes(['MoveAhead'], 1, [direction*a for a in [15,30,45,60,90,120]])
            rotations = [a for a in result if isinstance(a,dict)]
            self.assertEqual(sum(a['degrees'] for a in rotations),720)
            self.assertEqual(len(rotations),12)
        with self.assertRaises(ValueError): add_rotation_probes([],1,[30,90])

    def test_real_small_actions_preserve_turn_events_and_route(self):
        result=split_recorded_turns([{'action':'RotateRight','degrees':120},'MoveAhead','RotateLeft'],15)
        self.assertEqual(len(result),15)
        self.assertEqual(sum(r['degrees'] for r in result if isinstance(r,dict) and r['action']=='RotateRight'),120)
        self.assertEqual(sum(r['degrees'] for r in result if isinstance(r,dict) and r['action']=='RotateLeft'),90)
        self.assertEqual(result[8],'MoveAhead')

if __name__ == '__main__': unittest.main()
