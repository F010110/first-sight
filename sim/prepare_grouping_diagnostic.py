"""Import existing reviewed necessary pairs, never coarse room membership.

This is diagnostic-only. Independent local-subregion acceptance labels remain
required. Historical reports are not presented as a release-to-release replay.
"""
import argparse,json,hashlib
from pathlib import Path
from grouping_benchmark import digest

def main():
    p=argparse.ArgumentParser();p.add_argument('dataset',choices=['val4','val5']);p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
    read=lambda p:json.loads(Path(p).read_text(encoding='utf8'))
    mini=next(d for d in read('docs/experiments/place-mini-benchmark-v1.json')['datasets'] if d['id']==a.dataset)
    report=read(f'docs/experiments/visual-repair-{a.dataset}-v1.json')
    snapshots=report['online']['snapshots'];observations=[];seen=set()
    source=Path('run/sim')/('region-val4-multiview' if a.dataset=='val4' else 'multiview-val5-clean-20261007')
    for s in snapshots:
        for id in s['assignments']:
            if id not in seen:
                seen.add(id);tick=int(s['atMs']/1000)
                frames=[str(source/view/f'{tick:04d}.jpg').replace('\\','/') for view in ['frames','left','right']]
                observations.append({'id':id,'atMs':s['atMs'],'frames':[{'path':f,'sha256':hashlib.sha256(Path(f).read_bytes()).hexdigest()} for f in frames]})
    framepaths=lambda id:[f['path'] for o in observations if o['id']==id for f in o['frames']]
    pairs=[]
    for relation,key in [('same','stability'),('different','separation')]:
        for i,row in enumerate(mini[key]):pairs.append({'id':f'{relation}-{i}','a':row['a'],'b':row['b'],'relation':relation,'reason':row['reason'],'frames':framepaths(row['a'])+framepaths(row['b'])})
    queries=[{'id':f'query-{i}','query':q['query'],'candidates':[q['target'],*q['forbidden']],'relevant':[q['target']],'frames':framepaths(q['query'])+framepaths(q['target'])} for i,q in enumerate(mini['lookup'])]
    bench={'protocol':'grouping-benchmark-v1','dataset':a.dataset,'granularity':'Necessary same-footprint / clearly different local context; unspecified pairs unscored; room does not require one group','review':{'independent':False,'heldOut':False,'source':'place-mini-v1 AI-reviewed development events'},'observations':observations,'pairs':pairs,'queries':queries,'policy':{'approved':False,'minSame':.8,'minDifferent':.95,'minRecognition':.8,'minCoverage':.8,'maxHarmfulChanges':0,'minPairsPerClass':20,'minQueries':20}}
    run={'protocol':'grouping-run-v1','benchmarkHash':digest(bench),'mode':'online','algorithmCommit':'da10721','evidenceBudget':'historical-cached-directional-evidence-prefix-endpoints-v1','provenance':'Imported executed diagnostic prefix report; not new release replay','snapshots':[{'observationId':o['id'],'atMs':s['atMs'],'assignments':s['assignments']} for o,s in zip(observations,snapshots)],'retrieval':{}}
    for q in queries:
        s=next(s for s in run['snapshots'] if s['observationId']==q['query']);node=s['assignments'][q['query']]
        run['retrieval'][q['id']]=[id for id in q['candidates'] if node is not None and s['assignments'][id]==node]
    for name,value in [('benchmark.json',bench),('imported-run.json',run),('algorithm-input.json',{'observations':observations})]:
        (a.output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
    print(f'Frozen diagnostic {a.dataset}; acceptance blocked explicitly')

if __name__=='__main__':main()
