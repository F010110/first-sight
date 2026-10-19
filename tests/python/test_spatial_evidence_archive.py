import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from sim.spatial.spatial_evidence_archive import build, page

class ArchiveTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'source'; (source / 'images').mkdir(parents=True)
        image = source / 'images' / 'a.png'; image.write_bytes(b'original-image-fixture')
        sha = hashlib.sha256(image.read_bytes()).hexdigest()
        rows = [{'id': str(i), 'sessionId': 'a' if i < 3 else 'b', 'atMs': i * 2000, 'cameras': {v: 'images/a.png' for v in ('front', 'left', 'right')}, 'sha256': {v: sha for v in ('front', 'left', 'right')}, 'pose': 'SECRET', 'placeId': 'SECRET'} for i in range(4)]
        (source / 'observations.jsonl').write_text('\n'.join(map(json.dumps, rows)), encoding='utf8')
        return source, rows

    def test_all_frames_restart_scope_cutoff_pagination_original_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source, _ = self.fixture(root); output = root / 'archive'
            original = (source / 'observations.jsonl').read_bytes()
            self.assertEqual(build(source, output), 4)
            first = page(output, 'a', 4000, limit=1)
            self.assertEqual(first['observations'][0]['id'], '0')
            second = page(output, 'a', 4000, first['nextCursor'])
            self.assertEqual([r['id'] for r in second['observations']], ['1'])
            self.assertEqual(len(page(output, 'a', 10000)['observations']), 3)
            self.assertEqual(page(output, 'absent', 10000)['observations'], [])
            for row in page(output, 'a', 10000)['observations']:
                self.assertNotIn('pose', row); self.assertNotIn('placeId', row)
                self.assertEqual((output / row['cameras']['front']).read_bytes(), b'original-image-fixture')
            self.assertEqual((source / 'observations.jsonl').read_bytes(), original)
            with self.assertRaises(FileExistsError): build(source, output)
            with self.assertRaises(ValueError): page(output, 'a', 10000, limit=101)

    def test_rejects_truth_path_hash_mismatch_duplicate_and_incomplete(self):
        for kind in ('path', 'hash', 'duplicate'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); source, rows = self.fixture(root); output = root / 'archive'
                if kind == 'path': rows[0]['cameras']['front'] = '../truth.png'
                elif kind == 'hash': rows[0]['sha256']['front'] = 'bad'
                else: rows[1]['id'] = rows[0]['id']
                (source / 'observations.jsonl').write_text('\n'.join(map(json.dumps, rows)), encoding='utf8')
                with self.assertRaises(Exception): build(source, output)
                with self.assertRaises(ValueError): page(output, 'a', 10000)

if __name__ == '__main__': unittest.main()
