"""Cheap visual change-point + optional direction ablation, NOT crossing truth.

Candidate cuts never authorize same/different physical regions. No room/pose or
annotation file is loaded; missing heading is not stationary. The weak baseline
is deliberately separated from future tracked-opening structural evidence.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

def descriptor(path):
    im=cv2.imread(str(path))
    if im is None:raise ValueError(str(path))
    hsv=cv2.cvtColor(cv2.resize(im,(160,160)),cv2.COLOR_BGR2HSV)
    # Floor/lower view appearance, not a learned spatial boundary classifier.
    hist=cv2.calcHist([hsv[80:]], [0,1],None,[16,8],[0,180,0,256]).flatten()
    hist=hist/(hist.sum() or 1)
    return hist

def main():
    p=argparse.ArgumentParser();p.add_argument('frames',type=Path);p.add_argument('output',type=Path);p.add_argument('--headings',type=Path)
    a=p.parse_args();headings={}
    if a.headings:headings={s['observationId']:s for s in json.loads(a.headings.read_text())['samples']}
    paths=sorted(a.frames.glob('*.jpg'));events=[];trace=[];weak=0;last_cut=-100;prev=None
    for path in paths:
        desc=descriptor(path)
        if prev:
            old,old_desc=prev;tick=int(path.stem);sa=headings.get(f'observation-{int(old.stem)}');sb=headings.get(f'observation-{tick}');difference=float(.5*np.abs(desc-old_desc).sum())
            heading_status='unknown';explained_turn=False
            if sa and sb and sa['quality']=='usable' and sb['quality']=='usable' and sa['referenceId']==sb['referenceId']:
                heading_status='available';delta=abs(((sb['yawDegrees']-sa['yawDegrees']+180)%360)-180)
                # Only suppress the weak appearance-only cue. Never suppress a
                # future positive opening-crossing event on heading alone.
                explained_turn=delta>10+sa['uncertaintyDegrees']+sb['uncertaintyDegrees']
            weak=weak+1 if difference>.18 and not explained_turn else 0
            if weak>=2 and tick-last_cut>=8:
                events.append({'id':f'appearance-change-{tick}','beforeObservationId':f'observation-{tick}','source':'automatic','reason':'Sustained lower-view appearance change: weak candidate only, no verified boundary','frames':[str(old),str(path)]});last_cut=tick;weak=0
            trace.append({'tick':tick,'appearanceDifference':difference,'headingStatus':heading_status,'appearanceCueSuppressedByTurn':explained_turn})
        prev=(path,desc)
    with a.output.open('x') as f:json.dump({'protocol':'boundary-events-v1','revision':1,'reviewed':False,'note':'Unvalidated appearance-change candidate baseline. No spatial truth, identity or navigation inferred. Direction-conditioned mode uses explicit simulation sensor ablation if supplied.','condition':'appearance-plus-direction' if a.headings else 'appearance-only','boundaries':events,'trace':trace},f,indent=2)
    print(json.dumps({'condition':'appearance-plus-direction' if a.headings else 'appearance-only','events':len(events),'frames':len(paths)}))

if __name__=='__main__':main()
