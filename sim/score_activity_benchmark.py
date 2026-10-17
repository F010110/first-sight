"""Three user-facing outcome cards. Topology IDs/coverage never enter the score.
Judgments are independent, answer-hash-bound grading, not model self-evaluation.
"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

WEIGHTS={'recall':.2,'last_seen':.2,'compare':.15,'sequence':.15,'state':.15,'unknown':.15}
CHALLENGES=('long_gap','similar_places','observed_change')

def answer_hash(prediction):
    payload={k:prediction[k] for k in ('answer','abstained','citations')}
    return hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def unique(rows, key='id'):
    result={r[key]:r for r in rows}
    if len(result)!=len(rows):raise ValueError('Duplicate records')
    return result

def evaluate(corpus, predictions, judgments, receipts):
    tasks=unique(corpus['tasks']);samples=unique(corpus['samples']);observations=unique(corpus['observations'])
    pred=unique(predictions);grades=unique(judgments);traces=unique(receipts)
    if set(pred)-set(tasks) or set(grades)-set(pred) or set(traces)-set(pred):raise ValueError('Unknown prediction/grading/receipt ID')
    records=[];unready=[]
    for sample in samples.values():
        selected=[t for t in tasks.values() if t['sampleId']==sample['id']];counts=Counter(t['family'] for t in selected)
        if not sample.get('scoreEligible') or sample.get('annotationStatus')!='independently-reviewed':unready.append(sample['id']+':unreviewed')
        for family in WEIGHTS:
            if counts[family]<2:unready.append(sample['id']+':missing-task-quota:'+family)
            if family!='unknown' and not any(t['family']==family and t['answerable'] for t in selected):unready.append(sample['id']+':missing-answerable:'+family)
    for task in tasks.values():
        if task['sampleId'] not in samples or task['family'] not in WEIGHTS or type(task['answerable']) is not bool:raise ValueError('Invalid task scope/family')
        accepted=task.get('validEvidenceSets',[])
        if task['answerable'] and not accepted:raise ValueError('Answerable task needs observed reference evidence')
        if any(not group or any(c not in observations or observations[c]['atMs']>=task['queryAtMs'] or observations[c]['sampleId']!=task['sampleId'] for c in group) for group in accepted):raise ValueError('Invalid/future reference evidence')
        p=pred.get(task['id']);credit=0.;harm=0.;evidence_ok=False
        if p is not None:
            if type(p.get('abstained')) is not bool or not isinstance(p.get('answer'),str) or not isinstance(p.get('citations'),list) or len(p['citations'])!=len(set(p['citations'])):raise ValueError('Invalid prediction schema')
            grade=grades.get(task['id']);receipt=traces.get(task['id']);digest=answer_hash(p)
            if grade is None or grade.get('answerSha256')!=digest:raise ValueError('Missing/mismatched independent answer grading')
            if isinstance(grade.get('credit'),bool) or isinstance(grade.get('harm'),bool) or grade.get('credit') not in (0,.5,1) or grade.get('harm') not in (0,.25,1):raise ValueError('Unsupported grading levels')
            if not grade.get('reviewed') or grade.get('judgeType') not in ('human-adjudicated','human-reviewed-llm','structured-exact'):unready.append(task['id']+':unreviewed-grading')
            if receipt is not None and receipt.get('answerSha256')!=digest:raise ValueError('Execution receipt bound to different answer')
            inspected=set(receipt.get('inspectedIds',[])) if receipt else set()
            invalid=any(c not in observations or c not in inspected or observations[c]['atMs']>=task['queryAtMs'] or observations[c]['sampleId']!=task['sampleId'] for c in p['citations'])
            evidence_ok=not invalid and any(set(group)<=set(p['citations']) for group in accepted)
            wrong_context=bool(set(p['citations'])&set(task.get('forbiddenEvidenceIds',[])))
            harm=max(float(grade['harm']),1. if invalid or wrong_context or (not task['answerable'] and not p['abstained']) else 0.)
            if not task['answerable']:
                credit=1. if p['abstained'] and grade['credit']==1 and harm==0 else 0.
            elif not p['abstained'] and evidence_ok:
                credit=float(grade['credit']) if harm<1 else 0.
        records.append({'id':task['id'],'sampleId':task['sampleId'],'family':task['family'],'challenges':task.get('challenges',[]),'utility':credit,'harm':harm,'evidenceAccepted':evidence_ok,'predictionMissing':p is None})
    mean=lambda values:sum(values)/len(values) if values else 0.
    challenge_missing=[c for c in CHALLENGES if not any(c in t.get('challenges',[]) and t['answerable'] for t in tasks.values())]
    utility=[];trust=[]
    for sample in samples:
        rows=[r for r in records if r['sampleId']==sample]
        utility.append(sum(WEIGHTS[f]*mean([r['utility'] for r in rows if r['family']==f]) for f in WEIGHTS))
        trust.append(sum(WEIGHTS[f]*mean([1-r['harm'] for r in rows if r['family']==f]) for f in WEIGHTS))
    complexity=[mean([mean([r['utility'] for r in records if r['sampleId']==s and c in r['challenges']]) for s in samples if any(r['sampleId']==s and c in r['challenges'] for r in records)]) for c in CHALLENGES]
    if not samples:unready.append('no-samples')
    cards={'实际问题解决':round(100*mean(utility),2),'长程与干扰':round(100*mean(complexity),2),'回答可信':round(100*mean(trust),2)}
    if challenge_missing:cards['长程与干扰']=None
    return {'policyVersion':'activity-outcomes-v1','status':'not-ready' if unready else 'scorer-fixture-not-system-result' if corpus.get('kind')=='scorer-fixture' else 'partially-measured' if challenge_missing else 'scored','scores':{k:None for k in cards} if unready else cards,'samples':len(samples),'questions':len(tasks),'diagnostics':{'notReadyReasons':sorted(set(unready)),'unmeasuredChallenges':challenge_missing,'questions':records},'note':'No single aggregate. No topology/coverage term. Grading validity depends on independent annotation and trusted execution receipts; fixture scores are not system accuracy.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('corpus',type=Path);p.add_argument('predictions',type=Path);p.add_argument('judgments',type=Path);p.add_argument('receipts',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    load=lambda path:json.loads(path.read_text(encoding='utf8'))
    report=evaluate(load(a.corpus),load(a.predictions),load(a.judgments),load(a.receipts))
    with a.output.open('x',encoding='utf8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k!='diagnostics'},ensure_ascii=True))
