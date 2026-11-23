"""Offline safety checks for public dataset collection; no downloads."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

PATH = Path(__file__).resolve().parents[2] / 'scripts/datasets/collect-realism-sources.py'
SPEC = importlib.util.spec_from_file_location('realism_sources', PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class SourceCollectionTests(unittest.TestCase):
    def test_nested_relative_path_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(collector.safe_path(root, 'scenes/example.json'), root / 'scenes/example.json')

    def test_external_paths_are_rejected(self):
        for name in ['../private', '/etc/passwd', 'C:/private', 'scenes/../../private', 'scenes\\private']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                collector.safe_path(Path('datasets'), name)

    def test_git_blob_hash_and_size_are_verified(self):
        data = b'public fixture'
        row = {'size': len(data), 'oid': hashlib.sha1(b'blob 14\0' + data).hexdigest()}
        collector.verify(data, row)
        with self.assertRaises(ValueError):
            collector.verify(b'changed', row)

    def test_lfs_content_hash_not_pointer_is_verified(self):
        data = b'asset'
        row = {'size': len(data), 'lfs': {'oid': hashlib.sha256(data).hexdigest()}}
        collector.verify(data, row)
        with self.assertRaises(ValueError):
            collector.verify(b'other', row)


if __name__ == '__main__':
    unittest.main()
