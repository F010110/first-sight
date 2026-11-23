"""Synthetic unit fixtures only; never count these as game/runtime samples."""
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

audit = load('game_audit', 'scripts/datasets/audit-game-generator-environment.py')
validator = load('game_validate', 'scripts/datasets/validate-gmod-capture.py')
imu = load('game_imu', 'scripts/datasets/gmod-trajectory-to-imu.py')
installer = load('game_install', 'scripts/datasets/install-gmod-capture-addon.py')
readiness = load('game_readiness', 'scripts/datasets/prepare-gmod-pilot.py')
publisher = load('game_publisher', 'scripts/datasets/publish-gmod-review-video.py')

def rz(yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

class PilotDataTests(unittest.TestCase):
    def test_video_timing_preserves_actual_gaps_not_fixed_nominal_fps(self):
        values=publisher.timeline([{'sim_time_s':10.}, {'sim_time_s':10.2}, {'sim_time_s':10.5}])
        np.testing.assert_allclose(values,[.2,.3,.25])
        with self.assertRaises(ValueError): publisher.timeline([{'sim_time_s':1.}, {'sim_time_s':1.}])

    def test_readiness_does_not_download_or_mutate_missing_game(self):
        with tempfile.TemporaryDirectory() as temp:
            result = readiness.prepare([Path(temp)])
            self.assertEqual(result['status'], 'game-not-found')
            self.assertFalse(result['gameDownloaded'])
            self.assertFalse(result['gameLaunched'])

    def test_readiness_matches_existing_addon_and_preserves_edits(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'garrysmod/lua').mkdir(parents=True)
            (root/'garrysmod/gameinfo.txt').write_text('TEST FIXTURE, not a game')
            self.assertEqual(readiness.prepare([], root)['status'], 'ready-to-copy-addon')
            self.assertFalse((root/'garrysmod/addons').exists())
            self.assertTrue(readiness.prepare([], root, True)['addonCopied'])
            self.assertEqual(readiness.prepare([], root, True)['status'], 'ready-addon-matches-source')
            changed = root/'garrysmod/addons/first_sight_capture/lua/autorun/client/first_sight_capture.lua'
            changed.write_text('USER TEST FIXTURE')
            self.assertEqual(readiness.prepare([], root, True)['status'], 'blocked-existing-addon-differs-preserved')
            self.assertEqual(changed.read_text(), 'USER TEST FIXTURE')

    def test_addon_copy_requires_real_structure_and_explicit_confirmation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(ValueError): installer.install(root)
            (root/'garrysmod/lua').mkdir(parents=True)
            (root/'garrysmod/gameinfo.txt').write_text('TEST FIXTURE, not a game')
            receipt = installer.install(root)
            self.assertFalse(receipt['copied'])
            self.assertFalse((root/'garrysmod/addons').exists())
            receipt = installer.install(root, True)
            self.assertTrue(receipt['copied'])
            with self.assertRaises(FileExistsError): installer.install(root, True)

    def test_library_discovery_uses_manifest_not_ownership_assumption(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / 'steamapps').mkdir()
            result = audit.inspect_libraries([root])
            self.assertEqual(result['games'][0]['installs'], [])
            (root / 'steamapps/appmanifest_4000.acf').write_text('"installdir" "GarrysMod" "buildid" "123"', encoding='utf8')
            result = audit.inspect_libraries([root])
            self.assertFalse(result['games'][0]['installs'][0]['directoryExists'])

    def test_image_paths_cannot_escape_episode(self):
        for path in ['../escape.png', '/escape.png', 'C:/escape.png', '..\\escape.png']:
            with self.assertRaises(ValueError): validator.safe_image(Path('.'), path)

    def fixture(self, root):
        (root / 'metadata.json').write_text(json.dumps({'schema': 'first-sight-gmod-pilot-v1'}))
        cameras = {}
        for i, (name, yaw) in enumerate([('front', 0), ('left', math.pi/2), ('right', -math.pi/2)]):
            image = Image.new('RGB', (640, 480), (20+i*30, 80, 140))
            image.putpixel((10, 10), (255, 0, 0))
            image.save(root / (name+'.png'))
            cameras[name] = {'path': name+'.png', 'bytes': (root/(name+'.png')).stat().st_size,
                'pose': {'position_m': [0, 0, 1.6], 'rotation_world_from_flu': rz(yaw).tolist()},
                'before': {'frame': 1, 'tick': 2, 'sim_time_s': 3},
                'after': {'frame': 1, 'tick': 2, 'sim_time_s': 3}}
        row = {'sample_id': 1, 'frame': 1, 'tick': 2, 'sim_time_s': 3, 'same_frame_tick_time': True,
            'head': {'position_m': [0, 0, 1.6], 'rotation_world_from_flu': np.eye(3).tolist()}, 'cameras': cameras}
        (root/'trajectory.jsonl').write_text(json.dumps(row)+'\n')
        return row

    def test_structural_pass_does_not_certify_sync_or_life_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root)
            result = validator.validate(root, minimum=1)
            self.assertTrue(result['structural_checks_passed'], result['errors'])
            self.assertFalse(result['synchronization_verified'])
            self.assertFalse(result['final_dataset_accepted'])
            self.assertFalse(validator.validate(root)['structural_checks_passed'])
            (root/'trajectory.jsonl').rename(root/'trajectory.jsonl.txt')
            self.assertTrue(validator.validate(root, minimum=1)['structural_checks_passed'])

    def test_black_images_and_changed_tick_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); row = self.fixture(root)
            row['cameras']['left']['after']['tick'] = 4
            (root/'trajectory.jsonl').write_text(json.dumps(row)+'\n')
            self.assertFalse(validator.validate(root, 1)['structural_checks_passed'])
            row = self.fixture(root)
            Image.new('RGB', (640, 480)).save(root/'front.png')
            row['cameras']['front']['bytes'] = (root/'front.png').stat().st_size
            (root/'trajectory.jsonl').write_text(json.dumps(row)+'\n')
            self.assertFalse(validator.validate(root, 1)['structural_checks_passed'])

    def trajectory(self, position=lambda t: [0, 0, 0], orientation=lambda t: np.eye(3)):
        return [{'sim_time_s': float(t), 'head': {'position_m': position(t),
            'rotation_world_from_flu': orientation(t).tolist()}} for t in np.linspace(0, 1, 21)]

    def test_stationary_and_straight_imu(self):
        for rows in [self.trajectory(), self.trajectory(lambda t: [t, 0, 0])]:
            output = np.array(imu.derive(rows))
            np.testing.assert_allclose(output[:, 1:4], np.tile([0, 0, 9.80665], (19, 1)), atol=1e-10)
            np.testing.assert_allclose(output[:, 4:7], 0, atol=1e-10)

    def test_turning_and_vertical_acceleration(self):
        output = np.array(imu.derive(self.trajectory(orientation=lambda t: rz(t))))
        np.testing.assert_allclose(output[:, 4:7], np.tile([0, 0, 1], (19, 1)), atol=1e-10)
        output = np.array(imu.derive(self.trajectory(lambda t: [0, 0, t*t])))
        np.testing.assert_allclose(output[:, 3], 11.80665, atol=1e-10)

    def test_gaps_bad_rotations_and_negative_noise_rejected(self):
        rows = self.trajectory(); rows[5]['sim_time_s'] = rows[4]['sim_time_s']
        with self.assertRaises(ValueError): imu.derive(rows)
        rows = self.trajectory(); rows[5]['head']['rotation_world_from_flu'][0][0] = 2
        with self.assertRaises(ValueError): imu.derive(rows)
        with self.assertRaises(ValueError): imu.derive(self.trajectory(), accel_noise=-1)

    def test_noise_reproducible_and_does_not_mutate_gold(self):
        rows = self.trajectory(); before = json.dumps(rows)
        a = imu.derive(rows, accel_noise=.1, seed=42)
        b = imu.derive(rows, accel_noise=.1, seed=42)
        self.assertEqual(a, b)
        self.assertEqual(json.dumps(rows), before)
        self.assertNotEqual(a[0][1:4], a[0][7:10])

if __name__ == '__main__': unittest.main()
