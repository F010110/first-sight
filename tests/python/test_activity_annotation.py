import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from sim.school.annotate_school_activity import annotate
from sim.school.score_activity_identity_probes import outcomes

def fixture(root):
    source=root/'source';sample=root/'sample';sample.mkdir();folder=source/'AbandonedSchool'/'Data_omni'/'P0007';folder.mkdir(parents=True)
    poses=[[float(i),0.,-5. if i>=30 else 0.,0.,0.,0.,1.] for i in range(41)]
    archive=folder/'metadata.zip'
    with zipfile.ZipFile(archive,'w') as z:
        z.writestr('P0007_metadata.json',json.dumps({'num_poses':41,'time_step':2,'robot_height':1.5}));z.writestr('collection_config.yaml','camera_list: [0,2,3]');z.writestr('pose_lcam_front.txt','\n'.join(' '.join(map(str,p)) for p in poses))
    for view in ('front','left','right'):
        with zipfile.ZipFile(folder/f'image_lcam_{view}.zip','w') as z:
            for i in range(41):z.writestr(f'{i:06d}_{view}.png',b'original pixels fixture')
    digest=hashlib.sha256(archive.read_bytes()).hexdigest();relative=archive.relative_to(source).as_posix()
    (source/'plan.json').write_text(json.dumps({'revision':'fixture','trajectories':[{'trajectory':'P0007','environment':'AbandonedSchool','metadataPath':relative,'metadataSha256':digest,'frames':41}]}))
    observations=[];truth=[];(sample/'image.png').write_bytes(b'original pixels fixture')
    for i,p in enumerate(poses):
        uid=f'fixture/AbandonedSchool/P0007/{i}';oid=hashlib.sha256(uid.encode()).hexdigest()[:24]
        observations.append({'id':oid,'episodeId':'episode','sourceAtMs':i*2000,'atMs':100+i*2000,'cameras':{v:'image.png' for v in ['front','left','right']},'sha256':{v:hashlib.sha256(b'original pixels fixture').hexdigest() for v in ['front','left','right']}})
        truth.append({'observationId':oid,'sourceFrameUid':uid,'sourcePose':p})
    private=sample/'evaluation-only';private.mkdir()
    (sample/'observations.jsonl').write_text('\n'.join(map(json.dumps,observations)))
    (private/'source-truth.jsonl').write_text('\n'.join(map(json.dumps,truth)))
    (private/'episodes.json').write_text(json.dumps([{'id':'episode','sourceTrajectory':'P0007','worldInstanceId':'AbandonedSchool','startMs':100,'endMs':80100,'unobservedGapBeforeMs':0}]))
    (sample/'complete.json').write_text(json.dumps({'sourceRevision':'fixture','sampleId':'fixture'}))
    spec=root/'spec.json';spec.write_text(json.dumps({'version':'fixture','trajectories':{'P0007':['gym','gym','gym','hall','hall']}}))
    return sample,source,spec

class SourceAnnotationTests(unittest.TestCase):
    def test_only_reviewed_anchors_get_semantics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);args=fixture(root);rows,report=annotate(*args,root/'output')
            self.assertEqual(report['records'],41);self.assertEqual(report['visualAnchors'],5);self.assertEqual(report['semanticUnreviewed'],36)
            self.assertTrue(all(r['physicalPlaceId'] is None for r in rows));self.assertFalse(report['scoreEligible'])
            self.assertEqual(report['crossLevelDiagnostic']['sourceDeltaZAbsM'],5)

    def test_changed_pixels_or_clock_fail_source_binding(self):
        for corruption in ('pixels','clock'):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);sample,source,spec=fixture(root)
                if corruption=='pixels':(sample/'image.png').write_bytes(b'changed')
                else:
                    path=sample/'observations.jsonl';rows=[json.loads(l) for l in path.read_text().splitlines()];rows[0]['atMs']+=1;path.write_text('\n'.join(map(json.dumps,rows)))
                with self.assertRaises(ValueError):annotate(sample,source,spec,root/'output')

    def test_identity_consequence_unknown_and_uuid_invariance(self):
        self.assertEqual(outcomes(False,'a','a')['harm'],1)
        self.assertEqual(outcomes(True,'a','b')['harm'],.25)
        self.assertEqual(outcomes(False,None,'b')['utility'],0)
        self.assertEqual(outcomes(True,'a','a'),outcomes(True,'renamed','renamed'))

if __name__=='__main__':unittest.main()
