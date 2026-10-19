"""Read-only v1 attribution against provisional labels, no model calls."""
import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from download_hssd import SCENES


def main():
    results={}
    for scene in SCENES:
        trial=Path('run/updating-context-v1')/('hssd-'+scene)
        if not trial.exists():results[scene]={'status':'capture-failed'};continue
        labelled=json.loads((Path('run/hssd-region-labels-v1')/scene/'labels.json').read_text(encoding='utf8'))
        labels={r['observationId']:r for r in labelled['labels']}
        manifest=json.loads((trial/'atlases/input-manifest.json').read_text(encoding='utf8'))
        report=json.loads((trial/'inference/report.json').read_text(encoding='utf8'))
        attempt=next(r['attempt'] for r in report['attempts'] if r['valid'])
        answer=json.loads(re.sub(r'^```(?:json)?\s*|\s*```$','',(trial/'inference'/f'attempt-{attempt}-answer.txt').read_text(encoding='utf8').strip()))
        predicted={}
        for i,r in enumerate(answer['regions']):
            for g in r['groupIds']:predicted[g]=('core',f'P{i+1}')
        for r in answer['boundaryGroups']:
            for g in r['groupIds']:predicted[g]=('boundary',None)
        for g in answer['uncertainGroupIds']:predicted[g]=('unknown',None)
        truth=sorted({r['regionIds'][0] for r in labels.values() if r['kind']=='core'}); preds=sorted({v[1] for v in predicted.values() if v[0]=='core'})
        weights=[[sum(labels[oid]['kind']=='core' and labels[oid]['regionIds'][0]==t for g,row in manifest['groups'].items() if predicted[g]==('core',p) for oid in row['observationIds']) for t in truth] for p in preds]
        @lru_cache(None)
        def align(i,mask):
            if i==len(preds):return (0,())
            value,path=align(i+1,mask);best=(value,(None,)+path)
            for j,t in enumerate(truth):
                if mask&(1<<j):continue
                value,path=align(i+1,mask|(1<<j)); candidate=(value+weights[i][j],(t,)+path)
                if candidate[0]>best[0]:best=candidate
            return best
        correct,path=align(0,0);mapping=dict(zip(preds,path)); groups=[];counts=Counter();rows=[];ceiling=0
        for g,row in manifest['groups'].items():
            dist=Counter(labels[oid]['kind']+':'+','.join(labels[oid]['regionIds']) for oid in row['observationIds']);core_dist=Counter(labels[oid]['regionIds'][0] for oid in row['observationIds'] if labels[oid]['kind']=='core')
            ceiling+=max(core_dist.values(),default=0)
            groups.append({'group':g,'observations':row['observationIds'],'representatives':row['selectedObservationIds'],'labelDistribution':dict(dist),'predictionKind':predicted[g][0],'predictionRegion':predicted[g][1],'mixedCoreRegions':len(core_dist)>1})
            for oid in row['observationIds']:
                lab=labels[oid];kind,p=predicted[g];status='label-unknown'
                if lab['kind']=='core':
                    status='correct' if kind=='core' and mapping.get(p)==lab['regionIds'][0] else ('core-as-'+kind if kind!='core' else 'wrong-identity')
                elif lab['kind']=='boundary':status='boundary-correct' if kind=='boundary' else 'boundary-as-'+kind
                counts[status]+=1;rows.append({'observationId':oid,'group':g,'labelKind':lab['kind'],'labelRegions':lab['regionIds'],'predictedKind':kind,'predictedRegion':p,'matchedLabelRegion':mapping.get(p),'result':status,'labelReason':lab['reason']})
        results[scene]={'status':'provisional-label-attribution-not-verified-truth','counts':dict(counts),'internalCorrect':correct,'internalTotal':sum(r['kind']=='core' for r in labels.values()),'localGroupMajorityCeiling':ceiling,'ceilingDefinition':'Optimistic core-only ceiling allowing each local group its own ideal truth identity; mixed groups impose loss even before VLM. Not a causal allocation or an accuracy score.','groups':groups,'observations':rows,'predictionRegionReasons':answer['regions'],'boundaryReasons':answer['boundaryGroups'],'uncertaintyReasons':answer['uncertaintyReasons'],'labelRegions':labelled['regions']}
        print(json.dumps({'scene':scene,'counts':dict(counts),'coreCeiling':ceiling,'mixedGroups':[g['group'] for g in groups if g['mixedCoreRegions']]}))
    Path('run/hssd-region-labels-v1/error-attribution.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')


if __name__=='__main__':main()
