"""Image-only three-bearing VO diagnostic, not VIO or metric localization.

Input directories frames/left/right; no annotations, poses or IMU loaded.
Known simulation square 90deg pinhole calibration. Each bearing is temporal
monocular VO, not simultaneous stereo triangulation. Conservative decisions.
"""
import argparse
import json
import time
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(1)

def classify_view(first, second, intrinsics=None):
    if first.shape != second.shape:
        raise ValueError('Camera resolution changed')
    h,w=first.shape
    if intrinsics is None:
        if h!=w:raise ValueError('Non-square image requires explicit camera calibration')
        intrinsics={'fx':w/2,'fy':w/2,'cx':w/2,'cy':h/2,'width':w,'height':h}
    if any(not np.isfinite(intrinsics[key]) for key in ['fx','fy','cx','cy','width','height']) or intrinsics['fx']<=0 or intrinsics['fy']<=0 or intrinsics['width']!=w or intrinsics['height']!=h:
        raise ValueError('Invalid/resolution-mismatched intrinsics')
    k=np.array([[intrinsics['fx'],0,intrinsics['cx']],[0,intrinsics['fy'],intrinsics['cy']],[0,0,1]],float)
    detector=cv2.SIFT_create(nfeatures=2000)
    ka,da=detector.detectAndCompute(first,None);kb,db=detector.detectAndCompute(second,None)
    unknown={'status':'unknown','reason':'insufficient-unique-matches'}
    if da is None or db is None:return {**unknown,'reason':'no-descriptors'}
    matcher=cv2.BFMatcher()
    forward=[p[0] for p in matcher.knnMatch(da,db,k=2) if len(p)==2 and p[0].distance<.65*p[1].distance]
    backward={p[0].queryIdx:p[0].trainIdx for p in matcher.knnMatch(db,da,k=2) if len(p)==2 and p[0].distance<.65*p[1].distance}
    matches=[m for m in forward if backward.get(m.trainIdx)==m.queryIdx]
    if len(matches)<20:return {**unknown,'matches':len(matches)}
    src=np.float32([ka[m.queryIdx].pt for m in matches]);dst=np.float32([kb[m.trainIdx].pt for m in matches])
    cells=lambda pts:len(set((int(x*3/w),int(y*3/h)) for x,y in pts))
    if cells(src)<4:return {**unknown,'reason':'concentrated-tracks','matches':len(matches)}
    displacement=np.linalg.norm(dst-src,axis=1)
    result={'status':'unknown','reason':'geometry-not-supported','matches':len(matches),'cells':cells(src),'medianFlowPixels':float(np.median(displacement))}
    if (displacement<=1).mean()>=.9:
        return {**result,'status':'no-visible-motion','reason':'No visible motion; not proof of stationary position'}
    H,mask=cv2.findHomography(src,dst,cv2.RANSAC,2)
    if H is not None and mask is not None and mask.sum()>=20 and mask.mean()>=.65:
        normalized=np.linalg.inv(k)@H@k
        if np.linalg.det(normalized)>0:
            normalized/=np.cbrt(np.linalg.det(normalized))
            u,_,vt=np.linalg.svd(normalized);rotation=u@vt
            error=float(np.linalg.norm(normalized-rotation))
            angle=float(np.degrees(np.arccos(np.clip((np.trace(rotation)-1)/2,-1,1))))
            result.update(homographyRotationError=error,homographyRotationDegrees=angle)
            if error<.015 and angle>3:
                return {**result,'status':'rotation','reason':'Broad correspondences explained by nontrivial calibrated rotation'}
    E,mask=cv2.findEssentialMat(src,dst,k,method=cv2.RANSAC,prob=.999,threshold=1)
    if E is None or E.shape!=(3,3) or mask is None:return {**result,'reason':'essential-estimation-failed'}
    count,R,_,pose_mask=cv2.recoverPose(E,src,dst,k,mask=mask.copy())
    angle=float(np.degrees(np.arccos(np.clip((np.trace(R)-1)/2,-1,1))))
    inliers=pose_mask.ravel()>0
    result.update(poseInliers=int(count),estimatedRotationDegrees=angle)
    if count<20 or count/len(matches)<.6 or cells(src[inliers])<4:return {**result,'reason':'insufficient-pose-inlier-support'}
    if angle>3:return {**result,'status':'unknown','reason':'ambiguous-essential-rotation; pure-rotation model not verified'}
    rays=np.column_stack(((src[:,0]-intrinsics['cx'])/intrinsics['fx'],(src[:,1]-intrinsics['cy'])/intrinsics['fy'],np.ones(len(src))))@R.T
    projected=rays[:,:2]/rays[:,2:3]*[intrinsics['fx'],intrinsics['fy']]+[intrinsics['cx'],intrinsics['cy']]
    residual=np.linalg.norm(projected-dst,axis=1)
    result['medianRotationCompensatedPixels']=float(np.median(residual[inliers]))
    if np.median(residual[inliers])>=2:
        return {**result,'status':'translation-candidate','reason':'Low recovered rotation with distributed cheirality-supported parallax; scale unknown'}
    return {**result,'reason':'low-parallax'}

