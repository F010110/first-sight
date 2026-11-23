import math
import unittest
from sim.capture.replicacad_smoke import sample_polyline, long_horizon_timeline


class ReplicaCADCaptureTests(unittest.TestCase):
    def test_long_horizon_preserves_elapsed_time_revisits_and_sparse_gaps(self):
        legs = [{'points': [[0, 0, 0], [10, 0, 0]]}, {'points': [[10, 0, 0], [0, 0, 0]]}]
        rows = long_horizon_timeline(legs, 86400)
        self.assertEqual(rows[0]['atMs'], 0)
        self.assertEqual(rows[-1]['atMs'], 86400000)
        self.assertEqual(rows[-1]['position'], [0., 0., 0.])
        self.assertLess(len(rows), 400)
        for a, b in zip(rows, rows[1:]):
            elapsed = (b['atMs']-a['atMs'])/1000
            self.assertGreater(elapsed, 0)
            self.assertLessEqual(math.dist(a['position'], b['position']), elapsed + 1e-8)
        self.assertTrue(any(b['atMs']-a['atMs'] >= 300000 for a, b in zip(rows, rows[1:])))

    def test_long_horizon_refuses_empty_or_impossible_schedule(self):
        for legs, duration in [([], 86400), ([{'points': [[0,0,0], [0,0,0]]}], 86400),
                               ([{'points': [[0,0,0], [10000,0,0]]}], 3600)]:
            with self.assertRaises(ValueError):
                long_horizon_timeline(legs, duration)

    def test_high_fps_renders_actual_intermediate_positions_without_stretching_time(self):
        legs = [{'points': [[0, 0, 0], [10, 0, 0]]}]
        rows = long_horizon_timeline(legs, 3600, travel_spacing=1/15)
        travel = [r for r in rows if r['phase'] == 'scripted-travel']
        self.assertEqual(len(travel), 151)
        self.assertEqual(travel[-1]['atMs'], 10000)
        self.assertTrue(all(66 <= b['atMs']-a['atMs'] <= 67 for a,b in zip(travel,travel[1:])))
        self.assertEqual(rows[-1]['atMs'], 3600000)

    def test_route_samples_preserve_endpoints_and_bound_step(self):
        samples = sample_polyline([[0, 0, 0], [1, 0, 0], [1, 0, -1]])
        self.assertEqual(samples[0][0], [0, 0, 0])
        self.assertEqual(samples[-1][0], [1, 0, -1])
        self.assertTrue(all(math.dist(a[0], b[0]) <= .25 + 1e-9 for a, b in zip(samples, samples[1:])))

    def test_camera_front_negative_z_yaw_is_explicit(self):
        self.assertEqual(sample_polyline([[0, 0, 0], [0, 0, -1]])[0][1], 0)
        self.assertAlmostEqual(sample_polyline([[0, 0, 0], [1, 0, 0]])[0][1], -math.pi / 2)

    def test_invalid_sampling_and_empty_path(self):
        self.assertEqual(sample_polyline([[0, 0, 0], [0, 0, 0]]), [])
        for spacing in [0, -1, math.nan, math.inf]:
            with self.assertRaises(ValueError):
                sample_polyline([[0, 0, 0], [1, 0, 0]], spacing)


if __name__ == '__main__':
    unittest.main()
