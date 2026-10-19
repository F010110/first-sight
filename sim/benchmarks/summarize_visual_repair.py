"""Versioned multidimensional scorecard; no weighted pseudo-accuracy."""
import json,hashlib
from pathlib import Path

def main():
    datasets=[];hashes={}
    for name in ['val4','val5']:
        path=Path(f'docs/experiments/visual-repair-{name}-v1.json');r=json.loads(path.read_text());hashes[str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
        move=r['motionCounts']['straight-move'];turn=r['motionCounts']['turn'];oracle=r['conditions'][1]
        expected={'val4':{'segment-r1-5':'segment-r1-3','segment-r1-6':'segment-r1-2','segment-r1-7':'segment-r1-1'},'val5':{'segment-r1-5':'segment-r1-3','segment-r1-6':'segment-r1-2'}}[name]
        supported=[h for h in oracle['historicalHypotheses'] if h['status']=='supported']
        correct=sum(h['targetSegmentId']==expected.get(h['segmentId']) for h in supported)
        wrong=sum(h['targetSegmentId']!=expected.get(h['segmentId']) for h in supported)
        total=sum(move.values())
        datasets.append({'dataset':name,'movement':{'detected':move.get('movement-candidate',0),'total':total,'recall':move.get('movement-candidate',0)/total,'unknown':move.get('unknown',0),'falseRotationSkips':move.get('skipped-rotation',0),'turnFalseMovement':turn.get('movement-candidate',0),'turnTotal':sum(turn.values()),'staticFalseMovementRate':None},'automaticBoundaries':{'enabled':False,'expectedEvents':6 if name=='val4' else 5,'effectiveRecall':0,'note':'Rolled back; detection not repaired. Disabled is not a successful negative decision.'},'oracleHistoricalRecovery':{'correct':correct,'expected':len(expected),'recall':correct/len(expected),'wrongSupported':wrong,'conditionalOnReviewedBoundaries':True},'inheritedIdentityCoverage':r['coverage'],'legacySevereErrors':r['effectiveLegacy']['crossRegionFalseMerges'],'baselinePreservedExactly':r['baselinePreservedExactly'],'cachedOnlineMs':{'mean':r['online']['meanCachedUpdateMs'],'p95':r['online']['p95CachedUpdateMs'],'imageExtractionIncluded':False},'realDeviceLatencyMs':None,'historicalObjectRetrievalCoverage':r['historicalObjectRetrieval']['coverage']})
    output={'protocol':'visual-repair-multidimensional-v1','datasets':datasets,'reportHashes':hashes,'overallScalarScore':None,'note':'No overall accuracy: boundary availability, conditional historical recovery, inherited identity and latency measure different abilities. Correlated simulation recordings, not independent human or real-device validation.'}
    with Path('docs/experiments/visual-repair-scorecard-v1.json').open('x') as f:json.dump(output,f,indent=2)
    print(json.dumps(output,indent=2))

if __name__=='__main__':main()
