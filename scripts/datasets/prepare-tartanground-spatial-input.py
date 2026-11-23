"""Prepare original-clock, images-only input for the existing fixed method2; no model calls."""
import argparse
import hashlib
import json
from pathlib import Path

def prepare(archive, output, interval_ms=2000):
    if interval_ms < 100 or interval_ms % 100:
        raise ValueError('Interval must follow the source 100ms clock')
    public=(archive/'public').resolve()
    manifest=json.loads((public/'manifest.json').read_text(encoding='utf8'))
    if manifest.get('source')!='TartanGround' or manifest.get('schema')!='three-view-render-input-v1':
        raise ValueError('Expected a completed TartanGround original replay')
    rows=[json.loads(line) for line in (public/'observations.jsonl').read_text().splitlines() if line.strip()]
    if len(rows)!=manifest['observations'] or len(rows)<2:
        raise ValueError('Incomplete replay')
    if any(row['sourceAtMs']!=i*100 for i,row in enumerate(rows)):
        raise ValueError('Unexpected original clock; never repair or stretch it')
    selected=list(range(0,len(rows),interval_ms//100))
    if selected[-1]!=len(rows)-1:selected.append(len(rows)-1)
    observations=[]
    for i in selected:
        row=rows[i];views=[]
        if [v['view'] for v in row['frames']]!=['front','left','right']:
            raise ValueError('Unexpected views')
        for view in row['frames']:
            path=(public/view['path']).resolve()
            if not path.is_relative_to(public/'frames'):
                raise ValueError('Image escapes public originals')
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            if digest!=view['sha256']:raise ValueError('Original changed')
            views.append({'direction':view['view'],'path':str(path),'sha256':digest})
        observations.append({'id':f'observation-{i:06d}','scene':'scene-01','atMs':row['sourceAtMs'],'views':views})
    output.mkdir(parents=True,exist_ok=False)
    target=output/'public.json'
    target.write_text(json.dumps({'schema':'spatial-public-input-v1','observations':observations},ensure_ascii=False,indent=2),encoding='utf8')
    plan={'schema':'tartanground-method2-preparation-v1','readyForPaidRun':False,'modelCalls':0,'paidRunStarted':False,
          'methodEntry':'scripts/evaluation/run-spatial-method2.mjs','algorithmChanged':False,
          'intervalMs':interval_ms,'sourceFrames':len(rows),'sampledObservations':len(observations),'images':3*len(observations),
          'sourceSpanMs':rows[-1]['sourceAtMs'],'sourceIndices':selected,'tailIncluded':True,
          'publicSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
          'sourceManifestSha256':hashlib.sha256((public/'manifest.json').read_bytes()).hexdigest(),
          'truthExcluded':['poses','map','regions','answers','future evidence','source scene names in model fields'],
          'estimatedCostCapUSD':0.5,'maxCalls':256,'evaluationTruthAvailable':False,
          'warning':'No accuracy claims without independent reviewed labels; budget/call limits can stop a run. This is a robot trajectory, not a visually-impaired walking experiment.'}
    (output/'preparation.json').write_text(json.dumps(plan,indent=2),encoding='utf8')
    return plan

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--interval-ms',type=int,default=2000)
    a=p.parse_args();print(json.dumps(prepare(a.archive,a.output,a.interval_ms)),flush=True)

if __name__=='__main__':main()
