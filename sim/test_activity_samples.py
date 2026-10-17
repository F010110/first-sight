import base64
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from build_activity_samples import build
from review_activity_samples import review

class ActivitySampleTests(unittest.TestCase):
    def source(self, root):
        rows=[];png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        for env,frames in [('AbandonedSchool',601),('Hospital',601),('ModularNeighborhoodIntExt',301),('Supermarket',301)]:
            relative=Path(env)/'Data_omni'/'P0000';folder=root/relative;folder.mkdir(parents=True)
            with zipfile.ZipFile(folder/'metadata.zip','w') as z:
                z.writestr('P0000_metadata.json',json.dumps({'time_step':2}));z.writestr('pose_lcam_front.txt',('0 0 0 0 0 0 1\n')*frames)
            verified=[]
            for view in ['front','left','right']:
                path=folder/f'image_lcam_{view}.zip'
                with zipfile.ZipFile(path,'w') as z:
                    for i in range(frames):z.writestr(f'{i:06d}_{view}.png',png)
                verified.append({'path':(relative/path.name).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            (folder/'verified.json').write_text(json.dumps(verified))
            rows.append({'environment':env,'trajectory':'P0000','metadataPath':(relative/'metadata.zip').as_posix(),'metadataSha256':hashlib.sha256((folder/'metadata.zip').read_bytes()).hexdigest(),'frames':frames,'timeStep':2,'durationSeconds':2*(frames-1)})
        (root/'complete.json').write_text('{}');(root/'plan.json').write_text(json.dumps({'revision':'fixture','trajectories':rows}));return rows

    def test_composite_clock_source_integrity_and_truth_separation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';self.source(source);output=root/'samples';build(source,output)
            community=output/'community-shopping';manifest=json.loads((community/'complete.json').read_text());self.assertEqual(manifest['activeVisualSeconds'],1200);self.assertEqual(manifest['activitySpanSeconds'],2400);self.assertFalse(manifest['scoreEligible'])
            public=(community/'observations.jsonl').read_text();self.assertNotIn('sourcePose',public);self.assertNotIn('Supermarket',public);self.assertNotIn('ModularNeighborhood',public);self.assertNotIn('community-shopping',public)
            observations=[json.loads(l) for l in public.splitlines()];self.assertEqual(len({r['id'] for r in observations}),len(observations));self.assertEqual(observations[301]['atMs']-observations[300]['atMs'],1200000)
            private=[json.loads(l) for l in (community/'evaluation-only'/'source-truth.jsonl').read_text().splitlines()];self.assertEqual(len({r['worldInstanceId'] for r in private}),2);self.assertEqual((community/'evaluation-only'/'tasks.jsonl').read_text(),'')
            review(community,root/'review',stride=300)
            draft=json.loads((root/'review'/'annotation-draft.json').read_text());self.assertFalse(draft['reviewed']);self.assertEqual(len(draft['cards']),4)
            self.assertTrue((root/'review'/'index.html').exists());self.assertTrue((community/'SOURCE-NOTICE.md').exists())

    def test_source_duration_cannot_be_inflated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';rows=self.source(source);rows[0]['durationSeconds']+=1000;(source/'plan.json').write_text(json.dumps({'revision':'fixture','trajectories':rows}))
            with self.assertRaisesRegex(ValueError,'clock/frame'):build(source,root/'bad')

    def test_selected_complete_sample_does_not_require_other_downloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';self.source(source)
            (source/'complete.json').unlink()
            build(source,root/'selected',sample='school-rounds')
            self.assertTrue((root/'selected'/'school-rounds'/'complete.json').exists())
            self.assertFalse((root/'selected'/'hospital-rounds').exists())

if __name__=='__main__':unittest.main()