def combine(views):
    # A single monocular fit is not a rig-wide rotation measurement.
    rotations=sum(v['status']=='rotation' for v in views)
    translations=sum(v['status']=='translation-candidate' for v in views)
    if rotations>=2 and translations==0:return 'skipped-rotation'
    if rotations:return 'unknown'
    if sum(v['status']=='translation-candidate' for v in views)>=2:return 'movement-candidate'
    if all(v['status']=='no-visible-motion' for v in views):return 'no-visible-motion'
    return 'unknown'

def main():
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('output',type=Path);p.add_argument('--calibration',type=Path);a=p.parse_args()
    started=time.perf_counter();cv2.setRNGSeed(0)
    calibration=json.loads(a.calibration.read_text()) if a.calibration else None
    paths=sorted((a.dataset/'frames').glob('*.jpg'));trace=[]
    if len(paths)<2:raise ValueError('At least two chronological image triples required')
    names=[path.name for path in paths]
    if any(not path.stem.isdigit() for path in paths) or [int(path.stem) for path in paths]!=sorted(int(path.stem) for path in paths):raise ValueError('Numeric chronological frame names required')
    for direction in ['left','right']:
        if sorted(path.name for path in (a.dataset/direction).glob('*.jpg'))!=names:raise ValueError(f'Unpaired image triple inventory: {direction}')
    for old,new in zip(paths,paths[1:]):
        views=[]
        for direction in ['frames','left','right']:
            x=cv2.imread(str(a.dataset/direction/old.name),0);y=cv2.imread(str(a.dataset/direction/new.name),0)
            if x is None or y is None:raise ValueError(f'Missing {direction} images')
            views.append({'direction':direction,**classify_view(x,y,calibration[direction] if calibration else None)})
        trace.append({'beforeFrame':old.name,'afterFrame':new.name,'status':combine(views),'views':views})
    counts={s:sum(r['status']==s for r in trace) for s in ['movement-candidate','skipped-rotation','no-visible-motion','unknown']}
    elapsed=(time.perf_counter()-started)*1000
    with a.output.open('x') as f:json.dump({'protocol':'three-view-vo-v1','calibrationSource':'explicit-camera-intrinsics' if calibration else 'simulation-square-90deg','extractionMs':elapsed,'note':'Image-only VO, NOT VIO. No GT/IMU read. Planar/repetitive/dynamic scene degeneracy remains; skipped rotation is not stationary, and movement does not imply crossing. Decisions diagnostic only.','counts':counts,'trace':trace},f,indent=2)
    print(json.dumps(counts))

if __name__=='__main__':main()
