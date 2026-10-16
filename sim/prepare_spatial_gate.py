"""Causal RGB novelty gate, independent of GT/model assignments. Preserve source dataset."""
import argparse
import json
import os
from pathlib import Path
from spatial_visual_features import descriptor
from evaluate_visual_recall_pilot import distance

def prepare(source,output,threshold=0.008,heartbeat=30000):
    output.mkdir(parents=True,exist_ok=False)
    rows=[json.loads(l) for l in (source/'observations.jsonl').read_text().splitlines()]
    accepted=[];trace=[];pending=[];last=None;last_at=None;windows=[]
    for row in rows:
        features=[descriptor(str(source/row['cameras'][v])) for v in ['front','left','right']]
        score=distance(features,last) if last is not None else None
        reason='first' if last is None else 'novelty' if score>=threshold else 'heartbeat' if row['atMs']-last_at>=heartbeat else 'skip-low-novelty'
        keep=reason!='skip-low-novelty'
        trace.append({'id':row['id'],'atMs':row['atMs'],'score':score,'keep':keep,'reason':reason})
        if keep:
            last=features;last_at=row['atMs'];copy={**row,'cameras':{k:Path(os.path.relpath(source/v,output)).as_posix() for k,v in row['cameras'].items()}};accepted.append(copy);pending.append(copy)
        if pending and (len(pending)>=4 or row['atMs']-pending[0]['atMs']>=10000):
            pending[-1]['flushAfter']=True;pending[-1]['closedAtMs']=row['atMs'];windows.append([p['id'] for p in pending]);pending=[]
    if pending:pending[-1]['flushAfter']=True;pending[-1]['closedAtMs']=rows[-1]['atMs'];windows.append([p['id'] for p in pending])
    (output/'observations.jsonl').write_text('\n'.join(json.dumps(r) for r in accepted)+'\n')
    (output/'gate-trace.jsonl').write_text('\n'.join(json.dumps(r) for r in trace)+'\n')
    report={'source':str(source),'inputObservations':len(rows),'acceptedObservations':len(accepted),'skippedObservations':len(rows)-len(accepted),'windows':windows,'plannedCalls':len(windows),'maximumProviderCallsWithRepairs':len(windows)*2,'threshold':threshold,'heartbeatMs':heartbeat,'maximumWindowObservations':4,'maximumWindowWaitMs':10000,'limitations':'Coarse RGB novelty, not metric movement or reliable dynamic-object/occlusion detection. Skipped frames remain in source, no identity assigned to them. Offline causal replay, not real-time throughput proof.'}
    (output/'gate-plan.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='windows'},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();prepare(a.source,a.output)
