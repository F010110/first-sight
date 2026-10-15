"""Evidence retrieval evaluation; never call path retrieval 'navigation success'."""
import argparse
import json
import math
from pathlib import Path


def evaluate(dataset,predictions,k=6):
    if not isinstance(k,int) or not 1<=k<=24:raise ValueError('Invalid K')
    dataset=Path(dataset)
    tasks=json.loads((dataset/'evaluation-only/tasks.json').read_text())
    truth={row['id']:row for row in map(json.loads,(dataset/'evaluation-only/truth.jsonl').read_text().splitlines())}
    public={row['id']:row for row in map(json.loads,(dataset/'observations.jsonl').read_text().splitlines())}
    task_map={task['id']:task for task in tasks}
    seen=set();hits=0;invalid=0;latencies=[];calls=0;tokens=0
    for prediction in predictions:
        tid=prediction['taskId']
        if tid in seen or tid not in task_map:raise ValueError('Unknown/duplicate task prediction')
        seen.add(tid);task=task_map[tid]
        ids=prediction.get('retrievedIds',[])[:k]
        allowed=all(oid in public and public[oid]['atMs']<=task['asOfMs'] and truth[oid]['buildingId']==task['buildingId'] for oid in ids)
        if not allowed:invalid+=1
        elif set(ids)&set(task['expectedEvidenceIds']):hits+=1
        for field in ['latencyMs','calls','tokens']:
            if not isinstance(prediction.get(field,0),(int,float)) or not math.isfinite(prediction.get(field,0)) or prediction.get(field,0)<0:raise ValueError('Invalid cost')
        latencies.append(prediction.get('latencyMs',0));calls+=prediction.get('calls',0);tokens+=prediction.get('tokens',0)
    return {'taskCount':len(tasks),'attempted':len(seen),'coverage':len(seen)/len(tasks) if tasks else None,'recallAtK':hits/len(tasks) if tasks else None,'k':k,'invalidScopePredictions':invalid,'calls':calls,'tokens':tokens,'meanLatencyMs':sum(latencies)/len(latencies) if latencies else None,'notMeasured':['navigation success','visual answer correctness','object change accuracy','stale memory use'],'labelStatus':'provisional collector polygons; do not compare boundary disagreements as definitive semantic error'}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset');p.add_argument('predictions');p.add_argument('--k',type=int,default=6);a=p.parse_args()
    print(json.dumps(evaluate(a.dataset,json.loads(Path(a.predictions).read_text()),a.k),indent=2))
