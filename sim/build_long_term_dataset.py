"""Package actual simulator captures into agent/GT-isolated multi-session data.

Never invent new routes, mutations, or object annotations from repeated videos.
Spec: {buildings:[{id,split,sessions:[{id,role,capture}]}]}.
"""
import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path

ROLES=['initial','alternate-route','similar-area','changed','memory-task']


def build(spec_path, output, building_id=None):
    spec_path=Path(spec_path).resolve();output=Path(output).resolve()
    spec=json.loads(spec_path.read_text(encoding='utf8'))
    if building_id is not None:
        spec['buildings']=[building for building in spec['buildings'] if building['id']==building_id]
        if not spec['buildings']:raise ValueError('Unknown building filter')
    if output.exists():raise ValueError('Output must be new; never overwrite a dataset')
    output.mkdir(parents=True)
    observations=[];truth=[];tasks=[];reports=[];seen_buildings=set();seen_sessions=set();clock=0
    for building in spec['buildings']:
        bid=building['id']
        if bid in seen_buildings:raise ValueError('Building cannot appear in multiple splits')
        seen_buildings.add(bid)
        if building['split'] not in ['train','dev','test']:raise ValueError('Invalid split')
        previous={};roles=[];digests=set()
        for session in building['sessions']:
            sid=session['id'];role=session['role']
            if sid in seen_sessions or role not in ROLES:raise ValueError('Duplicate session or invalid role')
            seen_sessions.add(sid);roles.append(role)
            capture=(spec_path.parent/session['capture']).resolve()
            manifest=json.loads((capture/'manifest.json').read_text())
            if manifest.get('sceneId')!=bid:raise ValueError('Capture scene differs from building')
            if not manifest.get('license'):raise ValueError('Capture license provenance required')
            if role=='changed':
                if not manifest.get('editable') or not session.get('intervention_manifest'):
                    raise ValueError('Changed sessions require editable scene and actual intervention provenance')
                intervention=json.loads((spec_path.parent/session['intervention_manifest']).read_text())
                if intervention.get('applied') is not True or not intervention.get('changes') or not intervention.get('beforeDigest') or intervention['beforeDigest']==intervention.get('afterDigest'):
                    raise ValueError('Intervention must record applied nonempty changes and distinct states')
            # Track real route evidence, not just frame filenames.
            trace=json.loads((capture/'collector-trace.json').read_text())
            digest=hashlib.sha256(json.dumps(trace,sort_keys=True).encode()).hexdigest()
            if digest in digests:raise ValueError('Repeated trace is not an independent session')
            digests.add(digest)
            trace_by_time={row['timestampMs']:row for row in trace}
            windows=[json.loads(line) for line in (capture/'windows.jsonl').read_text().splitlines() if line.strip()]
            last=-1;session_previous={};ids=[]
            for i,row in enumerate(windows):
                time=row['timestampMs']
                if not isinstance(time,(int,float)) or not math.isfinite(time) or time<last:raise ValueError('Invalid source clock')
                last=time;oid=f'{sid}:{i}';ids.append(oid)
                cameras={};hashes={}
                name=Path(row['frame']).name
                for camera,directory in [('front','frames'),('left','left'),('right','right')]:
                    source=capture/directory/name
                    payload=source.read_bytes();sha=hashlib.sha256(payload).hexdigest()
                    relative=Path('media')/(sha+source.suffix.lower());target=output/relative
                    target.parent.mkdir(exist_ok=True)
                    if not target.exists():shutil.copyfile(source,target)
                    cameras[camera]=relative.as_posix();hashes[camera]=sha
                # Public file contains NO scene, pose, room, object, split, intervention or expected answer.
                observations.append({'id':oid,'sessionId':sid,'atMs':clock+time,'sourceAtMs':time,'cameras':cameras,'sha256':hashes})
                gt=trace_by_time.get(time)
                if gt is None:raise ValueError('No synchronous collector truth at sample timestamp')
                room=gt.get('collectorRegionIndex')
                truth.append({'id':oid,'buildingId':bid,'split':building['split'],'role':role,'roomId':room,'position':gt.get('position'),'labelStatus':'provisional-collector-polygon','cameraYawDegrees':{'front':0,'left':-90,'right':90}})
                if room is not None:
                    if room in previous:
                        tasks.append({'id':f'revisit:{oid}','kind':'identity-retrieval','currentId':oid,'asOfMs':clock+time-0.001,'expectedEvidenceIds':previous[room], 'buildingId':bid,'split':building['split']})
                    session_previous.setdefault(room,[]).append(oid)
            previous.update({room:previous.get(room,[])+values for room,values in session_previous.items()})
            clock+=last+1000
            reports.append({'buildingId':bid,'sessionId':sid,'role':role,'capture':str(capture),'source':manifest.get('source'),'license':manifest['license'],'revision':manifest.get('revision'),'traceSha256':digest,'observations':len(ids),'routeCompleted':manifest.get('completedRoute',False),'interventionManifest':session.get('intervention_manifest')})
        reports.append({'buildingId':bid,'missingRoles':sorted(set(ROLES)-set(roles))})
    (output/'observations.jsonl').write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in observations),encoding='utf8')
    evaluation=output/'evaluation-only';evaluation.mkdir()
    (evaluation/'truth.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in truth))
    (evaluation/'tasks.json').write_text(json.dumps(tasks,indent=2))
    report={'protocol':'long-term-spatial-dataset-v1','buildings':len(seen_buildings),'observations':len(observations),'tasks':len(tasks),'sessions':reports,'limitations':['GT provisional collector labels, not independent human labels','Missing roles remain missing; no synthetic new route','Static captures do not validate object change','Agent server reads only observations.jsonl and media']}
    (output/'dataset-report.json').write_text(json.dumps(report,indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('spec');parser.add_argument('output');parser.add_argument('--building');args=parser.parse_args()
    print(json.dumps(build(args.spec,args.output,args.building),indent=2))
