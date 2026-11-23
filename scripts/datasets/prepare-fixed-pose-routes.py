"""Attach original-clock ideal poses to an EXISTING fixed recognizer run, without rerunning it."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import zipfile

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def load(path): return json.loads(path.read_text(encoding='utf8'))
def save(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')

def prepare(output, run, public, metadata):
    frozen=load(run/'frozen.json'); data=load(public)
    if sha(public)!=frozen['inputSha256']: raise ValueError('Fixed run input hash mismatch')
    events=[json.loads(line)['result'] for line in (run/'events.jsonl').read_text(encoding='utf8').splitlines() if line.strip()]
    predictions=load(run/'predictions.json')['predictions']
    completed=[p for p in predictions if p['status']=='completed']
    if len(completed)!=len(events) or not events: raise ValueError('Incomplete fixed event audit')
    by_id={r['id']:r for r in data['observations']}; visits=[]
    for event,prediction in zip(events,completed):
        row=by_id[event['id']]
        if event['id']!=prediction['id'] or event['placeId']!=prediction['placeId'] or row['atMs']!=event['atMs']:raise ValueError('Event/prediction/source mismatch')
        group=next((g for g in event['groups'] if g['id']==event['placeId']),None)
        images=[{'id':row['id'],**v} for v in row['views']]
        for image in images:
            if sha(Path(image['path']))!=image['sha256']:raise ValueError('Changed original')
        visits.append({'id':event['id'],'atMs':event['atMs'],'placeId':event['placeId'],'name':group['scope']['name'] if group else None,'images':images})
    with zipfile.ZipFile(metadata) as z:
        rows=[[float(x) for x in l.split()] for l in z.read('pose_lcam_front.txt').decode().splitlines()]
    last=visits[-1]['atMs'];poses=[]
    for i,row in enumerate(rows):
        if i*100>last:break
        x,y,z,qx,qy,qz,qw=row
        poses.append({'atMs':i*100,'x':x,'y':y,'z':z,'yawDeg':math.degrees(math.atan2(2*(qw*qz+qx*qy),1-2*(qy*qy+qz*qz))), 'frameId':'ModernCityDowntown-NED','recordingId':'P0006','source':'ideal-pose-experiment'})
    if not all(any(p['atMs']==v['atMs'] for p in poses) for v in visits):raise ValueError('Missing endpoint pose')
    output.mkdir(parents=True,exist_ok=False)
    save(output/'input.json',{'schema':'fixed-pose-route-input-v1','poses':poses,'visits':visits})
    tests=[];known=[v for v in visits if v['placeId'] is not None]
    for a,b in zip(known,known[1:]):
        samples=[p for p in poses if a['atMs']<=p['atMs']<=b['atMs']]
        if len(samples)<2 or any(q['atMs']-p['atMs']>150 for p,q in zip(samples,samples[1:])):continue
        distance=sum(math.dist([p[k] for k in ['x','y','z']],[q[k] for k in ['x','y','z']]) for p,q in zip(samples,samples[1:]))
        edge=f'edge-{a["id"]}-{b["id"]}'
        for direction in ['forward','reverse']:
            reverse=direction=='reverse';tests.append({'id':f'T{len(tests):03d}','edgeId':edge,'direction':direction,'from':b['placeId'] if reverse else a['placeId'],'to':a['placeId'] if reverse else b['placeId'],'fromVisitId':b['id'] if reverse else a['id'],'toVisitId':a['id'] if reverse else b['id'],'sampleAtMs':[p['atMs'] for p in (list(reversed(samples)) if reverse else samples)],'distanceM':distance})
    save(output/'gold.json',{'schema':'fixed-pose-route-gold-v1','tests':tests,'scope':'programmatic geometry regression on model candidate identities; NOT localization accuracy or language quality'})
    save(output/'frozen.json',{'schema':'fixed-pose-route-freeze-v1','inputSha256':sha(output/'input.json'),'goldSha256':sha(output/'gold.json'),'sourceEventsSha256':sha(run/'events.jsonl'),'sourcePredictionsSha256':sha(run/'predictions.json'),'metadataSha256':sha(metadata),'completedFixedObservations':len(visits),'knownFixedObservations':len(known),'plannedFixedObservations':len(predictions),'sourceSpanMs':last,'tests':len(tests),'note':'No paid grouping rerun, no splice, no pending/failed frames ingested; ideal pose sidecar never given to fixed recognizer.'})
    return load(output/'frozen.json')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--run',type=Path,default=Path('run/spatial-fixed-evaluation/2026-10-27T10-11-15-752Z-3cf087e3'))
    p.add_argument('--public',type=Path,default=Path('run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1/public.json'))
    p.add_argument('--metadata',type=Path,default=Path('datasets/tartanground-moderncity-speeds-v1/P0006-metadata.zip'))
    a=p.parse_args();print(json.dumps(prepare(a.output,a.run,a.public,a.metadata)))
