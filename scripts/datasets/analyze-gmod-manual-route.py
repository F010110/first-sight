"""Offline coordinate-only survey analysis. Does not infer visual memory scores."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

def main(root, output):
    output.mkdir(parents=True, exist_ok=False)
    def rows(name):
        return [json.loads(x) for x in (root/(name+'.jsonl.txt')).read_text(encoding='utf8').splitlines() if x.strip()]
    trajectory, inputs = rows('trajectory'), rows('input_changes')
    times=np.array([r['time_s'] for r in trajectory]);pos=np.array([r['position_source'] for r in trajectory])
    events=[]
    for i,r in enumerate(inputs):
        if not r['buttons'] & 32 or (i and inputs[i-1]['buttons'] & 32): continue
        j=int(np.argmin(abs(times-r['time_s'])))
        distance=float(np.linalg.norm(np.array(r['hit_position_source'])-trajectory[j]['eye_position_source']))
        target=r.get('target') or {};kind=target.get('class','none')
        candidate='door' in kind.lower() and distance <= 100
        events.append({'source_time_s':r['time_s'],'elapsed_s':r['time_s']-times[0],
            'target':target,'eye_to_hit_source_units':distance,
            'classification':'nearby-door-candidate' if candidate else 'unconfirmed-or-not-nearby-door',
            'success_verified':False})
    # One-second samples. A revisit requires a >=30s gap and a substantial intervening excursion.
    indices=[];last=-1e9
    for i,t in enumerate(times):
        if t-last>=1:indices.append(i);last=t
    revisits=[];last_return=-1e9
    for k,i in enumerate(indices):
        if times[i]-last_return<15:continue
        earlier=[j for j in indices[:k] if times[i]-times[j]>=30 and
                 np.linalg.norm(pos[i,:2]-pos[j,:2])<=64 and abs(pos[i,2]-pos[j,2])<=48]
        if not earlier:continue
        j=min(earlier,key=lambda j:np.linalg.norm(pos[i]-pos[j]))
        excursion=float(np.max(np.linalg.norm(pos[j:i+1,:2]-pos[j,:2],axis=1)))
        if excursion<256:continue
        revisits.append({'first_elapsed_s':float(times[j]-times[0]),'return_elapsed_s':float(times[i]-times[0]),
            'separation_s':float(times[i]-times[j]),'distance_source_units':float(np.linalg.norm(pos[i]-pos[j])),
            'intervening_excursion_source_units':excursion,'position_source':pos[i].tolist(),
            'same_room_verified':False})
        last_return=times[i]
    summary={'source':str(root),'samples':len(trajectory),'span_s':float(times[-1]-times[0]),
        'use_press_edges':len(events),'nearby_door_candidates':sum(e['classification']=='nearby-door-candidate' for e in events),
        'verified_successful_interactions':None,'coordinate_revisit_candidates':len(revisits),
        'images_available':False,'visual_system_run_possible_from_this_recording':False,
        'limitations':['No door before/after state: cannot certify E success.',
                      'Coordinate proximity is not room identity or visual recognition.',
                      'No images: cannot evaluate visual memory or synthesize original observations.']}
    for name,value in [('summary',summary),('use-events',events),('revisits',revisits)]:
        (output/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
    image=Image.new('RGB',(1400,1000),'white');draw=ImageDraw.Draw(image)
    lo=pos[:,:2].min(axis=0);hi=pos[:,:2].max(axis=0);scale=min(1280/max(hi[0]-lo[0],1),820/max(hi[1]-lo[1],1))
    def point(p):return (int(60+(p[0]-lo[0])*scale),int(920-(p[1]-lo[1])*scale))
    draw.line([point(p) for p in pos],fill=(70,100,180),width=2)
    for n,r in enumerate(revisits):
        x,y=point(r['position_source']);draw.ellipse((x-5,y-5,x+5,y+5),fill='red');draw.text((x+6,y),str(n+1),fill='black')
    draw.text((30,20),'UnionCity manual route: XY projection; floors overlap. Red = coordinate revisit candidates.',fill='black')
    draw.text((30,45),'No imagery; no room identity or successful door interaction certified.',fill='black')
    image.save(output/'route-xy.png')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();main(a.root,a.output)
