"""Four-arm HSSD chunking ablation; full equal image inventory, frozen VLM prompt."""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from sim.hssd.download_hssd import SCENES
from sim.hssd.label_score_hssd_regions import score


def partition(ids,size,visual_groups=None):
    order={oid:i for i,oid in enumerate(ids)}
    source=[ids] if visual_groups is None else sorted([g['observationIds'] for g in visual_groups],key=lambda g:order[g[0]])
    flattened=[oid for group in source for oid in group]
    if flattened!=ids:raise ValueError('Visual groups must be exhaustive ordered contiguous membership')
    return [group[start:start+size] for group in source for start in range(0,len(group),size)]


def prepare(capture,out,chunks,legacy_tick_ms=None):
    import cv2
    import numpy as np
    windows=[json.loads(s) for s in (capture/'windows.jsonl').read_text().splitlines()]
    out.mkdir();groups={};assignments={}
    for index,chunk in enumerate(chunks):
        gid=f'G{index+1:02d}';panels=[];hashes={}
        for oid in chunk:
            w=windows[int(oid.split('-')[1])-1];path=capture/'triple'/Path(w['frame']).name;raw=path.read_bytes();hashes[oid]=hashlib.sha256(raw).hexdigest()
            image=cv2.imdecode(np.frombuffer(raw,dtype=np.uint8),cv2.IMREAD_COLOR)
            if image is None:raise ValueError('Unreadable original image')
            heading=np.full((32,image.shape[1],3),255,dtype=np.uint8)
            cv2.putText(heading,gid+':'+oid+'  L / F / R',(10,22),cv2.FONT_HERSHEY_SIMPLEX,.55,(0,0,0),1,cv2.LINE_AA)
            panels.extend([heading,image]);assignments[oid]=gid
        atlas=out/f'{gid}.jpg';ok,encoded=cv2.imencode('.jpg',np.concatenate(panels),[cv2.IMWRITE_JPEG_QUALITY,95])
        if not ok:raise ValueError('Atlas encoding failed')
        atlas.write_bytes(encoded.tobytes())
        groups[gid]={'sourceGroupId':gid,'observationIds':chunk,'selectedObservationIds':chunk,'sourceImageHashes':hashes,'atlasSha256':hashlib.sha256(atlas.read_bytes()).hexdigest()}
    manifest={'protocol':'hssd-full-inventory-chunks-v1','groups':groups,'allOriginalObservationsShown':True,'note':'Full original triples pasted without resizing or enhancement; equal original image inventory across arms, grouping/layout differ.'}
    (out/'input-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    at_ms=windows[-1].get('timestampMs')
    if at_ms is None:
        if legacy_tick_ms is None:raise ValueError('Original timestamps missing; require explicit legacy cadence')
        at_ms=windows[-1]['endTick']*legacy_tick_ms
    replay={'online':{'snapshots':[{'atMs':at_ms,'assignments':assignments}]},'grouping':{'groups':[{'id':g,'observationIds':v['observationIds']} for g,v in groups.items()]}}
    (out/'replay.json').write_text(json.dumps(replay,indent=2),encoding='utf8')
    return manifest


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--resume',type=Path);parser.add_argument('--prepare-only',action='store_true');args=parser.parse_args()
    root=args.resume or Path(f'run/hssd-chunking-trial-{time.time_ns()}');root.mkdir(exist_ok=bool(args.resume))
    reference=Path('run/grouping-only-ablation-1791885214408319400')
    summary={'protocol':'hssd-full-evidence-chunking-ablation-v1','status':'running','plannedScenes':6,'cases':{},'arms':['time-2','time-4','time-6','visual-cap-4'],'prompt':'Frozen test.5 v3.1; unchanged across arms','scope':'HSSD only, full original observation inventory in every arm; strict AI-label agreement not accepted physical accuracy.'}
    def save():(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(root,flush=True);save()
    for scene in SCENES:
        captures=sorted(p.parent for p in (Path('run/hssd-six-v1')/scene).glob('attempt-*/capture/manifest.json'))
        if not captures:summary['cases'][scene]={'status':'capture-failed','inferencePerformed':False};save();continue
        capture=captures[-1];windows=[json.loads(s) for s in (capture/'windows.jsonl').read_text().splitlines()];ids=[f'observation-{i+1}' for i in range(len(windows))]
        visual=json.loads((reference/('hssd-'+scene)/'native-unconditional-first-pair/replay.json').read_text(encoding='utf8'))['grouping']['groups']
        row={'status':'running','observations':len(ids),'arms':{}};summary['cases'][scene]=row;save()
        for arm,size in [('time-2',2),('time-4',4),('time-6',6),('visual-cap-4',4)]:
            work=root/scene/arm;work.mkdir(parents=True,exist_ok=bool(args.resume));result={'status':'running'};row['arms'][arm]=result;save()
            try:
                chunks=partition(ids,size,visual if arm=='visual-cap-4' else None)
                manifest=prepare(capture,work/'atlases',chunks) if not (work/'atlases/input-manifest.json').exists() else json.loads((work/'atlases/input-manifest.json').read_text(encoding='utf8'))
                if [oid for g in manifest['groups'].values() for oid in g['observationIds']]!=ids:raise ValueError('Inventory mismatch')
                result['localUnits']=len(chunks);result['maxObservationsPerUnit']=max(map(len,chunks))
                if args.prepare_only:result['status']='prepared';save();continue
                inference=work/'inference'
                if not (inference/'report.json').exists():
                    if inference.exists():inference=work/f'inference-retry-{time.time_ns()}'
                    with (work/f'inference-{time.time_ns()}.log').open('w',encoding='utf8') as log:
                        subprocess.run([sys.executable,'-m','sim','vlm_group_identity_annotations_trial',str(work/'atlases'),str(work/'atlases/replay.json'),'unused','unused',str(inference),'--unscored'],stdout=log,stderr=subprocess.STDOUT,check=True)
                report=json.loads((inference/'report.json').read_text(encoding='utf8'))
                # Existing AI labels loaded strictly after predictions, never in prompts.
                labels=json.loads((Path('run/hssd-region-labels-v1')/scene/'labels.json').read_text(encoding='utf8'))['labels']
                result.update(status='completed',inferenceDirectory=str(inference),elapsedMs=report['elapsedMs'],protocolAttempts=report['attempts'],regionCount=len(report['answer']['regions']),agreement=score(labels,report,manifest))
            except Exception as error:result.update(status='failed',exceptionType=type(error).__name__)
            save();print(json.dumps({'scene':scene,'arm':arm,**result}),flush=True)
        row['status']='finished';save()
    summary['status']='prepared' if args.prepare_only else 'finished';save();print(root/'summary.json',flush=True)


if __name__=='__main__':main()
