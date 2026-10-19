"""Heading-constrained adjacent feature tracks; no region or pose inputs.

Rotational consistency is only positive local evidence, not proof of stationary
position. Missing heading or inadequate visual support remains unknown.
"""
import argparse
import json
import math
from pathlib import Path
import cv2
import numpy as np

def main():
    p=argparse.ArgumentParser();p.add_argument('frames',type=Path);p.add_argument('headings',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args()
    data=json.loads(a.headings.read_text())
    samples={s['observationId']:s for s in data['samples']}
    paths=sorted(a.frames.glob('*.jpg'));detector=cv2.SIFT_create(nfeatures=2000);matcher=cv2.BFMatcher()
    evidence=[];previous=None
    for path in paths:
        image=cv2.imread(str(path),0)
        if image is None:raise ValueError(str(path))
        kp,desc=detector.detectAndCompute(image,None);current=(path,kp,desc,image.shape)
        if previous is not None:
            q,qkp,qdesc,shape=previous;idA=f'observation-{int(q.stem)}';idB=f'observation-{int(path.stem)}';sa=samples.get(idA);sb=samples.get(idB)
            result={'a':idA,'b':idB,'relation':'unknown','reason':'Missing/unreliable direction or insufficient tracked rays','frames':[str(q),str(path)],'source':'heading-plus-calibrated-temporal-feature-tracks','provesStationary':False}
            if sa and sb and 'pitchDegrees' in sa and 'pitchDegrees' in sb and 'rollDegrees' in sa and 'rollDegrees' in sb and sa['quality']=='usable' and sb['quality']=='usable' and sa['referenceId']==sb['referenceId'] and 0<sb['atMs']-sa['atMs']<=1500 and qdesc is not None and desc is not None:
                delta=((sb['yawDegrees']-sa['yawDegrees']+180)%360)-180
                uncertainty=sa['uncertaintyDegrees']+sb['uncertaintyDegrees']
                # No heading change does not imply no translation. Do not use it
                # as positive same-footprint evidence in this rotation experiment.
                if 5<abs(delta)<150 and abs(delta)+uncertainty<180:
                    good=[pair[0] for pair in matcher.knnMatch(qdesc,desc,k=2) if len(pair)==2 and pair[0].distance<.7*pair[1].distance]
                    if len(good)>=25:
                        src=np.float32([qkp[m.queryIdx].pt for m in good]);dst=np.float32([kp[m.trainIdx].pt for m in good])
                        h,w=shape;K=np.array([[w/2,0,w/2],[0,w/2,h/2],[0,0,1]],float)
                        angle=math.radians(-delta);R=np.array([[math.cos(angle),0,math.sin(angle)],[0,1,0],[-math.sin(angle),0,math.cos(angle)]])
                        def tilt(pitch,roll):
                            p=math.radians(pitch);r=math.radians(roll)
                            rx=np.array([[1,0,0],[0,math.cos(p),-math.sin(p)],[0,math.sin(p),math.cos(p)]])
                            rz=np.array([[math.cos(r),-math.sin(r),0],[math.sin(r),math.cos(r),0],[0,0,1]])
                            return rz@rx
                        R=tilt(sb['pitchDegrees'],sb['rollDegrees'])@R@tilt(sa['pitchDegrees'],sa['rollDegrees']).T
                        projected=cv2.perspectiveTransform(src.reshape(-1,1,2),K@R@np.linalg.inv(K)).reshape(-1,2)
                        residual=np.linalg.norm(projected-dst,axis=1)
                        # Fixed pixel tolerance; angular noise is NOT converted
                        # into unlimited tolerance to force positive decisions.
                        keep=residual<=4;support=src[keep]
                        hull=cv2.contourArea(cv2.convexHull(support))/(w*h) if len(support)>=3 else 0
                        cells=len(set((min(2,int(x*3/w)),min(2,int(y*3/h))) for x,y in support))
                        result.update(deltaDegrees=delta,uncertaintyDegrees=uncertainty,inliers=int(keep.sum()),coverage=float(hull),cells=cells)
                        if keep.sum()>=25 and keep.mean()>=.6 and hull>=.2 and cells>=4:
                            result.update(relation='local-support',reason='Broad feature tracks agree with independently supplied heading rotation; position still unmeasured')
            evidence.append(result)
        previous=current
    with a.output.open('x',encoding='utf8') as f:json.dump({'note':'Adjacent rotational support only, not a region partition or standalone identity. Simulation heading ablation; actual device calibration/drift unvalidated.','mode':data['mode'],'evidence':evidence},f,indent=2)
    print(json.dumps({'mode':data['mode'],'pairs':len(evidence),'supported':sum(r['relation']=='local-support' for r in evidence)}))

if __name__=='__main__':main()
