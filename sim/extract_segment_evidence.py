"""Frozen oracle-batch feature evidence; no historical labels or metric poses.

Only representative cuts are read from reviewed boundary annotations. Local
geometry is experimental positive support, not a guaranteed region classifier.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np
cv2.setNumThreads(1)

def main():
    p=argparse.ArgumentParser();p.add_argument('episode',type=Path);p.add_argument('boundaries',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();annotations=json.loads(a.boundaries.read_text());windows=[json.loads(x) for x in (a.episode/'windows.jsonl').read_text().splitlines()]
    if not annotations.get('reviewed'):raise ValueError('Reviewed cut annotations required')
    cuts=[int(b['beforeObservationId'].split('-')[-1])-1 for b in annotations['boundaries']]
    segments=[]
    starts=[0]+sorted(cuts)
    for i,start in enumerate(starts):segments.append(list(range(start,starts[i+1] if i+1<len(starts) else len(windows))))
    # Fixed representative budget; no label-driven best-frame selection.
    selected=set()
    for segment in segments:
        selected.update(segment[int(round(j))] for j in np.linspace(0,len(segment)-1,min(8,len(segment))))
    detector=cv2.SIFT_create(nfeatures=2000);features={}
    for i in sorted(selected):
        path=a.episode/windows[i]['frame'];im=cv2.imread(str(path),0)
        if im is None:raise ValueError(str(path))
        kp,desc=detector.detectAndCompute(im,None);h,w=im.shape;features[i]=(kp,desc,np.array([[w/2,0,w/2],[0,w/2,h/2],[0,0,1]],float),h,w,str(path))
    matcher=cv2.BFMatcher();links=[];unique=sorted(selected)
    for index,i in enumerate(unique):
        q=features[i]
        for j in unique[index+1:]:
            c=features[j]
            if q[1] is None or c[1] is None:continue
            good=[x[0] for x in matcher.knnMatch(q[1],c[1],k=2) if len(x)==2 and x[0].distance<.7*x[1].distance]
            if len(good)<15:continue
            src=np.float32([q[0][m.queryIdx].pt for m in good]);dst=np.float32([c[0][m.trainIdx].pt for m in good]);H,mask=cv2.findHomography(src,dst,cv2.RANSAC,2)
            if H is None or mask is None:continue
            keep=mask.ravel().astype(bool);n=int(keep.sum())
            if n<15:continue
            points=src[keep];hull=cv2.contourArea(cv2.convexHull(points))/(q[3]*q[4]);R=np.linalg.inv(c[2])@H@q[2];det=np.linalg.det(R)
            error=float('inf')
            if det>0:R/=np.cbrt(det);error=float(np.linalg.norm(R.T@R-np.eye(3)))
            confidence=1-float(np.exp(-n/60))
            base={'a':f'observation-{i+1}','b':f'observation-{j+1}','confidence':confidence,'source':'single-front-view-SIFT-homography; not multi-camera independent bearings','frames':[q[5],c[5]]}
            links.append({'id':f'visual-{i}-{j}','kind':'visual',**base})
            if n>=40 and keep.mean()>=.65 and hull>=.35 and error<=.04:
                links.append({'id':f'geometry-{i}-{j}','kind':'geometric',**base})
        if index%16==0:print(f'anchors {index+1}/{len(unique)}',flush=True)
    with a.output.open('x') as f:json.dump({'note':'Sparse single-front-view structural baseline. Segmentation oracle cuts supplied, no room/pose/region labels read. No simulated multi-camera bearings. Thresholds fixed before scene-held-out scoring.','selectedAnchors':len(unique),'anchorObservationIds':[f'observation-{i+1}' for i in unique],'links':links},f,indent=2)
    print(json.dumps({'anchors':len(unique),'links':len(links),'geometric':sum(l['kind']=='geometric' for l in links)}))

if __name__=='__main__':main()
