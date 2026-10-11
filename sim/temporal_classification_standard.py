"""Official image-label grouping / online old-new classification standard.

Same-label fragmentation is reported, not a safety veto. Labels are scoring
only. Decisions are evaluated at arrival, never reconstructed from final state.
"""
from collections import defaultdict

def rate(n,d):return n/d if d else None

def score(observations,snapshots,labels):
    ids=[o['id'] for o in observations]
    if not ids or len(set(ids))!=len(ids) or len(snapshots)!=len(ids):raise ValueError('Invalid sequence inventory')
    if set(labels)!=set(ids) or any(v is not None and (not isinstance(v,str) or not v) for v in labels.values()):raise ValueError('Require explicit reviewed label or excluded null for every image')
    for i,(o,s) in enumerate(zip(observations,snapshots)):
        if s['observationId']!=o['id'] or s['atMs']!=o['atMs'] or set(s['assignments'])!=set(ids[:i+1]):raise ValueError('Missing/reordered/future prefix')
        if i and o['atMs']<=observations[i-1]['atMs']:raise ValueError('Unordered timestamp')
        if any(g is not None and (not isinstance(g,str) or not g) for g in s['assignments'].values()):raise ValueError('Invalid group ID')
    final=snapshots[-1]['assignments'];groups=defaultdict(list);regions=defaultdict(list)
    for id in ids:
        if labels[id] is not None:
            regions[labels[id]].append(id)
            if final[id] is not None:groups[final[id]].append(id)
    mixed={g:members for g,members in groups.items() if len({labels[id] for id in members})>1}
    different=same=merged=aggregated=unresolvedPairs=0
    reviewed=[id for id in ids if labels[id] is not None]
    for i,a in enumerate(reviewed):
        for b in reviewed[i+1:]:
            equal=labels[a]==labels[b];same+=equal;different+=not equal
            if final[a] is None or final[b] is None:unresolvedPairs+=1;continue
            together=final[a]==final[b];merged+=together and not equal;aggregated+=together and equal
    regionRows=[{'label':label,'images':len(members),'assigned':sum(final[id] is not None for id in members),'groupCount':len({final[id] for id in members if final[id] is not None})} for label,members in regions.items()]
    counters={'old':{'total':0,'correct':0,'wrongOld':0,'duplicateNew':0,'unknown':0,'unreviewedTarget':0},'new':{'total':0,'correct':0,'wrongOld':0,'unknown':0,'unreviewedTarget':0}}
    events=[];repairs=harmfulChanges=0
    previous={}
    for o,s in zip(observations,snapshots):
        id=o['id'];label=labels[id];current=s['assignments']
        if label is not None:
            # Existing group means an earlier same-label observation is assigned.
            existing=any(labels[p]==label and g is not None for p,g in previous.items())
            scenario='old' if existing else 'new';counts=counters[scenario];counts['total']+=1;chosen=current[id]
            if chosen is None:result='unknown'
            else:
                # Historical members at CURRENT prefix support ID-renaming,
                # but prior assignment is required to count as an old group.
                historical=[p for p,g in previous.items() if g is not None and current[p]==chosen]
                directOld=chosen in {g for g in previous.values() if g is not None}
                if directOld:historical=[p for p,g in previous.items() if g==chosen]
                priorLabels={labels[p] for p in historical if labels[p] is not None}
                selectedLabels={labels[p] for p,g in current.items() if g==chosen and labels[p] is not None}
                if historical or directOld:
                    if any(other!=label for other in priorLabels|selectedLabels):result='wrongOld'
                    elif not priorLabels or any(labels[p] is None for p in historical):result='unreviewedTarget'
                    elif existing:result='correct'
                    else:result='wrongOld'
                else:
                    if selectedLabels!={label}:result='wrongOld'
                    else:result='duplicateNew' if existing else 'correct'
            counts[result]+=1;events.append({'observationId':id,'atMs':o['atMs'],'label':label,'scenario':scenario,'result':result,'groupId':chosen})
        # Only correctness changes of already decided reviewed pairs are repair/regression.
        priorIds=[p for p in previous if labels[p] is not None]
        for i,a in enumerate(priorIds):
            for b in priorIds[i+1:]:
                if previous[a] is None or previous[b] is None or current[a] is None or current[b] is None:continue
                expected=labels[a]==labels[b]
                was=(previous[a]==previous[b])==expected;now=(current[a]==current[b])==expected
                repairs+=not was and now;harmfulChanges+=was and not now
        previous=current
    for counts in counters.values():
        counts['accuracy']=rate(counts['correct'],counts['total']);counts['uncertaintyRate']=rate(counts['unknown'],counts['total'])
    assigned=sum(final[id] is not None for id in reviewed)
    failures=[]
    if mixed:failures.append('不同人工区域被混入同组')
    if sum(c['wrongOld'] for c in counters.values()):failures.append('新图错归其他区域旧组')
    # No undocumented numeric tolerance. Missing coverage/novel events preclude acceptance.
    blockers=[]
    if len(reviewed)!=len(ids):blockers.append('存在未审核图像')
    if assigned!=len(reviewed):blockers.append('存在未归类图像')
    if not counters['old']['total'] or not counters['new']['total']:blockers.append('旧组/新组场景不完整')
    if any(c['unknown'] or c['unreviewedTarget'] for c in counters.values()):blockers.append('归类未确定或目标组标签不完整')
    return {'protocol':'temporal-image-classification-standard-v1','grouping':{'mixedGroupCount':len(mixed),'mixedGroups':mixed,'crossRegionMergeRate':rate(merged,different),'sameRegionAggregationRate':rate(aggregated,same),'unassignedRate':rate(len(reviewed)-assigned,len(reviewed)),'reviewedImages':len(reviewed),'excludedImages':len(ids)-len(reviewed),'counts':{'differentPairs':different,'mergedDifferentPairs':merged,'samePairs':same,'aggregatedSamePairs':aggregated,'unresolvedPairs':unresolvedPairs},'regions':regionRows},'classification':counters,'auxiliaryRevision':{'repairs':repairs,'harmfulChanges':harmfulChanges},'events':events,'verdict':'不符合' if failures else '证据不足' if blockers else '符合当前标注样本','failures':failures,'blockers':blockers,'note':'Fragmentation/duplicate new groups are errors allowed by the standard and reported, not alone a safety veto. A clean labelled sample is not independent held-out reliability certification.'}
