import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('unioncity_freeze', ROOT / 'scripts/datasets/freeze-unioncity-questions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QuestionFreezeTests(unittest.TestCase):
    def test_public_tasks_do_not_contain_expected_answers_or_reference_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            draft = root / 'draft.md'
            rows = []
            for tier in 'CSL':
                for i in range(1, 31):
                    rows.append(f'| {tier}{i:02d} | 300 | question | ' + ('290' if tier == 'S' else '10') + ' | private answer |')
            draft.write_text('\n'.join(rows), encoding='utf-8')
            bundle = root / 'bundle'
            bundle.mkdir()
            (bundle / 'sample.json').write_text('{}')
            (bundle / 'public-presentation.json').write_text(json.dumps({'observations': [{'id': f'f-{t}', 'atMs': t * 1000, 'views': []} for t in [10, 290, 300]]}))
            out = root / 'frozen'
            frozen = module.freeze(draft, bundle, out)
            tasks = (out / 'tasks.json').read_text()
            self.assertNotIn('private answer', tasks)
            self.assertNotIn('reference', tasks)
            self.assertEqual(frozen['questions'], 90)
            with self.assertRaises(FileExistsError):
                module.freeze(draft, bundle, out)


if __name__ == '__main__':
    unittest.main()
