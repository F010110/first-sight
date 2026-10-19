"""Offline layout and published-source regression checks."""
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path


class RepositoryLayoutTests(unittest.TestCase):
    def test_all_relocations_have_destinations(self):
        manifest = json.loads(Path('docs/maintenance/layout-map.json').read_text(encoding='utf8'))
        for old, new in manifest['moves'].items():
            self.assertTrue(Path(new).is_file(), f'{old} -> {new} missing')

    def test_tool_registry_points_to_real_feature_modules(self):
        registry = json.loads(Path('docs/maintenance/layout-map.json').read_text(encoding='utf8'))['pythonModules']
        for name, module in registry.items():
            spec = importlib.util.find_spec(module)
            self.assertIsNotNone(spec, name)
            self.assertEqual(Path(spec.origin).stem, name)

    def test_published_core_hashes(self):
        release = json.loads(Path('docs/releases/v1.2.0.json').read_text(encoding='utf8'))
        self.assertEqual(release['version'], json.loads(Path('package.json').read_text())['version'])
        for name, expected in release['sourceHashesLfNormalized'].items():
            content = Path(name).read_bytes().replace(b'\r\n', b'\n')
            self.assertEqual(hashlib.sha256(content).hexdigest(), expected, name + ': version/bugfix decision required')

    def test_sim_root_is_only_package_and_index(self):
        files = {p.name for p in Path('sim').iterdir() if p.is_file()}
        self.assertEqual(files, {'__init__.py', '__main__.py', 'README.md'})


if __name__ == '__main__':
    unittest.main()
