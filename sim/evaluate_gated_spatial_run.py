"""Audit all source observations, including skipped/unclassified frames and failed calls."""
import argparse
import json
import sqlite3
from pathlib import Path

def evaluate(source,gated,run,output):
    rows=[json.loads(l) for l in (source/'observations.jsonl').read_text().splitlines()]
    gate=json.loads((gated/'gate-plan.json').read_text());trace={r['id']:r for r in map(json.loads,(gated/'gate-trace.jsonl').read_text().splitlines())}
    with sqlite3.connect('file:'+str((run/'topology.sqlite').resolve()).replace('\\','/')+'?mode=ro',uri=True) as db:
        assignments={r[0]:{'placeId':r[1],'reason':r[2]} for r in db.execute('SELECT observation_id,place_id,reason FROM assignments')}
        places=[{'id':r[0],'summary':r[1],'status':r[2]} for r in db.execute('SELECT id,summary,status FROM places ORDER BY last_seen_ms')]
        pending=db.execute('SELECT COUNT(*) FROM observations WHERE pending=1').fetchone()[0]
    observations=[{'id':r['id'],'atMs':r['atMs'],'sourceFrameIndex':r['sourceFrameIndex'],'gate':trace[r['id']],'assignment':assignments.get(r['id'])} for r in rows]
    by_frame={r['sourceFrameIndex']:r for r in observations};proxy=[]
    for pair in json.loads((source/'evaluation-only'/'coverage.json').read_text())['geometricRevisitPairs']:
        a,b=by_frame[pair['earlierFrame']]['assignment'],by_frame[pair['laterFrame']]['assignment']
        proxy.append({**pair,'bothAssigned':a is not None and b is not None,'sameAssignedPlace':bool(a and b and a['placeId'] is not None and a['placeId']==b['placeId']) if a and b else None})
    costs=[]
    for root in run.parent.glob('tartanground-school-gated-real-*'):
        usage=root/'usage.json'
        if usage.exists():costs.append({'run':root.name,**json.loads(usage.read_text())})
    report={'run':str(run),'sourceObservations':len(rows),'acceptedObservations':gate['acceptedObservations'],'skippedUnclassifiedObservations':gate['skippedObservations'],'classifiedObservations':len(assignments),'pending':pending,'plannedWindows':gate['plannedCalls'],'places':places,'geometricProxyChecks':proxy,'observations':observations,'allRelatedRunUsage':costs,'roomAccuracyMeasured':False,'gateEventRecallMeasured':False,'realtimeThroughputMeasured':False,'limitations':'Proxy pairs overlap and are not independent test cases. No assignment inheritance for skipped frames. Raw model summaries are not human room truth. First failed run costs included separately, not hidden.'}
    with output.open('x',encoding='utf8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in ['observations','places','allRelatedRunUsage','geometricProxyChecks']},indent=2));print('proxy covered/matched',sum(p['bothAssigned'] for p in proxy),sum(p['sameAssignedPlace'] is True for p in proxy));print(json.dumps(costs,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('gated',type=Path);p.add_argument('run',type=Path);p.add_argument('output',type=Path);a=p.parse_args();evaluate(a.source,a.gated,a.run,a.output)
