"""Offline audit of frozen predictions, citations, oracle selection and tool traces."""
import argparse
import collections
import json
from pathlib import Path
from sim.spatial.salad_features import sha

def load(p):return json.loads(p.read_text(encoding='utf8'))
def lines(p):return [json.loads(l) for l in p.read_text(encoding='utf8').splitlines() if l.strip()]

def diagnose(root,bank):
    tasks={t['id']:t for t in load(bank/'evaluation-only/tasks.json')}
    output={'groups':{},'paired':[]}
    all_grades={};all_records={}
    for mode in ('spatial-memory','memory-oracle'):
        r=root/mode;predictions={p['id']:p for p in lines(r/'full/results.jsonl')};grades={g['id']:g for g in lines(r/'full-grading/grades.jsonl')}
        if set(predictions)!=set(tasks) or set(grades)!=set(tasks):raise ValueError('Incomplete task sets')
        all_grades[mode]=grades;all_records[mode]=predictions
        stats=collections.Counter();lost=[];searches=[]
        oracle=load(r/'oracle-evidence.json') if mode=='memory-oracle' else {}
        if oracle and sha(r/'oracle-evidence.json')!=load(r/'frozen.json')['oracleEvidenceSha256']:raise ValueError('Oracle selection changed')
        rows={o['id']:o for o in lines(r/'model-replay/observations.jsonl')}
        for id,t in tasks.items():
            p=predictions[id];g=grades[id];raw=p.get('result',{}).get('raw','');parsed={};malformed=False
            try:parsed=json.loads(raw)
            except (ValueError,TypeError):malformed=bool(raw)
            cited=set(parsed.get('historicalEvidenceIds',[]));inspected=set(p.get('inspectedIds',[]));expected=t['validEvidenceSets']
            stats['tasks']+=1;stats['utilityPointsLost']+=1-g['utility']
            if 'error' in p:category='execution-failure'
            elif malformed:category='malformed-answer-json'
            elif p.get('modelOutputRejected'):category='rejected-answer-citation'
            elif g['semanticCredit']<1:category='semantic-error-or-label-dispute'
            elif g['utility']<1 and parsed.get('abstained')!= (not t['answerable']):category='answer-abstention-flag-mismatch'
            elif g['utility']<1 and not any(set(es)<=cited for es in expected):category='missing-required-citation'
            elif g['utility']<1:category='other-scoring-loss'
            else:category='full-utility'
            stats[category]+=1
            if g['utility']<1 or g['harm']>0:
                lost.append({'id':id,'tier':t['memoryTier'],'question':t['question'],'feature':t['testedFeature'],'category':category,'utility':g['utility'],'semanticCredit':g['semanticCredit'],'harm':g['harm'],'expectedEvidence':expected,'inspectedIds':sorted(inspected),'citedIds':sorted(cited),'answer':parsed.get('answer',raw),'judgeReason':g.get('reason')})
            trace=load(r/'full'/f'{id}-{mode}-trace.json')
            if mode=='spatial-memory':
                ops=[e for e in trace if e.get('operation')=='SpatialRetriever.search'];searches.extend(ops)
                if any('afterMs' in e.get('translatedQuery',{}) and e.get('input',{}).get('query') for e in ops):stats['tasksWithPublicTimestampLookup']+=1
                if any(e.get('input',{}).get('placeId') is not None for e in ops):stats['tasksWithPlaceIdLookup']+=1
                if t['answerable'] and any(set(es)<=inspected|{t['currentObservationId']} for es in expected):stats['tasksReferenceAvailableInViewedInput']+=1
            else:
                selected=oracle[id];stats['oracleSelectionMatchesCanonical']+=int(selected==(expected[0] if t['answerable'] else []))
                if t['answerable'] and not set(selected)<=inspected:raise ValueError('Oracle reference not inspected')
                for oid in selected:
                    row=rows[oid]
                    if row['atMs']>=t['queryAtMs']:raise ValueError('Future oracle evidence')
                if t['answerable']:stats['oracleAnswerableReferencesInspected']+=1
        output['groups'][mode]={'counts':dict(stats),'lossAndHarmCases':lost,'searchCalls':len(searches)}
    for id,t in tasks.items():
        a=all_grades['spatial-memory'][id];o=all_grades['memory-oracle'][id]
        if a['utility']!=o['utility']:
            pa=all_records['spatial-memory'][id];po=all_records['memory-oracle'][id]
            output['paired'].append({'id':id,'tier':t['memoryTier'],'algorithmUtility':a['utility'],'oracleUtility':o['utility'],'algorithmSemantic':a['semanticCredit'],'oracleSemantic':o['semanticCredit'],'algorithmInspected':pa.get('inspectedIds',[]),'oracleInspected':po.get('inspectedIds',[]),'algorithmAdditionalInspected':sorted(set(pa.get('inspectedIds',[]))-set(po.get('inspectedIds',[])))})
    oracle=load(root/'memory-oracle/oracle-evidence.json');rows={r['id']:r for r in lines(root/'memory-oracle/model-replay/observations.jsonl')}
    unique={id for ids in oracle.values() for id in ids};images=0
    for id in unique:
        for view,path in rows[id]['cameras'].items():
            if sha(Path(path))!=rows[id]['sha256'][view]:raise ValueError('Oracle original image hash mismatch')
            images+=1
    wins=[p for p in output['paired'] if p['algorithmUtility']>p['oracleUtility']]
    output['verification']={'oracleUniqueObservations':len(unique),'oracleOriginalImageHashesVerified':images,'algorithmHigherUtilityTasks':len(wins),'algorithmHigherUtilityWithSameInspectedSet':sum(set(p['algorithmInspected'])==set(p['oracleInspected']) for p in wins),'note':'Canonical match and original-image hashes do not establish semantic sufficiency of the reference set.'}
    return output

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('bank',type=Path);p.add_argument('output',type=Path);a=p.parse_args();result=diagnose(a.root,a.bank)
    with a.output.open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({m:v['counts'] for m,v in result['groups'].items()},ensure_ascii=True,indent=2));print('paired differences',len(result['paired']))
