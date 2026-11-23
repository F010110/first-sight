import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('prepare_unioncity_v2', ROOT / 'scripts/datasets/prepare-unioncity-rerender-v2.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
publish_spec = importlib.util.spec_from_file_location('publish_unioncity_v2', ROOT / 'scripts/datasets/publish-unioncity-rerender-v2.py')
publisher = importlib.util.module_from_spec(publish_spec)
publish_spec.loader.exec_module(publisher)


class RerenderTests(unittest.TestCase):
    def test_source_clock_is_preserved_and_every_use_edge_is_replayed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [{'time_s': i / 10, 'position_source': [i, 0, 5435], 'eye_position_source': [i, 0, 5499], 'eye_angles_pyr_deg': [0, 179 if i == 0 else -179, 0]} for i in range(11)]
            (root / 'trajectory.jsonl.txt').write_text('\n'.join(json.dumps(r) for r in rows))
            changes = [{'time_s': 0.11, 'buttons': 32, 'target': {'model': '*132'}}, {'time_s': .15, 'buttons': 0}, {'time_s': .18, 'buttons': 32, 'target': None}, {'time_s': .23, 'buttons': 0}]
            (root / 'input_changes.jsonl.txt').write_text('\n'.join(json.dumps(r) for r in changes))
            result = prepare.prepare(root, 1000, root / 'request.json')
            self.assertEqual(result['render_frames'], 3)
            self.assertEqual(result['expected_use_press_count'], 2)
            self.assertEqual(result['expected_use_edges'], 4)
            actions = [s for s in result['steps'] if s['kind'] == 'use']
            self.assertEqual([s['source_elapsed_s'] for s in actions], [.11, .15, .18, .23])
            self.assertEqual([s['use_down'] for s in actions], [True, False, True, False])
            self.assertTrue(all(s['presentation_elapsed_s'] == 2 * s['source_elapsed_s'] for s in result['steps']))
            self.assertEqual(prepare.angle(179, -179, .5), 180)
            with self.assertRaises(FileExistsError):
                prepare.prepare(root, 1000, root / 'request.json')

    def test_missing_original_target_stops_before_copying_or_publishing_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode = root / 'data/first_sight/episode'
            episode.mkdir(parents=True)
            request = {'render_frames': 1, 'expected_use_press_count': 1, 'expected_use_edges': 2,
                       'steps': [{'kind': 'render'}, {'kind': 'use', 'use_down': True, 'use_edge_ordinal': 1, 'recorded_target': {'model': '*90'}}, {'kind': 'use', 'use_down': False, 'use_edge_ordinal': 2}]}
            (root / 'request.json').write_text(json.dumps(request))
            (episode / 'summary.json').write_text(json.dumps({'reason': 'completed', 'samples': 1, 'actions': 2}))
            (episode / 'observations.jsonl.txt').write_text(json.dumps({'elevator': {'use_audit_path': 'first_sight/route_render_v2_use_fixture.jsonl.txt'}}))
            audit = episode.parent / 'route_render_v2_use_fixture.jsonl.txt'
            audit.write_text('\n'.join(json.dumps(row) for row in [
                {'kind': 'observed-key-press', 'edge': 1}, {'kind': 'player-use', 'actual_target': {'model': '*89'}}, {'kind': 'observed-key-release', 'edge': 2}]))
            Path(str(audit) + '.summary.json').write_text(json.dumps({'observed_press_count': 1, 'observed_edge_count': 2}))
            out = root / 'unpublished'
            with self.assertRaisesRegex(ValueError, 'Recorded E target missing'):
                publisher.publish(SimpleNamespace(output=out, episode=episode, base=root / 'unused', request=root / 'request.json'))
            self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
