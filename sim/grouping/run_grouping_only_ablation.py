"""No VLM/API calls. Same native frames, four anchor variants, fixed scoring labels."""
import json
import argparse
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path
from sim.hssd.download_hssd import SCENES


def metrics(groups,labels):
    known={k:v for k,v in labels.items() if v is not None}; assignment={oid:g['id'] for g in groups for oid in g['observationIds']}
    mixed=[];correct=0;same_total=same_kept=diff_total=diff_split=0
    for group in groups:
        dist=Counter(known[oid] for oid in group['observationIds'] if oid in known)
        correct+=max(dist.values(),default=0)
        if len(dist)>1:mixed.append({'id':group['id'],'observationIds':group['observationIds'],'labelCounts':dict(dist)})
    ids=list(known)
    for i,a in enumerate(ids):
        for b in ids[i+1:]:
            joined=assignment[a]==assignment[b]
            if known[a]==known[b]:same_total+=1;same_kept+=joined
            else:diff_total+=1;diff_split+=not joined
    return {'groups':len(groups),'labelledCore':len(known),'excludedUnlabelledOrBoundary':len(labels)-len(known),'mixedGroups':len(mixed),'mixedGroupDetails':mixed,'coreMajorityPurity':correct/len(known) if known else None,'differentRegionPairSeparation':diff_split/diff_total if diff_total else None,'sameRegionPairRetention':same_kept/same_total if same_total else None,'note':'Purity can be gamed by singletons; retention includes legitimate multi-episode splits, not an acceptance score. Read together, not alone.'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--multi-context',action='store_true');args=parser.parse_args()
    prefix='multi-context-only' if args.multi_context else 'grouping-only-ablation'
    root=Path(f'run/{prefix}-{time.time_ns()}');root.mkdir(parents=True)
    summary={'protocol':'grouping-only-anchor-ablation-v1','vlmCalls':0,'plannedHssdScenes':6,'cases':{},'status':'running','nativeDetectionFps':'THOR 1, HSSD 2','scope':'Native evidence variants use identical legacy sparse controller/historical association; isolates native anchoring. Separate sparse-only variants isolate observation-level policy.'}
    cases=[]
    for n,d in [('4','region-val4-multiview'),('5','multiview-val5-clean-20261007')]:
        cases.append((f'home-val{n}',Path('run/sim')/d,Path('run/sim')/d,Path(f'run/sim/visual-functional-v2-val{n}/vo.json'),1000,Path('docs/experiments')/('fixed-region-queries-open-living-val4-v1.json' if n=='4' else 'fixed-region-queries-val5-v1.json')))
    for s in SCENES:
        captures=sorted(p.parent for p in (Path('run/hssd-six-v1')/s).glob('attempt-*/capture/manifest.json'))
        if captures:
            c=captures[-1];cases.append(('hssd-'+s,c,c.parent/'pipeline/baseline',c.parent/'pipeline/vo.json',500,Path('run/hssd-region-labels-v1')/s/'labels.json'))
        else:summary['cases']['hssd-'+s]={'status':'capture-failed'}
    def save():(root/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
    def run(command,log):
        with log.open('w',encoding='utf8') as output:subprocess.run(command,stdout=output,stderr=subprocess.STDOUT,check=True)
    save();print(str(root),flush=True)
    for name,dataset,baseline,vo,tick,label_path in cases:
        out=root/name;out.mkdir();row={'status':'running','stage':'sparse-only','results':{}};summary['cases'][name]=row;save()
        try:
            def replay(variant,dense,policy):
                target=out/variant
                run(['node','dist/current/sim/replay/hssd-memory-replay.js',str(dataset),str(baseline),str(vo),str(target),'-',str(dense) if dense else '-',str(tick),policy],out/(variant+'.log'))
                result=json.loads((target/'replay.json').read_text(encoding='utf8'))
                # Labels read AFTER inference; never provided to memory.
                label_data=json.loads(label_path.read_text(encoding='utf8'))
                labels=label_data['labels'] if name.startswith('home') else {r['observationId']:r['regionIds'][0] if r['kind']=='core' else None for r in label_data['labels']}
                scored=metrics(result['grouping']['groups'],labels);scored['restartPassed']=result['restartRoundtripPassed'];scored['labelsStatus']='development-reviewed-subset' if name.startswith('home') else 'provisional-same-model-AI-labels'
                row['results'][variant]=scored;save();print(json.dumps({'case':name,'variant':variant,**{k:v for k,v in scored.items() if k!='mixedGroupDetails'}}),flush=True)
            if not args.multi_context:
                for policy in ['legacy-first-pair','recover-weak-anchors','updating-context-v2']:replay('sparse-'+policy,None,policy)
            row['stage']='native-evidence';save()
            command=[sys.executable,'-m','sim','dense_context_evidence',str(dataset),str(out/'native-variants.json'),'--tick-ms',str(tick)]
            command+=['--policy','multi-context-v1'] if args.multi_context else ['--all-policies']
            run(command,out/'native.log')
            bundle=json.loads((out/'native-variants.json').read_text(encoding='utf8'))
            if args.multi_context:
                bundle['variants']={'multi-context-v1':{k:v for k,v in bundle.items() if k not in ['variants','pairEvidenceCache']}}
            for policy,evidence in bundle['variants'].items():
                path=out/(policy+'-native.json');path.write_text(json.dumps(evidence),encoding='utf8')
                replay('native-'+policy,path,'legacy-first-pair')
                if args.multi_context:
                    counts=Counter(d['kind'] for d in evidence['diagnostics'])
                    row['results']['native-'+policy]['candidateDiagnosticCounts']=dict(counts)
            row['status']='completed';row['stage']='done'
        except Exception as error:row.update(status='failed',exceptionType=type(error).__name__,message=str(error))
        save()
    summary['status']='finished';save();print(str(root/'summary.json'),flush=True)


if __name__=='__main__':main()
