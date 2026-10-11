"""Multi-view symmetric surface verification; no poses or region labels.

Homographies verify shared surfaces, NOT whole-room identity. Requiring two
distinct query and target bearings reduces one-surface aliasing; the segment
matcher still requires independent temporal anchors and rejects competition.
"""
import argparse,json,time
from pathlib import Path
import cv2
import numpy as np
cv2.setNumThreads(1)

def verify(a,b):
    ka,da=a;kb,db=b
    if da is None or db is None:return None
    matcher=cv2.BFMatcher()
    def unique(x,y):
        return {m[0].queryIdx:m[0].trainIdx for m in matcher.knnMatch(x,y,k=2) if len(m)==2 and m[0].distance<.65*m[1].distance}
    forward=unique(da,db);backward=unique(db,da)
    pairs=[(i,j) for i,j in forward.items() if backward.get(j)==i]
    if len(pairs)<30:return None
    src=np.float32([ka[i] for i,j in pairs]);dst=np.float32([kb[j] for i,j in pairs])
    H,mask=cv2.findHomography(src,dst,cv2.RANSAC,.00625)
    if H is None or mask is None:return None
    try:inverse=np.linalg.inv(H)
    except np.linalg.LinAlgError:return None
    project=lambda x,h:cv2.perspectiveTransform(x[:,None,:],h)[:,0,:]
    errors=np.maximum(np.linalg.norm(project(src,H)-dst,axis=1),np.linalg.norm(project(dst,inverse)-src,axis=1))
    good=(mask.ravel()>0)&(errors<=.00625)
    if good.sum()<30 or good.mean()<.65:return None
    def spread(points):
        cells=set(map(tuple,np.minimum(3,np.maximum(0,(points*4).astype(int)))))
        return len(cells)>=6 and np.ptp(points[:,0])>=.35 and np.ptp(points[:,1])>=.35
    if not spread(src[good]) or not spread(dst[good]):return None
    return {'inliers':int(good.sum()),'ratio':float(good.mean()),'medianSymmetricNormalizedError':float(np.median(errors[good]))}

def main():
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    started=time.perf_counter();cv2.setRNGSeed(0)
    rows=[json.loads(line) for line in (a.dataset/'windows.jsonl').read_text().splitlines()]
    sift=cv2.SIFT_create(nfeatures=800);features=[]
    for row in rows:
        views=[]
        for direction in ['frames','left','right']:
            path=a.dataset/direction/f"{row['endTick']:04d}.jpg";im=cv2.imread(str(path),0)
            if im is None:raise ValueError(str(path))
            kp,desc=sift.detectAndCompute(im,None)
            views.append((np.float32([k.pt for k in kp]).reshape(-1,2)/[im.shape[1],im.shape[0]],desc,str(path.resolve())))
        features.append(views)
    pairs=[]
    for i in range(len(rows)):
        for j in range(i+1,len(rows)):
            matches=[]
            for x in range(3):
                for y in range(3):
                    # Resolution-normalized threshold: 2px at 320px width.
                    fa=features[i][x];fb=features[j][y]
                    result=verify(fa[:2],fb[:2])
                    if result:matches.append({'queryBearing':x,'targetBearing':y,'frames':[fa[2],fb[2]],**result})
            if any(x['queryBearing']!=y['queryBearing'] and x['targetBearing']!=y['targetBearing'] for x in matches for y in matches):
                pairs.append({'a':f'observation-{i+1}','b':f'observation-{j+1}','source':'mutual-SIFT symmetric distributed multi-bearing surface verification; not physical-region truth','matches':matches})
    with a.output.open('x') as f:json.dump({'protocol':'revisit-surface-geometry-v1','pairs':pairs,'extractionMs':(time.perf_counter()-started)*1000},f,indent=2)
    print(json.dumps({'observations':len(rows),'verifiedPairs':len(pairs)}))

if __name__=='__main__':main()
