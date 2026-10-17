"""Materialize real unique RGB segments on an explicitly synthetic activity clock.
No frames/poses/room labels are fabricated; task annotations are a separate stage.
"""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path
from salad_features import sha

def build(source, output, auxiliary=None):
    if not (source/'complete.json').exists():raise ValueError('RGB source download must be complete')
    plan=json.loads((source/'plan.json').read_text());rows=[{**r,'sourceRoot':str(source)} for r in plan['trajectories']]
    if auxiliary:
        if not (auxiliary/'complete.json').exists():raise ValueError('Auxiliary download incomplete')
        aux=json.loads((auxiliary/'plan.json').read_text())
        if aux['revision']!=plan['revision']:raise ValueError('Auxiliary source revision mismatch')
        rows.extend({**r,'sourceRoot':str(auxiliary)} for r in aux['trajectories'])
    output.mkdir(parents=True,exist_ok=False)
    groups={'school-rounds':[r for r in rows if r['environment']=='AbandonedSchool'],'hospital-rounds':[r for r in rows if r['environment'] in ['Hospital','OldTownSummer']],'community-shopping':[r for r in rows if r['environment'] in ['ModularNeighborhoodIntExt','Supermarket']]};report=[]
    for sample_id,segments in groups.items():
        root=output/sample_id;private=root/'evaluation-only';private.mkdir(parents=True);(root/'images').mkdir()
        clock=8*3600000;observations=[];truth=[];episodes=[];seen=set();active=0
        public_session_id=hashlib.sha256(('session:'+sample_id).encode()).hexdigest()[:24]
        for segment_index,segment in enumerate(sorted(segments,key=lambda r:(r['environment']=='Supermarket',r['environment'],r['trajectory']))):
            source_root=Path(segment['sourceRoot']);source_dir=source_root/Path(segment['metadataPath']).parent
            if sha(source_dir/'metadata.zip')!=segment['metadataSha256']:raise ValueError('Metadata binding mismatch')
            with zipfile.ZipFile(source_dir/'metadata.zip') as meta:
                metadata=json.loads(meta.read(segment['trajectory']+'_metadata.json'))
                poses=[[float(v) for v in l.split()] for l in meta.read('pose_lcam_front.txt').decode().splitlines() if l.strip()]
            if not 0<segment['timeStep']<=2 or len(poses)!=segment['frames'] or metadata['time_step']!=segment['timeStep'] or abs((len(poses)-1)*segment['timeStep']-segment['durationSeconds'])>1e-6:raise ValueError('Source clock/frame count mismatch; no duration inflation allowed')
            for verified in json.loads((source_dir/'verified.json').read_text()):
                path=source_root/verified['path']
                if path.stat().st_size!=verified['bytes'] or sha(path)!=verified['sha256']:raise ValueError('RGB archive integrity mismatch')
            dt=segment['timeStep'];indices=list(range(0,len(poses),max(1,round(2/dt))))
            if indices[-1]!=len(poses)-1:indices.append(len(poses)-1)
            archives={v:zipfile.ZipFile(source_dir/f'image_lcam_{v}.zip') for v in ['front','left','right']}
            try:
                maps={v:{int(Path(n).name.split('_')[0]):n for n in z.namelist() if n.endswith('.png')} for v,z in archives.items()}
                episode_id=hashlib.sha256((sample_id+':'+str(segment_index)).encode()).hexdigest()[:16]
                for index in indices:
                    uid=f"{plan['revision']}/{segment['environment']}/{segment['trajectory']}/{index}"
                    if uid in seen:raise ValueError('Repeated source frame cannot inflate active duration')
                    seen.add(uid);oid=hashlib.sha256(uid.encode()).hexdigest()[:24];cameras={};hashes={}
                    for view,z in archives.items():
                        raw=z.read(maps[view][index]);path=Path('images')/(oid+'-'+view+'.png');(root/path).write_bytes(raw);cameras[view]=path.as_posix();hashes[view]=hashlib.sha256(raw).hexdigest()
                    observations.append({'id':oid,'sessionId':public_session_id,'episodeId':episode_id,'atMs':clock+round(index*dt*1000),'sourceAtMs':round(index*dt*1000),'cameras':cameras,'sha256':hashes})
                    truth.append({'observationId':oid,'worldInstanceId':segment['environment'],'sourceFrameUid':uid,'sourceFrameIndex':index,'sourcePose':poses[index],'placeId':None,'annotationStatus':'unannotated'})
            finally:
                for z in archives.values():z.close()
            duration=round(segment['durationSeconds']*1000);active+=duration
            gap=0 if segment_index==0 else 20*60000
            episodes.append({'id':episode_id,'startMs':clock,'endMs':clock+duration,'unobservedGapBeforeMs':gap,'worldInstanceId':segment['environment'],'sourceTrajectory':segment['trajectory'],'activity':'simulated facility walking round' if sample_id!='community-shopping' else 'simulated neighborhood walk / shop visit','continuity':'first episode' if segment_index==0 else 'camera off; relocation unobserved; no path asserted'})
            clock+=duration+20*60000
        if active<1200000:raise ValueError('Complete activity sample needs >=20 actual visual minutes')
        (root/'observations.jsonl').write_text('\n'.join(map(json.dumps,observations))+'\n')
        (private/'source-truth.jsonl').write_text('\n'.join(map(json.dumps,truth))+'\n')
        (private/'episodes.json').write_text(json.dumps(episodes,indent=2))
        (private/'tasks.jsonl').write_text('')
        (root/'SOURCE-NOTICE.md').write_text('# Source and modifications\n\nTartanGround by Manthan Patel, Fan Yang, Yuheng Qiu, Cesar Cadena, Sebastian Scherer, Marco Hutter, and Wenshan Wang (2025).\n\nhttps://huggingface.co/datasets/theairlabcmu/TartanGround\n\nSource dataset card declares CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Pinned source revision: '+plan['revision']+'.\n\nModifications: selected native RGB views and approximately two-second observations; composed original unique source trajectories onto an explicitly synthetic intermittent activity clock. No source pixels edited. Source frame provenance is evaluation-only/source-truth.jsonl. This does not assert continuous transit between episodes or real human activity.\n',encoding='utf8')
        manifest={'sampleId':sample_id,'activeVisualSeconds':active/1000,'activitySpanSeconds':(episodes[-1]['endMs']-episodes[0]['startMs'])/1000,'episodes':len(episodes),'observations':len(observations),'images':3*len(observations),'clock':'synthetic activity schedule; source clock preserved separately','split':'development' if sample_id=='school-rounds' else 'heldout-environments','annotationStatus':'unannotated','indoorOutdoorVerified':False,'scoreEligible':False,'sourceRevision':plan['revision'],'note':'Full unique robot-camera source trajectories, composed as intermittent movement. Not actual human daily activity, not 2-3 hours active, no observed transit/changes claimed during camera-off gaps.'}
        (root/'complete.json').write_text(json.dumps(manifest,indent=2));report.append(manifest);print(json.dumps(manifest),flush=True)
    (output/'complete.json').write_text(json.dumps({'samples':report,'modelCalls':0},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--auxiliary',type=Path);a=p.parse_args();build(a.source,a.output,a.auxiliary)
