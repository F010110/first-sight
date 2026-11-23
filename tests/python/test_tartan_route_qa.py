"""Synthetic fixtures verify evaluation machinery, never count as Tartan model scores."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('tartan_qa', Path(__file__).resolve().parents[2]/'scripts/evaluation/tartan-route-qa.py')
qa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qa)

class TartanRouteQA(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        image = self.root/'fixture.png'; image.write_bytes(b'fixture-not-actual-image')
        metadata = self.root/'metadata.zip'
        with zipfile.ZipFile(metadata, 'w') as z:
            for v in ['front','left','right']:
                z.writestr(f'pose_lcam_{v}.txt', '0 0 0 0 0 0 1\n20 0 0 0 0 0 1\n')
        self.public = {'schema':'tartan-route-qa-public-v1', 'images':{'I0':{'path':str(image),'sha256':qa.sha(image),'headingDeg':0}}, 'nodes':[{'id':'A','images':['I0']},{'id':'B','images':['I0']}], 'edges':[], 'tasks':[{'id':'Q1','kind':'localization','queryImages':['I0'],'candidates':['A','B']}]}
        self.answer = {'id':'Q1','placeId':'A','path':[],'turn':'unknown','abstain':False,'basis':{'distanceM':0,'allAnchorDistancesM':[0,20]}}
        self.gold = {'schema':'tartan-route-qa-gold-v1','answers':[self.answer], 'anchorFrames':{'A':0,'B':1},'imageSources':{'I0':{'frame':0,'view':'front'}},'source':{'metadataPath':str(metadata),'metadataSha256':qa.sha(metadata)}}
        self.write()
    def tearDown(self): self.temp.cleanup()
    def write(self):
        qa.save(self.root/'public.json', self.public); qa.save(self.root/'gold.json', self.gold)
    def freeze(self): qa.freeze(self.root, 'synthetic fixture, not dataset review')
    def score_fixture(self, predictions):
        output = self.root/'output'; output.mkdir()
        qa.save(output/'manifest.json', {'mode':'scripted-pipeline-test-not-vlm','publicSha256':qa.sha(self.root/'public.json'),'freezeSha256':qa.sha(self.root/'frozen.json')})
        qa.save(output/'predictions.json', {'predictions':predictions})
        return qa.score(self.root, output)
    def test_answers_required_before_freeze(self):
        self.gold['answers']=[]; self.write()
        with self.assertRaises(ValueError): self.freeze()
    def test_wrong_location_rejected_before_inference(self):
        self.answer['placeId']='B'; self.write()
        with self.assertRaises(ValueError): self.freeze()
    def test_changed_image_and_heading_rejected(self):
        self.public['images']['I0']['headingDeg']=90; self.write()
        with self.assertRaises(ValueError): qa.validate(self.root)
    def test_freeze_detects_answer_changes(self):
        self.freeze(); self.answer['abstain']=True; self.write()
        with self.assertRaises(ValueError): qa.verify_frozen(self.root)
    def test_pending_remains_in_denominator(self):
        self.freeze(); report=self.score_fixture([])
        self.assertEqual(report['overall']['accuracy'],0)
        self.assertEqual(report['overall']['notRun'],1)
    def test_correct_and_wrong_are_scored_not_coverage(self):
        self.freeze(); answer={k:self.answer[k] for k in ['placeId','path','turn','abstain']}; answer['placeId']='B'
        report=self.score_fixture([{'id':'Q1','status':'completed','answer':answer}])
        self.assertEqual(report['overall']['completed'],1); self.assertEqual(report['overall']['correct'],0)
    def test_perfect_structured_answer_scores_one(self):
        self.freeze(); answer={k:self.answer[k] for k in ['placeId','path','turn','abstain']}
        report=self.score_fixture([{'id':'Q1','status':'completed','answer':answer}])
        self.assertEqual(report['overall']['accuracy'],1)
    def test_duplicate_predictions_rejected(self):
        self.freeze()
        with self.assertRaises(ValueError): self.score_fixture([{'id':'Q1','status':'not_run'},{'id':'Q1','status':'not_run'}])
    def test_directed_path_does_not_invent_reverse(self):
        edges=[{'from':'A','to':'B'},{'from':'B','to':'C'}]
        self.assertEqual(qa.path_between(edges,'A','C'),['A','B','C'])
        self.assertEqual(qa.path_between(edges,'C','A'),[])

if __name__ == '__main__': unittest.main()
