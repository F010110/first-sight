"""Calibrated rotational homography diagnostics, no poses/room/action labels.

Uses known 90-degree FOV of these recorded cameras, not estimated metric motion.
Broad feature support and consistent relative panel shifts are required. Failure
is unknown, never evidence of different regions. This is identity evidence, NOT
activity-region segmentation or a replacement for boundary/object tracking.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    rows = [json.loads(x) for x in (args.dataset/'windows.jsonl').read_text().splitlines()]
    detector = cv2.SIFT_create(nfeatures=2500)
    features = []
    for row in rows:
        views = []
        for name in ['left', 'frames', 'right']:
            path = args.dataset/name/f"{row['endTick']:04d}.jpg"
            im = cv2.imread(str(path), 0)
            if im is None: raise ValueError(str(path))
            kp, desc = detector.detectAndCompute(im, None)
            h, w = im.shape
            K = np.array([[w/2,0,w/2],[0,w/2,h/2],[0,0,1]],float)
            views.append((kp,desc,K,w,h,str(path)))
        features.append(views)
    matcher = cv2.BFMatcher()
    results = []
    for a in range(len(rows)):
        for b in range(a+1,len(rows)):
            matches = []
            for qa,q in enumerate(features[a]):
                for cb,c in enumerate(features[b]):
                    if q[1] is None or c[1] is None: continue
                    good = [p[0] for p in matcher.knnMatch(q[1],c[1],k=2) if len(p)==2 and p[0].distance < .7*p[1].distance]
                    if len(good)<40: continue
                    src=np.float32([q[0][m.queryIdx].pt for m in good]);dst=np.float32([c[0][m.trainIdx].pt for m in good])
                    H,mask=cv2.findHomography(src,dst,cv2.RANSAC,2)
                    if H is None or mask is None: continue
                    keep=mask.ravel().astype(bool); points=src[keep]
                    if len(points)<40 or keep.mean()<.65: continue
                    coverage=cv2.contourArea(cv2.convexHull(points))/(q[3]*q[4])
                    cells=len(set((min(2,int(x*3/q[3])),min(2,int(y*3/q[4]))) for x,y in points))
                    R=np.linalg.inv(c[2])@H@q[2]
                    det=np.linalg.det(R)
                    if det<=0: continue
                    R=R/np.cbrt(det)
                    error=float(np.linalg.norm(R.T@R-np.eye(3)))
                    # Rotation about the calibrated optical center must preserve
                    # ray angles. A fit to just one distant object is insufficient.
                    if coverage>=.35 and cells>=6 and error<=.04:
                        matches.append({'queryView':qa,'candidateView':cb,'coverage':float(coverage),'cells':cells,'rotationError':error,'inliers':int(keep.sum()),'frames':[q[5],c[5]]})
            # Panels differ by 90 degrees. Consistent shift, >=2 independent views.
            supported=[]
            for shift in range(4):
                selected=[m for m in matches if (m['candidateView']-m['queryView'])%4==shift]
                if len(set(m['queryView'] for m in selected))>=2 and len(set(m['candidateView'] for m in selected))>=2: supported=selected;break
            if supported: results.append({'a':f'observation-{a+1}','b':f'observation-{b+1}','source':'calibrated-broad-support-rotation-homography','matches':supported})
        print(f'geometry {a+1}/{len(rows)}',flush=True)
    with args.output.open('x',encoding='utf8') as f:json.dump({'note':'Experimental positive local rotational correspondence only; no guaranteed pure rotation, no boundary negatives or region labels. Thresholds fixed before new scoring. No oracle inputs.','pairs':results},f,indent=2)

if __name__=='__main__':main()
