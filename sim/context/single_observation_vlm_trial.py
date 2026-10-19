"""No pre-grouping versus two-observation units: home + HSSD, full equal evidence."""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from sim.hssd.download_hssd import SCENES
from sim.grouping.fixed_region_queries import score_queries
from sim.hssd.hssd_chunking_trial import partition,prepare
from sim.hssd.label_score_hssd_regions import score


def usage(inference):
    responses=[json.loads(p.read_text(encoding='utf8')) for p in sorted(inference.glob('attempt-*-response.json'))]
    rows=[r.get('usage') or {} for r in responses]
    failed=int((inference/'execution-failure.json').exists())
    return {'requests':len(responses)+failed,'responsesReceived':len(responses),'executionFailures':failed,'promptTokens':sum(r.get('prompt_tokens',0) or 0 for r in rows),'completionTokens':sum(r.get('completion_tokens',0) or 0 for r in rows),'totalTokens':sum(r.get('total_tokens',0) or 0 for r in rows),'usagePresentInAllResponses':bool(rows) and all(bool(r) for r in rows),'note':'API reported tokens including repairs; failed-call billing unknown, pricing unverified, no currency estimate. Image count alone is not billing.'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--resume',type=Path);args=parser.parse_args()
    root=args.resume or Path(f'run/single-observation-vlm-{time.time_ns()}');root.mkdir(exist_ok=bool(args.resume))
    cases=[('home-val4',Path('run/sim/region-val4-multiview'),'4'),('home-val5',Path('run/sim/multiview-val5-clean-20261007'),'5')]
    for scene in SCENES:
        captures=sorted(p.parent for p in (Path('run/hssd-six-v1')/scene).glob('attempt-*/capture/manifest.json'))
        cases.append(('hssd-'+scene,captures[-1] if captures else None,None))
    summary={'protocol':'single-observation-full-scene-aggregation-v1','status':'running','arms':['single-observation','time-2'],'plannedHomeScenes':2,'plannedHssdScenes':6,'cases':{},'scope':'No visual pre-grouping; one independent observation per unit versus fixed two. Same frozen test.5 aggregation prompt, all original query triples shown. Offline full-scene inference, not online latency certification.'}
    def save():(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(root,flush=True);save()
    for name,capture,home in cases:
        if capture is None:summary['cases'][name]={'status':'capture-failed','inferencePerformed':False};save();continue
        windows=[json.loads(s) for s in (capture/'windows.jsonl').read_text().splitlines()];ids=[f'observation-{i+1}' for i in range(len(windows))]
        row={'status':'running','observations':len(ids),'arms':{}};summary['cases'][name]=row;save()
        reference_hashes=None
        for arm,size in [('single-observation',1),('time-2',2)]:
            work=root/name/arm;work.mkdir(parents=True,exist_ok=bool(args.resume));result={'status':'running'};row['arms'][arm]=result;save()
            inference=None
            try:
                chunks=partition(ids,size);atlases=work/'atlases'
                manifest=prepare(capture,atlases,chunks,1000 if home else None) if not (atlases/'input-manifest.json').exists() else json.loads((atlases/'input-manifest.json').read_text(encoding='utf8'))
                hashes={oid:h for g in manifest['groups'].values() for oid,h in g['sourceImageHashes'].items()}
                if set(hashes)!=set(ids):raise ValueError('Inventory mismatch')
                if reference_hashes is not None and hashes!=reference_hashes:raise ValueError('Arms have different original images')
                reference_hashes=hashes
                result.update(units=len(chunks),originalImages=len(ids),sourceHashesSha256=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest(),atlasBytes=sum(p.stat().st_size for p in atlases.glob('G*.jpg')))
                existing=sorted(work.glob('inference*/report.json'))
                if existing:inference=existing[0].parent
                else:
                    inference=work/'inference'
                    if inference.exists():inference=work/f'inference-retry-{time.time_ns()}'
                    with (work/f'inference-{time.time_ns()}.log').open('w',encoding='utf8') as log:
                        subprocess.run([sys.executable,'-m','sim','vlm_group_identity_annotations_trial',str(atlases),str(atlases/'replay.json'),'unused','unused',str(inference),'--unscored'],stdout=log,stderr=subprocess.STDOUT,check=True)
                report=json.loads((inference/'report.json').read_text(encoding='utf8'))
                result.update(status='completed',inferenceDirectory=str(inference),elapsedMs=report['elapsedMs'],protocolAttempts=report['attempts'],regionCount=len(report['answer']['regions']),budget=usage(inference))
                if home:
                    contract_path=Path('docs/experiments')/('fixed-region-queries-open-living-val4-v1.json' if home=='4' else 'fixed-region-queries-val5-v1.json')
                    contract=json.loads(contract_path.read_text(encoding='utf8'))
                    snapshots=json.loads((Path('run/frozen-grouping-confirmation')/('val'+home)/'replay.json').read_text(encoding='utf8'))['online']['snapshots']
                    result['homeFixedQueryScore']=score_queries(contract,[*snapshots[:-1],{**snapshots[-1],'assignments':report['finalAssignments']}])
                    # Region IDs use the user's open-living contract; boundary suggestions remain AI assistance.
                    reviews=json.loads((Path('run/review-site')/('val'+home)/'data.json').read_text(encoding='utf8'))['samples'];labels=[]
                    for sample in reviews:
                        oid=sample['id'];label=contract['labels'].get(oid);suggestion=sample.get('aiReview') or {}
                        kind='core' if label is not None else ('boundary' if suggestion.get('kind')=='boundary' else 'unknown')
                        labels.append({'observationId':oid,'kind':kind,'regionIds':[label] if kind=='core' else []})
                    result['referenceAgreement']=score(labels,report,manifest)
                else:
                    scene=name.removeprefix('hssd-');labels=json.loads((Path('run/hssd-region-labels-v1')/scene/'labels.json').read_text(encoding='utf8'))['labels']
                    result['referenceAgreement']=score(labels,report,manifest)
            except Exception as error:
                result.update(status='failed',exceptionType=type(error).__name__)
                if inference is not None and inference.exists():result['budget']=usage(inference)
            save();print(json.dumps({'case':name,'arm':arm,**result}),flush=True)
        row['status']='finished';save()
    summary['status']='finished';save();print(root/'summary.json',flush=True)


if __name__=='__main__':main()
