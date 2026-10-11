"""Image-only geometric-opening/open-layout transition proposals.

Doorframe-like lines are hypotheses (cupboards/windows can look similar).
Temporal expansion + disappearance + subsequent visual/motion support is used,
not a single doorway detection. These remain revisable inferred boundaries,
NOT certified physical crossings. No room/pose/annotation input.
"""
import argparse
import json
import time
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(1)

def portal(image):
    h,w=image.shape
    lines=cv2.HoughLinesP(cv2.Canny(image,60,160),1,np.pi/180,threshold=35,minLineLength=int(h*.35),maxLineGap=12)
    vertical=[]
    if lines is not None:
        for x1,y1,x2,y2 in lines.reshape(-1,4):
            if abs(x2-x1)<=max(3,abs(y2-y1)*.08):vertical.append(((x1+x2)/2,min(y1,y2),max(y1,y2)))
    candidates=[]
    for a in vertical:
        for b in vertical:
            width=b[0]-a[0];top=max(a[1],b[1]);bottom=min(a[2],b[2])
            if .15*w<width<.85*w and bottom-top>.35*h and a[0]<w*.5<b[0]:
                # A connecting lintel distinguishes a rectangle-like opening
                # candidate from unrelated arbitrary vertical lines.
                if abs(a[1]-b[1])<.1*h:
                    row=max(0,min(h-1,int((a[1]+b[1])/2)))
                    edge=cv2.Canny(image,60,160)[max(0,row-3):min(h,row+4),int(a[0]):int(b[0])]
                    if edge.size and (edge.max(axis=0)>0).mean()>.35:candidates.append([float(a[0]/w),float(top/h),float(b[0]/w),float(bottom/h)])
    return max(candidates,key=lambda box:(box[2]-box[0])*(box[3]-box[1]),default=None)

def descriptor(image):
    small=cv2.resize(image,(96,96));hist=cv2.calcHist([small[48:]], [0],None,[32],[0,256]).ravel()
    edges=cv2.resize(cv2.Canny(small,60,160).astype(np.float32),(6,6),interpolation=cv2.INTER_AREA).ravel()
    return np.concatenate((.5*hist/max(1,hist.sum()),.5*edges/max(1,edges.sum())))

def overlap(a,b):
    area=lambda box:max(0,box[2]-box[0])*max(0,box[3]-box[1])
    shared=[max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])]
    return area(shared)/max(1e-6,area(a)+area(b)-area(shared))

class BoundaryTracker:
    def __init__(self):
        self.active=None;self.serial=0;self.previous=None;self.weak=0;self.moving=0
    def step(self,frame,image,motion):
        hist=descriptor(image);box=portal(image);events=[]
        def emit(kind,track,reason):events.append({'atFrame':frame,'kind':kind,'boundaryTrackId':track,'reason':reason,'frames':[frame],'source':'automatic-geometric-opening/open-layout-inference; not physical truth'})
        if motion not in ('movement-candidate','no-visible-motion') or motion=='no-visible-motion' and not (self.active and self.active['passed']):
            self.moving=0;self.weak=0;self.active=None;self.previous=hist
            return {'frame':frame,'portalCandidate':box,'status':'unknown-or-skipped-motion','events':events}
        self.moving=self.moving+1 if motion=='movement-candidate' else 0
        difference=float(.5*np.abs(hist-self.previous).sum()) if self.previous is not None else 0
        self.weak=self.weak+1 if difference>.18 else 0
        if self.active is None and box is not None and self.moving>=2:
            self.serial+=1;self.active={'track':f'opening-{self.serial}','mode':'opening','box':box,'width':box[2]-box[0],'hist':hist,'age':0,'expanded':False,'passed':False,'post':0}
            emit('boundary-approach',self.active['track'],'Tracked rectangle-like opening candidate during direction-stable visual movement')
        elif self.active is None and self.weak==2:
            self.serial+=1;self.active={'track':f'open-layout-{self.serial}','mode':'open-layout','hist':self.previous,'age':0,'passed':False,'post':0}
            emit('boundary-approach',self.active['track'],'Sustained lower-view layout change; weak open-space boundary candidate')
        elif self.active is not None:
            a=self.active;a['age']+=1
            if a['age']>12:self.active=None
            elif not a['passed']:
                if a['mode']=='opening':
                    if box is not None:
                        width=box[2]-box[0]
                        if overlap(box,a['box'])<.2:
                            self.active=None;self.previous=hist
                            return {'frame':frame,'portalCandidate':box,'status':'opening-track-lost','events':events}
                        if width<a['width']*.85:
                            emit('returned-inside',a['track'],'Tracked opening shrinks during movement; retreat candidate, not passage')
                            self.active=None;self.previous=hist
                            return {'frame':frame,'portalCandidate':box,'status':'retreat-candidate','events':events}
                        if width>a['width']*1.12:a['expanded']=True
                        a['width']=max(a['width'],width)
                        a['box']=box
                    if a['expanded'] and box is None and a['width']>.45:
                        a['passed']=True;emit('boundary-passage',a['track'],'Previously expanding opening leaves front view while supported visual movement continues; inferred passage')
                elif float(.5*np.abs(hist-a['hist']).sum())>.2:
                    a['passed']=True;emit('boundary-passage',a['track'],'Persistent appearance departure during movement; inferred functional change, not a doorway crossing')
            else:
                changed=float(.5*np.abs(hist-a['hist']).sum())>.1
                if changed:
                    a['post']+=1;emit('post-boundary-support',a['track'],'Post-transition view remains changed and visual movement is supported')
                    if a['post']>=6:self.active=None
                else:a['post']=0
        self.previous=hist
        return {'frame':frame,'portalCandidate':box,'appearanceDifference':difference,'activeTrack':self.active['track'] if self.active else None,'events':events}

def main():
    p=argparse.ArgumentParser();p.add_argument('frames',type=Path);p.add_argument('vo',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    started=time.perf_counter();vo=json.loads(a.vo.read_text());motion={r['afterFrame']:r['status'] for r in vo['trace']}
    tracker=BoundaryTracker();trace=[]
    for path in sorted(a.frames.glob('*.jpg')):
        image=cv2.imread(str(path),0)
        if image is None:raise ValueError(str(path))
        trace.append(tracker.step(path.name,image,motion.get(path.name,'unknown')))
    events=[event for row in trace for event in row['events']]
    with a.output.open('x') as f:json.dump({'protocol':'automatic-boundary-tracks-v1','quality':'experimental-inferred-not-certified','events':events,'trace':trace,'extractionMs':(time.perf_counter()-started)*1000,'note':'Classical rectangle lines can be furniture/windows. Appearance boundaries may be within-region. No simulator or reviewed identities consumed. Full-image geometric/semantic review still required.'},f,indent=2)
    print(json.dumps({'frames':len(trace),'events':len(events),'tracks':tracker.serial}))

if __name__=='__main__':main()
