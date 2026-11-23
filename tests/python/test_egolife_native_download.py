import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('egolife_native_download', Path(__file__).resolve().parents[2] / 'scripts/evaluation/download-egolife-native.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class NativeDownloadTest(unittest.TestCase):
    def row(self, data=b'fixture'):
        return {'path': 'A1_JAKE/DAY1/DAY1_A1_JAKE_11094208.mp4', 'size': len(data), 'lfs': {'oid': hashlib.sha256(data).hexdigest()}}

    def test_missing_or_partial_is_not_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clip.mp4'
            self.assertFalse(module.verified(path, self.row()))
            path.write_bytes(b'fixtur')
            self.assertFalse(module.verified(path, self.row()))

    def test_size_alone_is_not_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clip.mp4'
            path.write_bytes(b'changed')
            self.assertFalse(module.verified(path, self.row()))
            path.write_bytes(b'fixture')
            self.assertTrue(module.verified(path, self.row()))

    def test_browser_link_is_revision_pinned(self):
        url = module.url_for({'revision': 'pinned-revision'}, self.row())
        self.assertIn('/resolve/pinned-revision/A1_JAKE/DAY1/', url)
        self.assertTrue(url.endswith('?download=true'))

    def test_browser_export_contains_only_missing_downloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'clips').mkdir()
            (root / 'clips/0000.mp4').write_bytes(b'fixture')
            first = self.row()
            second = self.row(b'another')
            second['path'] = 'A1_JAKE/DAY1/DAY1_A1_JAKE_11100000.mp4'
            entries = module.export_links(root, {'revision': 'pinned', 'files': [first, second]})
            self.assertEqual([r['verified'] for r in entries], [True, False])
            page = (root / 'browser-download-links.html').read_text(encoding='utf8')
            self.assertIn('DAY1_A1_JAKE_11100000.mp4', page)
            self.assertNotIn('DAY1_A1_JAKE_11094208.mp4', page)


if __name__ == '__main__':
    unittest.main()
