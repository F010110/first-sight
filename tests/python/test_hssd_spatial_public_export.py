import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(importlib.util.find_spec('PIL'), 'Pillow required; use project .venv')
class HssdSpatialPublicExport(unittest.TestCase):
    def test_native_pixels_and_public_whitelist_without_truth(self):
        from PIL import Image
        spec = importlib.util.spec_from_file_location('hssd_export', Path(__file__).resolve().parents[2] / 'scripts/import-hssd-spatial-public.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            capture = root / 'capture'
            for folder in ['frames', 'left', 'right']:
                (capture / folder).mkdir(parents=True)
                for i in range(3):
                    Image.new('RGB', (12, 8), (i * 40, 20, 80)).save(capture / folder / f'{i}.jpg')
            (capture / 'windows.jsonl').write_text('\n'.join(json.dumps({'frame': f'{i}.jpg', 'timestampMs': i * 1000, 'privateRegion': 'DO_NOT_COPY'}) for i in range(3)), encoding='utf-8')
            # Invalid JSON ensures the exporter does not opportunistically load old labels.
            (capture / 'labels.json').write_text('NOT JSON', encoding='utf-8')
            output = root / 'output'
            module.export([('scene', capture)], output, 2)
            data = json.loads((output / 'public.json').read_text(encoding='utf-8'))
            self.assertEqual(len(data['observations']), 2)
            self.assertNotIn('DO_NOT_COPY', json.dumps(data))
            self.assertEqual(set(data['observations'][0]), {'id', 'scene', 'atMs', 'views'})
            for row in data['observations']:
                for view in row['views']:
                    path = Path(view['path'])
                    self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), view['sha256'])
                    frame = row['id'].split('-')[-1]
                    folder = 'frames' if view['direction'] == 'front' else view['direction']
                    with Image.open(capture / folder / (frame + '.jpg')) as original, Image.open(path) as derived:
                        self.assertEqual(original.tobytes(), derived.tobytes())
            with self.assertRaises(FileExistsError):
                module.export([('scene', capture)], output, 2)


if __name__ == '__main__':
    unittest.main()
