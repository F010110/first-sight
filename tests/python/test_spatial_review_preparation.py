import importlib.util
import json
import hashlib
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('spatial_review', Path(__file__).resolve().parents[2] / 'scripts/review/prepare-spatial-review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SpatialReviewPreparation(unittest.TestCase):
    def test_hash_bound_model_blind_and_not_silently_labeled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / 'image.png'
            image.write_bytes(b'fixture-original')
            row = {'id': '<observation>', 'scene': 'new-scene', 'atMs': 1, 'views': [{'direction': d, 'path': str(image), 'sha256': hashlib.sha256(image.read_bytes()).hexdigest()} for d in ['left', 'front', 'right']]}
            source = root / 'public.json'
            source.write_text(json.dumps({'observations': [row]}), encoding='utf-8')
            out = root / 'review'
            module.prepare(source, out)
            truth = json.loads((out / 'labels.UNREVIEWED.json').read_text(encoding='utf-8'))
            self.assertIsNone(truth['labels'][0]['kind'])
            self.assertIsNone(truth['labels'][0]['split'])
            self.assertEqual(truth['labels'][0]['reviewer'], '')
            self.assertIn('&lt;observation&gt;', (out / 'review.html').read_text(encoding='utf-8'))
            with self.assertRaises(FileExistsError):
                module.prepare(source, out)
            image.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'changed'):
                module.prepare(source, root / 'tamper')


if __name__ == '__main__':
    unittest.main()
