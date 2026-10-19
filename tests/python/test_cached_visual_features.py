import json
import tempfile
import unittest
from pathlib import Path
from sim.spatial.cached_visual_features import build, extract
from sim.spatial.salad_features import sha

class CacheTests(unittest.TestCase):
    def test_offline_signed_features_bind_image_bytes_and_reject_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); image = root / 'a.png'; image.write_bytes(b'fixture')
            source = root / 'features'; source.mkdir()
            record = {'id': 'o', 'features': [[1, -1]], 'imageSha256': [sha(image)]}
            (source / 'features.jsonl').write_text(json.dumps(record) + '\n')
            (source / 'complete.json').write_text(json.dumps({'dimensions': 2, 'featuresSha256': sha(source / 'features.jsonl')}))
            cache = root / 'cache'; build(source, cache)
            self.assertEqual(extract(cache, [{'id': 'o', 'frames': [str(image)]}])[0]['features'], [[1, -1]])
            with self.assertRaises(ValueError): extract(cache, [{'id': 'missing', 'frames': [str(image)]}])
            image.write_bytes(b'tampered')
            with self.assertRaises(ValueError): extract(cache, [{'id': 'o', 'frames': [str(image)]}])
            with self.assertRaises(FileExistsError): build(source, cache)

if __name__ == '__main__': unittest.main()
