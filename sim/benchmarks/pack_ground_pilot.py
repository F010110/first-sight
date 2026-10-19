"""Fixed-time pilot packaging. Pose stays evaluation-only, no fabricated sessions."""
import argparse
import hashlib
import json
import math
import zipfile
from pathlib import Path

def pack(source,output,session,interval):
    if interval<=0:raise ValueError('Positive interval required')
    output.mkdir(parents=True,exist_ok=False);private=output/'evaluation-only';private.mkdir()
    with zipfile.ZipFile(source/'metadata.zip') as meta:
        metadata=json.loads(meta.read(session+'_metadata.json'))
        poses=[[float(x) for x in line.split()] for line in meta.read('pose_lcam_front.txt').decode().splitlines() if line.strip()]
        (private/'metadata.source.json').write_text(json.dumps(metadata,indent=2))
    dt=metadata['time_step'];stride=max(1,round(interval/dt));indices=list(range(0,len(poses),stride))
    if indices[-1]!=len(poses)-1:indices.append(len(poses)-1)
    observations=[];truth=[];archives={v:zipfile.ZipFile(source/f'image_lcam_{v}.zip') for v in ['front','left','right']}
    try:
        maps={v:{int(Path(n).name.split('_')[0]):n for n in z.namelist() if n.endswith('.png')} for v,z in archives.items()}
        for index in indices:
            oid=f'{source.parents[1].name}-{session}-{index:06d}';cameras={};hashes={}
            for view,z in archives.items():
                image=z.read(maps[view][index]);path=Path('images')/(oid+'-'+view+'.png');(output/path).parent.mkdir(exist_ok=True);(output/path).write_bytes(image);cameras[view]=path.as_posix();hashes[view]=hashlib.sha256(image).hexdigest()
            observations.append({'id':oid,'sessionId':source.parents[1].name+'-'+session,'atMs':round(index*dt*1000),'sourceFrameIndex':index,'cameras':cameras,'sha256':hashes})
            truth.append({'observationId':oid,'poseXYZQuaternion':poses[index],'coordinateConvention':'source TartanGround; not converted to THOR','roomId':None})
    finally:
        for z in archives.values():z.close()
    (output/'observations.jsonl').write_text('\n'.join(json.dumps(o) for o in observations)+'\n')
    (private/'poses.jsonl').write_text('\n'.join(json.dumps(o) for o in truth)+'\n')
    pairs=[]
    for j,index in enumerate(indices):
        for old in indices[:j]:
            gap=(index-old)*dt;distance=math.dist(poses[index][:3],poses[old][:3])
            if gap>=60 and distance<=2:pairs.append({'earlierFrame':old,'laterFrame':index,'distanceM':distance,'timeGapSeconds':gap})
    report={'source':str(source),'observations':len(observations),'sourceFrames':len(poses),'sourceDurationSeconds':(len(poses)-1)*dt,'sourcePathLengthM':metadata.get('path_length'),'samplingSeconds':interval,'independentSessions':1,'geometricRevisitPairs':pairs,'limitations':'Distance-only pairs are evaluator diagnostics, not room truth or visually confirmed revisits. Not an eight-hour recording. Source timestep supplies relative time; no fabricated wall-clock dates.'}
    (private/'coverage.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--session',default='P0000');p.add_argument('--interval',type=float,default=2);a=p.parse_args();pack(a.source,a.output,a.session,a.interval)
