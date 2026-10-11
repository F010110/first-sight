"""Input validation smoke tests; full cold-start run is recorded separately."""
import unittest
from pathlib import Path
import json

class PipelineArtifactsTests(unittest.TestCase):
    def test_actual_cold_start_has_no_simulator_answers(self):
        fixture=Path('run/sim/visual-cold-start-smoke-v1')
        if not fixture.exists():self.skipTest('Cold-start capture fixture not present')
        for line in (fixture/'windows.jsonl').read_text().splitlines():
            self.assertEqual(set(json.loads(line)),{'endTick'})
        self.assertFalse((fixture/'observations.jsonl').exists())
        self.assertFalse((fixture/'experience-sequence-bundle.json').exists())
        result=Path('run/sim/visual-cold-start-result-v1')
        self.assertTrue((result/'memory/integrated-memory.json').exists())
        memory=json.loads((result/'memory/integrated-memory.json').read_text())
        self.assertEqual(len(memory['baseline']['graph']['observations']),4)
        self.assertTrue((result/'baseline/experience-directional-evidence.json').exists())

if __name__=='__main__':unittest.main()
