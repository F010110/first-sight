import json
import tempfile
import unittest
from pathlib import Path
from evaluate_learned_recall import evaluate

class LearnedRecallTests(unittest.TestCase):
    def test_causal_exclusion_and_exact_endpoint_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'evaluation-only').mkdir()
            rows = [{'id': str(i), 'atMs': at, 'sourceFrameIndex': i} for i, at in enumerate([0, 20000, 80000])]
            features = [{'id': '0', 'features': [[1, 0]] * 3}, {'id': '1', 'features': [[0, 1]] * 3}, {'id': '2', 'features': [[1, 0]] * 3}]
            (root / 'observations.jsonl').write_text('\n'.join(map(json.dumps, rows)))
            (root / 'features.jsonl').write_text('\n'.join(map(json.dumps, features)))
            (root / 'evaluation-only' / 'coverage.json').write_text(json.dumps({'geometricRevisitPairs': [{'earlierFrame': 0, 'laterFrame': 2}, {'earlierFrame': 0, 'laterFrame': 1}]}))
            evaluate(root, root / 'features.jsonl', root / 'report.json')
            report = json.loads((root / 'report.json').read_text())
            self.assertEqual(report['eligiblePairs'], 1); self.assertEqual(report['proxyRecallAt1'], 1)
            self.assertFalse(report['roomAccuracyMeasured'])
            with self.assertRaises(FileExistsError): evaluate(root, root / 'features.jsonl', root / 'report.json')
            (root / 'features.jsonl').write_text(json.dumps(features[0]))
            with self.assertRaises(ValueError): evaluate(root, root / 'features.jsonl', root / 'bad.json')

if __name__ == '__main__': unittest.main()
