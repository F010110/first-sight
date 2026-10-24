"""Offline layout and published-source regression checks."""
import hashlib
import importlib.util
import json
import subprocess
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
        # A frozen V1 release validates its own tag, not evolving V2 sources.
        package = json.loads(subprocess.check_output(['git', 'show', 'v1.2.0:package.json']))
        self.assertEqual(release['version'], package['version'])
        for name, expected in release['sourceHashesLfNormalized'].items():
            content = subprocess.check_output(['git', 'show', 'v1.2.0:' + name]).replace(b'\r\n', b'\n')
            self.assertEqual(hashlib.sha256(content).hexdigest(), expected, name + ': frozen V1 tag changed')

    def test_sim_root_is_only_package_and_index(self):
        files = {p.name for p in Path('sim').iterdir() if p.is_file()}
        self.assertEqual(files, {'__init__.py', '__main__.py', 'README.md'})


if __name__ == '__main__':
    unittest.main()
