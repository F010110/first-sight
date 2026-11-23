import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

download = module('unrealzoo_download', 'scripts/datasets/download-unrealzoo-pilot.py')
scope = module('online_scope_audit', 'scripts/evaluation/audit-first-sight-evaluation-scope.py')

class ControllableSceneAuditTest(unittest.TestCase):
    def test_archive_traversal_and_windows_absolute_paths_rejected(self):
        for name in ['../escape.exe', '/escape.exe', 'C:/escape.exe', '..\\escape.exe']:
            with self.assertRaises(ValueError):
                download.safe_members([zipfile.ZipInfo(name)])

    def test_case_collisions_and_symlinks_rejected(self):
        with self.assertRaises(ValueError):
            download.safe_members([zipfile.ZipInfo('A.exe'), zipfile.ZipInfo('a.exe')])
        link = zipfile.ZipInfo('link');link.external_attr = 0o120777 << 16
        with self.assertRaises(ValueError):
            download.safe_members([link])

    def test_extraction_budget_and_regular_files(self):
        member = zipfile.ZipInfo('game/file.dat');member.file_size = 101
        with self.assertRaises(ValueError):
            download.safe_members([member], cap=100)
        self.assertEqual(download.safe_members([member], cap=101), [member])

    def test_relative_import_graph_does_not_treat_unrelated_modules_as_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'entry.ts').write_text("import {x} from './child.js';", encoding='utf8')
            (root / 'child.ts').write_text('export const x=1;', encoding='utf8')
            (root / 'unused.ts').write_text('throw Error();', encoding='utf8')
            self.assertEqual(scope.reachable('entry.ts', root), ['child.ts', 'entry.ts'])

    def test_benchmark_entry_is_not_full_assistant_orchestration(self):
        graph = scope.reachable('src/evaluation/run-egolife-native.ts')
        self.assertIn('src/hardware/realtime-method2.ts', graph)
        self.assertNotIn('src/assistant/runtime.ts', graph)

if __name__ == '__main__':
    unittest.main()
