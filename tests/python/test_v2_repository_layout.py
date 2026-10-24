"""Source-only layout regression; no camera, network, model or private data."""
import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class V2RepositoryLayoutTests(unittest.TestCase):
    def test_migration_has_no_wrappers_or_missing_destinations(self):
        moves = json.loads((ROOT / 'docs/maintenance/v2-layout-map.json').read_text(encoding='utf-8'))['moves']
        self.assertEqual(len(moves), len(set(moves.values())))
        for old, new in moves.items():
            with self.subTest(path=old):
                self.assertFalse((ROOT / old).exists())
                self.assertTrue((ROOT / new).is_file())

    def test_script_roots_remain_navigation_only(self):
        for directory in ['scripts', 'cam']:
            with self.subTest(directory=directory):
                self.assertEqual([], [p.name for p in (ROOT / directory).iterdir()
                                      if p.is_file() and p.suffix in {'.py', '.mjs', '.cjs'}])

    def test_moved_python_sources_parse(self):
        moves = json.loads((ROOT / 'docs/maintenance/v2-layout-map.json').read_text(encoding='utf-8'))['moves']
        for new in moves.values():
            if new.endswith('.py'):
                with self.subTest(path=new):
                    ast.parse((ROOT / new).read_text(encoding='utf-8'), filename=new)

    def test_current_package_entry_points_exist(self):
        package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
        self.assertIn('scripts/testing/test-typescript.mjs', package['scripts']['test'])
        self.assertIn('scripts/testing/check-doc-links.py', package['scripts']['test:docs'])
        self.assertTrue((ROOT / 'cam/host/push_stream.py').is_file())
        self.assertTrue((ROOT / 'src/desktop/realtime-server.ts').is_file())


if __name__ == '__main__':
    unittest.main()
