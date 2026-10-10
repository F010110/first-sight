import math
import unittest
from navigation import fixed_route, align_return_heading


class RouteTest(unittest.TestCase):
    def test_repeats_restore_position_and_initial_heading(self):
        positions = [{"x": 0, "z": z * .25} for z in range(6)]
        positions += [{"x": x * .25, "z": .75} for x in range(1, 4)]
        reachable = {(p["x"], p["z"]) for p in positions}
        for initial in (0, 90, 180, 270):
            route = align_return_heading(fixed_route(positions, positions[0], initial), initial)
            x, z, yaw = 0, 0, initial
            for _ in range(3):
                for action in route:
                    if action == "RotateLeft":
                        yaw = (yaw - 90) % 360
                    elif action == "RotateRight":
                        yaw = (yaw + 90) % 360
                    else:
                        x = round(x + .25 * math.sin(math.radians(yaw)), 4)
                        z = round(z + .25 * math.cos(math.radians(yaw)), 4)
                        self.assertIn((x, z), reachable)
                self.assertEqual((x, z, yaw), (0, 0, initial))


if __name__ == "__main__":
    unittest.main()
