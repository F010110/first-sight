import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('repair_pilot', ROOT / 'scripts/evaluation/prepare-unioncity-repair-pilot.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RepairPilotTests(unittest.TestCase):
    def test_previous_spend_is_deducted_and_gates_and_questions_are_not_relaxed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, freeze, previous = [root / name for name in ['run', 'freeze', 'previous']]
            for p in [run / 'questions', freeze / 'evaluation-only', previous / 'requests']:
                p.mkdir(parents=True)
            tasks, refs = [], []
            for tier in 'CSL':
                for i in range(1, 31):
                    ident = f'{tier}{i:02d}'
                    tasks.append({'id': ident, 'question': f'approved-{ident}', 'queryAtMs': 300000})
                    refs.append({'id': ident, 'referenceObservations': [{'id': 'old', 'atMs': 1000}]})
                    p = run / 'questions' / ident
                    p.mkdir()
                    (p / 'result.json').write_text(json.dumps({'status': 'completed', 'answer': {}}))
                    (p / 'producer-snapshot.json').write_text(json.dumps({'asOfMs': 300000, 'results': [{'lane': 'memory', 'observation_id': 'old', 'result': {'summary': 'old observation'}}]}))
            (run / 'tasks.json').write_text(json.dumps(tasks))
            (run / 'input.json').write_text('{}')
            (run / 'results.jsonl').write_text('preserved')
            (freeze / 'evaluation-only/references.json').write_text(json.dumps(refs))
            (previous / 'report.json').write_text(json.dumps({'completedScript': True}))
            (previous / 'requests/usage.json').write_text(json.dumps({'calls': 39, 'estimatedUSD': .04}))
            out = root / 'prepared'
            result = module.prepare(run, freeze, out, previous)
            plan = json.loads((out / 'plan.json').read_text())
            self.assertEqual(result['branches'], 37)
            self.assertAlmostEqual(plan['maxUSD']['answers'], .41)
            self.assertEqual(plan['maxCalls']['answers'], 183)
            self.assertEqual(plan['gateFrozenBeforeRun']['eligibleLongSupportedAtLeast3Count'], 5)
            self.assertEqual(plan['gateFrozenBeforeRun']['normalSemanticAtLeast3Count'], 12)
            self.assertTrue(all(t['question'] == f"approved-{t['id']}" for t in json.loads((out / 'tasks.json').read_text())))
            self.assertEqual((run / 'results.jsonl').read_text(), 'preserved')
            with self.assertRaises(FileExistsError):
                module.prepare(run, freeze, out, previous)


if __name__ == '__main__':
    unittest.main()
