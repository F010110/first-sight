"""Bounded DISK+LightGlue/F-RANSAC evidence, never a physical identity assertion."""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from salad_features import sha

def main():
    p=argparse.ArgumentParser();p.add_argument('--lightglue',required=True,type=Path);p.add_argument('--dataset',required=True,type=Path);p.add_argument('--pairs',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    pairs=json.loads(a.pairs.read_text());
    if not isinstance(pairs,list) or not 1<=len(pairs)<=16:raise ValueError('Pair budget 1..16')
    a.output.mkdir(parents=True,exist_ok=False)
    import torch
    import cv2
    import numpy as np
    torch.set_num_threads(4);torch.manual_seed(0);cv2.setRNGSeed(0)
    sys.path.insert(0,str(a.lightglue.resolve()))
    from lightglue import DISK,LightGlue
    from lightglue.utils import load_image,rbd
    extractor=DISK(max_num_keypoints=512).eval();matcher=LightGlue(features='disk',depth_confidence=.95,width_confidence=.99).eval()
    rows={r['id']:r for r in map(json.loads,(a.dataset/'observations.jsonl').read_text().splitlines())}
    cache={};results=[];started=time.monotonic()
    def features(oid,view):
        key=(oid,view)
        if key not in cache:
            if len(cache)>=96:raise ValueError('Feature cache budget exceeded')
            row=rows[oid];path=a.dataset/row['cameras'][view]
            if sha(path)!=row['sha256'][view]:raise ValueError('Image hash mismatch')
            with torch.inference_mode():cache[key]=extractor.extract(load_image(path))
        return cache[key]
    for pair in pairs:
        current,history=pair['currentId'],pair['historicalId']
        if rows[history]['atMs']>=rows[current]['atMs']:raise ValueError('Candidate must be historical')
        matches=[]
        for left in ['front','left','right']:
            for right in ['front','left','right']:
                f0,f1=features(current,left),features(history,right)
                with torch.inference_mode():m=rbd(matcher({'image0':f0,'image1':f1}))
                indices=m['matches'];p0=rbd(f0)['keypoints'][indices[:,0]].cpu().numpy();p1=rbd(f1)['keypoints'][indices[:,1]].cpu().numpy()
                mask=None
                if len(p0)>=8:
                    _,mask=cv2.findFundamentalMat(p0,p1,cv2.FM_RANSAC,2.0,.99)
                inliers=mask.reshape(-1).astype(bool) if mask is not None and mask.size==len(p0) else np.zeros(len(p0),dtype=bool)
                matches.append({'currentView':left,'historicalView':right,'matches':len(p0),'inliers':int(inliers.sum()),'inlierRatio':float(inliers.mean()) if len(p0) else 0,'currentPoints':p0.tolist(),'historicalPoints':p1.tolist(),'inlierMask':inliers.tolist()})
        results.append({'currentId':current,'historicalId':history,'bestInliers':max(m['inliers'] for m in matches),'viewPairs':matches,'identityDecision':None})
        (a.output/'matches.json').write_text(json.dumps(results))
    weights=[{'path':str(path),'sha256':sha(path)} for path in (Path(torch.hub.get_dir())/'checkpoints').glob('*') if 'disk' in path.name.lower() or 'lightglue' in path.name.lower() or 'depth' in path.name.lower()]
    report={'method':'DISK-LightGlue-F-RANSAC','revision':subprocess.check_output(['git','-C',str(a.lightglue),'rev-parse','HEAD'],text=True).strip(),'maxKeypoints':512,'maxCandidatePairs':16,'evaluatedPairs':len(results),'elapsedSeconds':time.monotonic()-started,'weights':weights,'modelCalls':0,'note':'Geometric correspondences only. Not a room/observer identity, traversability or novel-place decision; failed geometry may reflect viewpoint/occlusion.'}
    (a.output/'complete.json').write_text(json.dumps(report,indent=2));print(json.dumps([{k:v for k,v in r.items() if k!='viewPairs'} for r in results]))

if __name__=='__main__':main()
