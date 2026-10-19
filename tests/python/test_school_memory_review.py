import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from sim.school.build_school_memory_review import build, ISSUES
from sim.review.build_review_portal import build_portal


class SchoolReviewTests(unittest.TestCase):
    def fixture(self, root):
        group, repaired, bank = [root / n for n in ['group', 'repaired', 'bank']]
        (group / 'model-replay').mkdir(parents=True)
        (group / 'full-grading').mkdir()
        repaired.mkdir(); (bank / 'evaluation-only').mkdir(parents=True)
        image = root / 'original.png'; image.write_bytes(b'image fixture')
        row = {'id': 'o', 'episodeNumber': 1, 'sourceAtMs': 0, 'atMs': 1,
               'cameras': {c: str(image) for c in ['front', 'left', 'right']},
               'sha256': {c: hashlib.sha256(image.read_bytes()).hexdigest() for c in ['front', 'left', 'right']}}
        replay = group / 'model-replay/observations.jsonl'
        replay.write_text(json.dumps(row)+'\n')
        (group / 'frozen.json').write_text(json.dumps({'replaySha256': hashlib.sha256(replay.read_bytes()).hexdigest()}))
        tasks, predictions, grades = [], [], []
        for key in ISSUES:
            tasks.append({'id': key, 'question': '<script>test</script>', 'memoryTier': 'current', 'expectedAnswer': 'reference', 'labelBasis': 'AI', 'currentObservationId': 'o', 'validEvidenceSets': [['o']]})
            predictions.append({'id': key, 'inspectedIds': ['o'], 'result': {'raw': json.dumps({'answer': 'answer', 'abstained': False, 'historicalEvidenceIds': ['o']})}})
            grades.append({'id': key, 'utility': .5})
        (bank / 'evaluation-only/tasks.json').write_text(json.dumps(tasks))
        (repaired / 'results.jsonl').write_text('\n'.join(map(json.dumps, predictions)))
        (group / 'full-grading/grades.jsonl').write_text('\n'.join(map(json.dumps, grades)))
        return group, repaired, bank

    def test_original_hashes_and_issue_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); args = self.fixture(root); output = root / 'review'
            result = build(*args, output)
            data = json.loads((output / 'data.json').read_text(encoding='utf8'))
            self.assertEqual((result['issues'], result['images']), (8, 3))
            self.assertEqual(data['issues'][0]['referenceIds'], ['o'])
            self.assertEqual(data['issues'][0]['inspectedIds'], ['o'])
            self.assertEqual((output / data['samples'][0]['cameras']['front']).read_bytes(), b'image fixture')
            self.assertNotIn('<script>test</script>', (output / 'index.html').read_text(encoding='utf8'))
            with self.assertRaises(ValueError): build(*args, output)

    def test_portal_lists_school_with_correct_source_and_keeps_other_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); args = self.fixture(root); portal = root / 'portal'
            build(*args, portal / 'school')
            home = portal / 'home'; home.mkdir()
            (home / 'data.json').write_text(json.dumps({'datasetId': 'home-test', 'samples': [], 'frameCount': 0, 'model': None}))
            (home / 'index.html').write_text('<header>home</header>')
            build_portal(portal)
            page = (portal / 'index.html').read_text(encoding='utf8')
            self.assertIn('data-kind="memory"', page)
            self.assertIn('data-kind="home"', page)
            self.assertIn('school/', page)
            self.assertEqual(len(json.loads((portal / 'datasets.json').read_text(encoding='utf8'))), 2)

    def test_reject_modified_original_image(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); args = self.fixture(root)
            (root / 'original.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): build(*args, root / 'review')


if __name__ == '__main__': unittest.main()
