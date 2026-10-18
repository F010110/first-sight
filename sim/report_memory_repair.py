"""Paired repair report: untouched answers retain original grades, not rejudged luck."""
import argparse
import json
from pathlib import Path

def load(p):return json.loads(p.read_text(encoding='utf8'))
def lines(p):return [json.loads(l) for l in p.read_text(encoding='utf8').splitlines() if l.strip()]
def report(base,bank,output):
    tasks={t['id']:t for t in load(bank/'evaluation-only/tasks.json')};groups=[]
    for mode in ('spatial-memory','memory-oracle'):
        original=base/mode;repair=base/(mode+'-repair-v1')
        if load(repair/'full/complete.json')['executions']!=90 or load(repair/'full-grading/complete.json')['grades']!=90:raise ValueError('Incomplete repair/grades')
        prior={r['id']:r for r in lines(original/'full/results.jsonl')};final={r['id']:r for r in lines(repair/'full/results.jsonl')}
        before={g['id']:g for g in lines(original/'full-grading/grades.jsonl')};new={g['id']:g for g in lines(repair/'full-grading/grades.jsonl')}
        if set(prior)!=set(final) or set(final)!=set(tasks):raise ValueError('Task sets changed')
        attempts=lines(repair/'attempts.jsonl');repaired={r['id'] for r in attempts if r['attempt']>0}
        selected=[{**(new[id] if id in repaired else before[id]),'gradeSource':'repair' if id in repaired else 'original'} for id in tasks]
        mean=lambda rows,key:sum(r[key] for r in rows)/len(rows)*100 if rows else None
        cards=lambda rows:{'taskSolution':mean(rows,'utility'),'longAndComparison':mean([r for r in rows if r['tier']=='long' or tasks[r['id']]['family']=='compare'],'utility'),'answerTrust':100-mean(rows,'harm')}
        groups.append({'mode':mode,'retriedTasks':len(repaired),'repairAttempts':sum(a['attempt']>0 for a in attempts),'before':cards(list(before.values())),'after':cards(selected),
                       'byTier':[{'tier':tier,**cards([g for g in selected if g['tier']==tier])} for tier in ('current','short','long')],
                       'remainingLosses':[{'id':g['id'],'question':tasks[g['id']]['question'],'utility':g['utility'],'semanticCredit':g['semanticCredit'],'harm':g['harm'],'gradeSource':g['gradeSource']} for g in selected if g['utility']<1],
                       'grades':selected,'repairUsage':load(repair/'repair-usage.json'),'gradingUsage':load(repair/'full-grading/usage.json')})
    with output.open('x',encoding='utf8') as f:json.dump({'interpretation':'Selective public-protocol repair diagnosis. Unchanged tasks retain original grades; latest retry always selected, never best of attempts. Not an independent fresh benchmark. Residual losses may include perception, evidence insufficiency or annotation issues, not only spatial algorithm errors.','groups':groups},f,ensure_ascii=False,indent=2)
    print(json.dumps([{k:v for k,v in g.items() if k in ('mode','retriedTasks','repairAttempts','before','after','remainingLosses')} for g in groups],ensure_ascii=True,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('base',type=Path);p.add_argument('bank',type=Path);p.add_argument('output',type=Path);a=p.parse_args();report(a.base,a.bank,a.output)
