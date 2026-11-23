"""Safety gates without launching a game or sending input."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('gmod_safe', ROOT/'scripts/datasets/run-gmod-safe-smoke.py')
safe = importlib.util.module_from_spec(spec); spec.loader.exec_module(safe)

class SafeLaunchTests(unittest.TestCase):
    def test_process_detection(self):
        with patch.object(safe.subprocess, 'check_output', return_value='"gmod_win64.exe","123","Console","1","100 K"\n"steam.exe","456","Console","1","20 K"'):
            self.assertEqual(safe.game_pids(), [123])

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher')
    def test_existing_game_blocks_launch_before_any_output_or_request(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(safe, 'game_pids', return_value=[123]), patch.object(safe.subprocess, 'Popen') as launch:
            out = Path(temp)/'new-run'
            with self.assertRaises(RuntimeError): safe.run(Path(temp), out, 10)
            launch.assert_not_called()
            self.assertFalse(out.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher')
    def test_missing_executable_blocks_launch(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(safe, 'game_pids', return_value=[]), patch.object(safe.subprocess, 'Popen') as launch:
            with self.assertRaises(FileNotFoundError): safe.run(Path(temp), Path(temp)/'new-run', 10)
            launch.assert_not_called()

if __name__ == '__main__': unittest.main()
