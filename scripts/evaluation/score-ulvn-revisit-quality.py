"""Post-hoc scoring against frozen accepted reference; never inference input."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def score(frames,queries,normalize):
    labels=[normalize(f['annotation']['placeId']) for f in frames]
    visits=[];membership=[]
    for index,label in enumerate(labels):
        if not visits or visits[-1]['label']!=label:
            visits.append({'visit':len(visits),'label':label,'firstOrdinal':index+1,'lastOrdinal':index+1})
        visits[-1]['lastOrdinal']=index+1;membership.append(len(visits)-1)
    by_ordinal={r['ordinal']:r for r in queries}
    pairs=[];observations=[];events={}
    for ordinal in range(1,len(frames)+1):
        query=by_ordinal[ordinal]
        eligible=min(((ordinal-1)//20)*20,max(0,ordinal-31))
        targets=[i+1 for i in range(eligible) if labels[i]==labels[ordinal-1] and membership[i]!=membership[ordinal-1]]
        accepted=sorted(set(c['historicalOrdinal'] for c in query['candidates'] if c['supported']))
        correct=[h for h in accepted if labels[h-1]==labels[ordinal-1]]
        revisit_correct=[h for h in accepted if h in targets]
        for h in accepted:
            a,b=frames[ordinal-1],frames[h-1]
            pairs.append({'current':ordinal,'historical':h,'currentLabel':labels[ordinal-1],'historicalLabel':labels[h-1],
                          'referenceCorrect':h in correct,'previousVisitCorrect':h in revisit_correct,
                          'sameVisit':membership[h-1]==membership[ordinal-1],
                          'xyDistance':math.dist(a['position'][:2],b['position'][:2]),
                          'heightDifference':abs(a['position'][2]-b['position'][2])})
        observations.append({'ordinal':ordinal,'label':labels[ordinal-1],'visit':membership[ordinal-1],
                             'revisitPositive':bool(targets),'eligibleTargetCount':len(targets),'accepted':accepted,
                             'regionCorrect':correct,'revisitCorrect':revisit_correct,'budgetExhausted':query.get('budgetExhausted',False)})
        if targets:
            event=events.setdefault(membership[ordinal-1],{**visits[membership[ordinal-1]],'eligibleObservations':[],'hitObservations':[]})
            event['eligibleObservations'].append(ordinal)
            if revisit_correct:event['hitObservations'].append(ordinal)
    def fraction(a,b):return {'numerator':a,'denominator':b,'value':a/b if b else None}
    positives=[r for r in observations if r['revisitPositive']]
    emitted=[r for r in observations if r['accepted']]
    emitted_positive=[r for r in positives if r['accepted']]
    return {'metrics':{
        'historicalPairPrecision':fraction(sum(p['referenceCorrect'] for p in pairs),len(pairs)),
        'queryRegionHitPrecision':fraction(sum(bool(r['regionCorrect']) for r in emitted),len(emitted)),
        'queryAllCandidatesCorrectPrecision':fraction(sum(len(r['regionCorrect'])==len(r['accepted']) for r in emitted),len(emitted)),
        'revisitObservationRecall':fraction(sum(bool(r['revisitCorrect']) for r in positives),len(positives)),
        'revisitEmittedQueryPrecision':fraction(sum(bool(r['revisitCorrect']) for r in emitted_positive),len(emitted_positive)),
        'revisitEventRecall':fraction(sum(bool(e['hitObservations']) for e in events.values()),len(events)),
        'positiveBudgetExhaustedWithoutHit':sum(r['budgetExhausted'] and not r['revisitCorrect'] for r in positives)},
        'pairs':pairs,'observations':observations,'events':list(events.values()),'visits':visits}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    root=Path(__file__).resolve().parents[2];reference=root/'run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json'
    frames=json.loads(reference.read_text(encoding='utf-8'))['frames']
    source=args.run/'queries.jsonl';queries=[json.loads(s) for s in source.read_text().splitlines()]
    if sorted(r['ordinal'] for r in queries)!=list(range(1,814)) or len(frames)!=813:raise ValueError('Require all 813 queries, exactly once')
    station={'subway-platform','subway-concourse','subway-exit'}
    canonical=score(frames,queries,lambda label:'subway-station-interior' if label in station else label)
    strict=score(frames,queries,lambda label:label)
    physical=[]
    for radius in [100,200,400]:
        hits=0;positive=0;emitted=0;pair_hits=0;pair_count=0;misses=[]
        for query in queries:
            ordinal=query['ordinal'];current=frames[ordinal-1]['position']
            eligible=min(((ordinal-1)//20)*20,max(0,ordinal-31))
            targets={i+1 for i in range(eligible) if math.dist(current[:2],frames[i]['position'][:2])<=radius and abs(current[2]-frames[i]['position'][2])<=48}
            accepted=set(c['historicalOrdinal'] for c in query['candidates'] if c['supported'])
            good=accepted&targets;hits+=bool(good);positive+=bool(targets);emitted+=bool(accepted)
            pair_hits+=len(good);pair_count+=len(accepted)
            if targets and not good:misses.append({'ordinal':ordinal,'budgetExhausted':query.get('budgetExhausted',False),'accepted':sorted(accepted),'eligibleTargets':sorted(targets)})
        physical.append({'xyRadiusSourceUnits':radius,'maxHeightDifference':48,'trueHitQueries':hits,'emittedQueries':emitted,'positiveQueries':positive,
                         'queryPrecision':hits/emitted if emitted else None,'queryRecall':hits/positive if positive else None,
                         'truePairs':pair_hits,'emittedPairs':pair_count,'pairPrecision':pair_hits/pair_count if pair_count else None,
                         'misses':misses})
    report={'referenceSHA256':hashlib.sha256(reference.read_bytes()).hexdigest(),'queriesSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'referenceAuthority':'Previously user-accepted reference, not independently reviewed new gold; segmentation agreement is not complete visual identity truth.',
            'scope':'No fresh GPU/VLM inference; budget-exhausted misses retained. Same-reference-region correspondence precision and previous-visit recall are distinct metrics.',
            'normalization':'Only the three station interior reference labels coalesce, per prior approved granularity. Other labels and boundaries unchanged.',
            'canonical':canonical,'strictOriginalLabelMetrics':strict['metrics'],
            'physicalCorrespondence':physical}
    args.output.mkdir(parents=True,exist_ok=False)
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    mismatches=[p for p in canonical['pairs'] if not p['referenceCorrect']]
    (args.output/'reference-mismatches.json').write_text(json.dumps(mismatches,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(canonical['metrics'],indent=2));print('events',json.dumps(canonical['events'],ensure_ascii=False));print('mismatches',len(mismatches),json.dumps(mismatches,ensure_ascii=False))
    print('physical',json.dumps([{k:v for k,v in row.items() if k!='misses'} for row in physical],indent=2))


if __name__=='__main__':main()
