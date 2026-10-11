"""Actual adjacent RGB tracking + orientation-compensated motion diagnostics.

Reads frames and direction-only experiment inputs, never room/position/actions.
Forward/backward LK rejects unstable tracks, NOT all dynamic objects. Outputs
movement candidates only; never supplies boundary-passage or region identities.
"""
import argparse
import json
import math
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(1)

def tilt(pitch, roll):
    p, r = math.radians(pitch), math.radians(roll)
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    return rz @ rx

def assess(src, dst, rotation, width, height):
    """Simulation camera uses a known 90-degree square pinhole calibration."""
    if len(src) < 12:
        return {'status': 'unknown', 'reason': 'Insufficient round-trip tracks'}
    k = np.array([[width/2, 0, width/2], [0, width/2, height/2], [0, 0, 1]], float)
    rays = np.column_stack(((src[:, 0]-width/2)/(width/2), (src[:, 1]-height/2)/(width/2), np.ones(len(src)))) @ rotation.T
    visible = rays[:, 2] > 1e-6
    projected = np.full_like(src, np.nan)
    projected[visible] = rays[visible, :2] / rays[visible, 2:3] * (width/2) + [width/2, height/2]
    visible &= np.all(np.isfinite(projected), axis=1) & (projected[:, 0]>=0) & (projected[:, 0]<width) & (projected[:, 1]>=0) & (projected[:, 1]<height)
    src, dst, projected = src[visible], dst[visible], projected[visible]
    cells = lambda points: len(set((int(x*3/width), int(y*3/height)) for x, y in points))
    if len(src)<12 or cells(src)<4:
        return {'status': 'unknown', 'reason': 'Insufficient distributed visible tracks'}
    residual = np.linalg.norm(dst-projected, axis=1)
    aligned, moved = residual<=3, residual>=8
    status = 'rotation-explained' if aligned.mean()>=.8 else 'movement-candidate' if moved.mean()>=.6 and cells(src[moved])>=4 else 'unknown'
    return {'status': status, 'tracks': len(src), 'cells': cells(src), 'medianResidualPixels': float(np.median(residual)), 'rotationExplainedFraction': float(aligned.mean()), 'largeResidualFraction': float(moved.mean()), 'reason': 'Track residual diagnostic; moving objects and calibration error remain possible'}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('frames', type=Path); parser.add_argument('orientation', type=Path); parser.add_argument('output', type=Path)
    args=parser.parse_args()
    data=json.loads(args.orientation.read_text()); samples={s['observationId']:s for s in data['samples']}
    paths=sorted(args.frames.glob('*.jpg')); previous=None; trace=[]; streak=0; previous_after=None
    for path in paths:
        image=cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is None: raise ValueError(str(path))
        if previous is not None:
            old_path, old_image=previous
            if old_image.shape != image.shape: raise ValueError('Camera resolution changed')
            a, b=f'observation-{int(old_path.stem)}', f'observation-{int(path.stem)}'
            sa, sb=samples.get(a), samples.get(b)
            result={'a':a, 'b':b, 'status':'unknown', 'reason':'Missing/unreliable/interrupted full orientation', 'frames':[str(old_path), str(path)], 'provesStationary':False}
            if sa and sb and sa['quality']=='usable' and sb['quality']=='usable' and sa['referenceId']==sb['referenceId'] and 0<sb['atMs']-sa['atMs']<=1500 and sa['uncertaintyDegrees']+sb['uncertaintyDegrees']<=1 and all(key in s for s in (sa,sb) for key in ('pitchDegrees','rollDegrees')):
                points=cv2.goodFeaturesToTrack(old_image, maxCorners=500, qualityLevel=.01, minDistance=7, blockSize=7)
                if points is not None:
                    dst, ok, _=cv2.calcOpticalFlowPyrLK(old_image, image, points, None, winSize=(21,21), maxLevel=3)
                    if dst is not None:
                        back, back_ok, _=cv2.calcOpticalFlowPyrLK(image, old_image, dst, None, winSize=(21,21), maxLevel=3)
                        if back is not None:
                            src=points.reshape(-1,2); dest=dst.reshape(-1,2)
                            keep=ok.ravel().astype(bool)&back_ok.ravel().astype(bool)&(np.linalg.norm(back.reshape(-1,2)-src, axis=1)<=1)&np.all(np.isfinite(dest),axis=1)&(dest[:,0]>=0)&(dest[:,0]<image.shape[1])&(dest[:,1]>=0)&(dest[:,1]<image.shape[0])
                            delta=math.radians(-(((sb['yawDegrees']-sa['yawDegrees']+180)%360)-180))
                            yaw=np.array([[math.cos(delta),0,math.sin(delta)],[0,1,0],[-math.sin(delta),0,math.cos(delta)]])
                            rotation=tilt(sb['pitchDegrees'],sb['rollDegrees'])@yaw@tilt(sa['pitchDegrees'],sa['rollDegrees']).T
                            result.update(assess(src[keep],dest[keep],rotation,image.shape[1],image.shape[0]))
            streak=streak+1 if result['status']=='movement-candidate' and previous_after==a else 1 if result['status']=='movement-candidate' else 0
            result.update(consecutiveMovementPairs=streak, sustainedMovementCandidate=streak>=2)
            trace.append(result); previous_after=b
        previous=(path,image)
    summary={'pairs':len(trace),'rotationExplained':sum(r['status']=='rotation-explained' for r in trace),'movementCandidates':sum(r['status']=='movement-candidate' for r in trace),'sustainedCandidatePairs':sum(r['sustainedMovementCandidate'] for r in trace)}
    with args.output.open('x',encoding='utf8') as f: json.dump({'protocol':'continuous-motion-diagnostic-v1','calibration':'simulation-square-pinhole-90deg; not phone calibration','note':'Round-trip optical flow is not dynamic-object rejection. Consecutive pair evidence is correlated, not independent tracks. No region identity, metric displacement, stationary proof or confirmed movement-support generated.','summary':summary,'trace':trace},f,indent=2)
    print(json.dumps(summary))

if __name__=='__main__':main()
