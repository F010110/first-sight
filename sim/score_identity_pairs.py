"""Evaluator-only visual pair checks; no labels are sent to recognition."""
import argparse
import json
import sqlite3
from pathlib import Path

def score(database, labels, output):
    pairs=json.loads(labels.read_text(encoding='utf8'))['pairs']
    if not pairs or len(pairs)>200:raise ValueError('Pair budget required')
    db=sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)
    try:assignments=dict(db.execute('SELECT observation_id,place_id FROM assignments'))
    finally:db.close()
    result=[]
    seen=set()
    for pair in pairs:
        key=tuple(sorted((pair['a'],pair['b'])))
        if type(pair.get('same')) is not bool or pair['a']==pair['b'] or key in seen:raise ValueError('Invalid or duplicate pair labels')
        seen.add(key)
        a,b=assignments.get(pair['a']),assignments.get(pair['b']);known=a is not None and b is not None
        same=a==b if known else None
        result.append({**pair,'aPlace':a,'bPlace':b,'covered':known,'predictedSame':same,'passed':known and same==pair['same']})
    report={'pairs':result,'passed':sum(r['passed'] for r in result),'total':len(result),'unknownOrUnassigned':sum(not r['covered'] for r in result),'falseSplits':sum(r['covered'] and r['same'] and not r['predictedSame'] for r in result),'falseMerges':sum(r['covered'] and not r['same'] and r['predictedSame'] for r in result),'note':'Small visually reviewed pair set, not independent room accuracy; missing/unknown never counted as success. An AI assistant reviewed images; not external human ground truth.'}
    with output.open('x',encoding='utf8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k!='pairs'}));return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('database',type=Path);p.add_argument('labels',type=Path);p.add_argument('output',type=Path);a=p.parse_args();score(a.database,a.labels,a.output)
