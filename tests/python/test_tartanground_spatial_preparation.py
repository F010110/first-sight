import importlib.util
import json
import hashlib
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('tgprep',Path(__file__).resolve().parents[2]/'scripts/datasets/prepare-tartanground-spatial-input.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class PreparationTest(unittest.TestCase):
    def fixture(self,root):
        archive=root/'archive';public=archive/'public';(public/'frames').mkdir(parents=True)
        rows=[]
        for i in range(24):
            frames=[]
            for view in ['front','left','right']:
                content=f'{i}:{view}'.encode();name=f'frames/{i:06d}-{view}.png';(public/name).write_bytes(content)
                frames.append({'view':view,'path':name,'sha256':hashlib.sha256(content).hexdigest()})
            rows.append({'id':f'source-{i}','sourceAtMs':i*100,'frames':frames,'pose':'never expose'})
        (public/'manifest.json').write_text(json.dumps({'schema':'three-view-render-input-v1','source':'TartanGround','observations':24}))
        (public/'observations.jsonl').write_text('\n'.join(json.dumps(r) for r in rows))
        return archive
    def test_original_clock_tail_hashes_and_no_truth(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);archive=self.fixture(root);out=root/'output'
            plan=module.prepare(archive,out)
            data=json.loads((out/'public.json').read_text())
            self.assertEqual([r['atMs'] for r in data['observations']],[0,2000,2300])
            self.assertEqual(plan['images'],9)
            self.assertNotIn('never expose',(out/'public.json').read_text())
            self.assertEqual(set(data),{'schema','observations'})
            with self.assertRaises(FileExistsError):module.prepare(archive,out)
    def test_tampered_original_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);archive=self.fixture(root)
            (archive/'public/frames/000000-front.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'Original changed'):module.prepare(archive,root/'out')

if __name__=='__main__':unittest.main()
