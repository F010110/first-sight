"""Review repair events using held-separate labels; never feeds inference."""
import argparse,json
from pathlib import Path
from temporal_classification_standard import score

def main():
    p=argparse.ArgumentParser();p.add_argument('original',type=Path);p.add_argument('trial',type=Path);p.add_argument('labels',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    read=lambda p:json.loads(p.read_text(encoding='utf8'))
    original,trial,review=map(read,[a.original,a.trial,a.labels]);snapshots=original['online']['snapshots'];ids=list(snapshots[-1]['assignments']);labels={id:None for id in ids}
    for row in review['labels']:
        if row['kind']=='core' and len(row['regions'])==1:labels[row['observationId']]=row['regions'][0]
    arrivals={};obs=[];before=[];after=[]
    for source,repaired in zip(snapshots,trial['online']['snapshots']):
        new=[id for id in source['assignments'] if id not in arrivals]
        if len(new)!=1 or source['atMs']!=repaired['atMs'] or set(source['assignments'])!=set(repaired['assignments']):raise ValueError('Non-comparable repair prefixes')
        id=new[0];arrivals[id]=source['atMs'];obs.append({'id':id,'atMs':source['atMs']});before.append({'observationId':id,**source});after.append({'observationId':id,**repaired})
    seen=set();cases=[]
    for i,event in enumerate(trial['repairs']):
        for proposal in event['proposals']:
            if proposal['id'] in seen:continue
            seen.add(proposal['id'])
            target=next(g for g in original['groupingHistory'][i]['groups'] if g['id']==proposal['targetGroupId'])
            movedLabels={labels[id] for id in proposal['observationIds']};targetLabels={labels[id] for id in target['observationIds']}
            knownMoved=movedLabels-{None};knownTarget=targetLabels-{None}
            if knownMoved and knownTarget and (len(knownMoved|knownTarget)>1):status='wrong'
            elif None in movedLabels|targetLabels or not knownMoved:status='unreviewed'
            else:status='correct'
            source=snapshots[i]['assignments'];repaired=trial['online']['snapshots'][i]['assignments'];removed=introduced=0
            eligible=[id for id in source if labels[id] is not None]
            for j,x in enumerate(eligible):
                for y in eligible[j+1:]:
                    if labels[x]==labels[y]:continue
                    old=source[x]==source[y];new=repaired[x]==repaired[y];removed+=old and not new;introduced+=not old and new
            cases.append({'proposal':proposal,'firstAvailableAtMs':event['atMs'],'review':status,'repairDelayMs':{id:event['atMs']-arrivals[id] for id in proposal['observationIds']},'wrongMergePairsRemovedAtThisPrefix':removed,'wrongMergePairsIntroducedAtThisPrefix':introduced})
    beforeScore,afterScore=score(obs,before,labels),score(obs,after,labels)
    result={'protocol':'retrospective-repair-review-v1','cases':cases,'correctRepairs':sum(c['review']=='correct' for c in cases),'wrongRepairs':sum(c['review']=='wrong' for c in cases),'unreviewedRepairs':sum(c['review']=='unreviewed' for c in cases),'finalGroupingBefore':beforeScore['grouping'],'finalGroupingAfter':afterScore['grouping'],'firstArrivalAssignmentsUnchanged':all(x['assignments'][o['id']]==y['assignments'][o['id']] for o,x,y in zip(obs,before,after)),'verdictAfter':afterScore['verdict'],'note':'Developer AI-reviewed sample; no independent blind validation. Pair changes at a prefix are combined repair effects, not additive per-proposal attribution. First-arrival mistakes are not erased.'}
    with a.output.open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:result[k] for k in ['correctRepairs','wrongRepairs','unreviewedRepairs','firstArrivalAssignmentsUnchanged','verdictAfter']},ensure_ascii=True))

if __name__=='__main__':main()
