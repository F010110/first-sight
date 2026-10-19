"""Fresh paired protocol-v2 report; attribution flags are review candidates."""
import argparse
import json
from pathlib import Path

def load(p):return json.loads(p.read_text(encoding='utf8'))
def lines(p):return [json.loads(l) for l in p.read_text(encoding='utf8').splitlines() if l.strip()]
def report(base,bank,output,version='v3'):
    tasks={t['id']:t for t in load(bank/'evaluation-only/tasks.json')};groups={}
    for mode in ('spatial-memory','memory-oracle'):
        root=base/(mode+'-runtime-fixed-v4' if version=='runtime-fixed-v4' else mode+'-provenance-'+version)
        if load(root/'full/complete.json')['executions']!=90 or load(root/'full-grading/complete.json')['grades']!=90:raise ValueError('Incomplete evaluation')
        predictions={r['id']:r for r in lines(root/'full/results.jsonl')};grades={g['id']:g for g in lines(root/'full-grading/grades.jsonl')}
        if set(predictions)!=set(tasks) or set(grades)!=set(tasks):raise ValueError('Task mismatch')
        last={a['id']:a for a in lines(root/'full/attempts.jsonl')}
        groups[mode]={'scorecard':load(root/'full-grading/scorecard.json'),'predictions':predictions,'grades':grades,'finalProtocolFailures':[id for id,a in last.items() if a['reasons']],'attempts':len(lines(root/'full/attempts.jsonl'))}
    failures=[]
    for id,t in tasks.items():
        algorithm=groups['spatial-memory'];oracle=groups['memory-oracle'];a=algorithm['grades'][id];o=oracle['grades'][id]
        if a['utility']==1 and o['utility']==1:continue
        actual=set(algorithm['predictions'][id].get('inspectedIds',[]));available=any(set(e)<=actual for e in t['validEvidenceSets'])
        if id in algorithm['finalProtocolFailures']:reason='remaining-protocol-or-execution-failure'
        elif t['testedFeature']=='differentPhysicalLevel':reason='review-insufficient-vertical-transition-evidence'
        elif t['testedFeature']=='regionKind' and (a['semanticCredit']==.5 or o['semanticCredit']==.5):reason='review-region-label-and-acceptable-paraphrases'
        elif not t['answerable']:reason='refusal-answer-or-scoring-review-not-spatial-retrieval'
        elif o['utility']==1 and a['utility']<1 and not available:reason='candidate-spatial-retrieval-failure-needs-evidence-review'
        elif available and a['utility']<1:reason='answer-reasoning-or-grading-review-not-proven-spatial-memory-error'
        else:reason='review-oracle-and-evidence-sufficiency'
        failures.append({'id':id,'question':t['question'],'algorithmUtility':a['utility'],'oracleUtility':o['utility'],'algorithmHasCanonicalEvidence':available,'attributionCandidate':reason})
    result={'interpretation':f'Fresh matched full-task protocol-{version} development evaluation, not independent human review or deployment certification.',
            'groups':{mode:{k:v for k,v in group.items() if k not in ('predictions','grades')} for mode,group in groups.items()},'failuresForReview':failures,
            'deployment':'Not approved for unattended production use: cross-floor/revisit/generalization/state-change acceptance incomplete.'}
    with output.open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=True,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('base',type=Path);p.add_argument('bank',type=Path);p.add_argument('output',type=Path);p.add_argument('--version',choices=['v2','v3','runtime-fixed-v4'],default='runtime-fixed-v4');a=p.parse_args();report(a.base,a.bank,a.output,a.version)
