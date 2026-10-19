"""Read-only token/latency and geometric-proxy checks; never claim room accuracy."""
import argparse
import json
import sqlite3
from pathlib import Path

def summarize(run,coverage,output):
    usage=json.loads((run/'usage.json').read_text());truth=json.loads(coverage.read_text())
    with sqlite3.connect('file:'+str((run/'topology.sqlite').resolve()).replace('\\','/')+'?mode=ro',uri=True) as db:
        assignments=dict(db.execute('SELECT observation_id,place_id FROM assignments'))
    by_frame={int(key.rsplit('-',1)[1]):value for key,value in assignments.items()}
    checks=[]
    for pair in truth['geometricRevisitPairs']:
        a,b=pair['earlierFrame'],pair['laterFrame']
        if a in by_frame and b in by_frame:checks.append({**pair,'sameAssignedPlace':by_frame[a] is not None and by_frame[a]==by_frame[b]})
    responses=[json.loads(p.read_text(encoding='utf8')) for p in (run/'requests').glob('*/response-*.json')]
    report={'usage':usage,'assignedObservations':len(assignments),'assignedPlaces':len(set(v for v in assignments.values() if v)),'unknownAssignments':sum(v is None for v in assignments.values()),'geometricProxyChecks':checks,'requestElapsedMs':[r['elapsedMs'] for r in responses],'roomAccuracyMeasured':False,'oldPlaceRecallBeyondCandidateBudgetMeasured':False,'eightHourMeasured':False,'estimatedEightHourAtFourObservationsPerCall':{'calls':720,'inputTokens':usage['inputTokens']/usage['calls']*720,'outputTokens':usage['outputTokens']/usage['calls']*720,'note':'Extrapolation from tiny selected sample, not a bill or throughput guarantee. One observation per call would require a different calibration.'}}
    with output.open('x',encoding='utf8') as stream:json.dump(report,stream,indent=2)
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('coverage',type=Path);p.add_argument('output',type=Path);a=p.parse_args();summarize(a.run,a.coverage,a.output)
