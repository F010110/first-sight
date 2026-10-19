"""Read-only consequence scoring of frozen identity questions, NOT QA execution."""
import argparse
import json
import sqlite3
from pathlib import Path
from sim.spatial.salad_features import sha

def outcomes(expected_same, a, b):
    if a is None or b is None:return {'answer':'unknown','utility':0.,'harm':0.,'failure':'unassigned'}
    actual=a==b
    if actual==expected_same:return {'answer':actual,'utility':1.,'harm':0.,'failure':None}
    # This probe explicitly asks physical identity; false separation is wrong but
    # does not tell the user that evidence from another place belongs here.
    return {'answer':actual,'utility':0.,'harm':1. if actual else .25,'failure':'false-same' if actual else 'false-different'}

def score(probes_path, databases, output):
    probes=json.loads(probes_path.read_text(encoding='utf8'))
    if not probes or len({p['id'] for p in probes})!=len(probes):raise ValueError('Empty/duplicate probes')
    frozen_hash=sha(probes_path);assignments={};provenance=[]
    for trajectory,path in databases.items():
        db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
        try:assignments[trajectory]=dict(db.execute('SELECT observation_id,place_id FROM assignments'))
        finally:db.close()
        provenance.append({'trajectory':trajectory,'path':str(path),'databaseSha256':sha(path),'walSha256':sha(Path(str(path)+'-wal')) if Path(str(path)+'-wal').exists() else None})
    records=[]
    for p in probes:
        if type(p['same']) is not bool or p['a']==p['b']:raise ValueError('Invalid probe')
        mapping=assignments[p['trajectory']]
        source_id=lambda index:f"AbandonedSchool-{p['trajectory']}-{index:06d}"
        a,b=mapping.get(source_id(p['aSourceFrame'])),mapping.get(source_id(p['bSourceFrame']))
        records.append({**p,'aPlace':a,'bPlace':b,**outcomes(p['same'],a,b)})
    # Equal source-route weights; a route with more selected pairs cannot dominate.
    trajectories=sorted({p['trajectory'] for p in probes})
    mean=lambda xs:sum(xs)/len(xs)
    utility=100*mean([mean([r['utility'] for r in records if r['trajectory']==t]) for t in trajectories])
    trust=100*mean([mean([1-r['harm'] for r in records if r['trajectory']==t]) for t in trajectories])
    report={'status':'provisional-assistant-labelled-development-probes','scope':'Frozen 13-question physical-identity database readout only. Not end-to-end QA, full sample scoring, room accuracy or independent generalization.','probeScores':{'identityQuestionCompletion':round(utility,2),'identityAnswerTrust':round(trust,2)},'finalSystemScores':None,'probeCount':len(records),'sourceRoutes':len(trajectories),'labelsSha256':frozen_hash,'databases':provenance,'questions':records,'policy':{'utility':'correct=1, wrong/unknown=0; route-macro-average','harm':'wrong same-place assertion=1; wrong separation=.25; explicit unknown/correct=0; risk-specific probe policy, not a universal merge penalty'},'paidModelCalls':0}
    with output.open('x',encoding='utf8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in ('questions','databases')},ensure_ascii=True));return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('probes',type=Path);p.add_argument('output',type=Path);p.add_argument('--database',action='append',required=True,help='P0000=path/to/topology.sqlite');a=p.parse_args();score(a.probes,{k:Path(v) for k,v in (item.split('=',1) for item in a.database)},a.output)
