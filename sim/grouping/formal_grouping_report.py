"""Assess executed prefixes against the official per-image label standard."""
import argparse,json
from pathlib import Path
from sim.grouping.temporal_classification_standard import score

def main():
    p=argparse.ArgumentParser();p.add_argument('prefixReport',type=Path);p.add_argument('reviewedLabels',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    read=lambda p:json.loads(p.read_text(encoding='utf8'))
    raw=read(a.prefixReport);review=read(a.reviewedLabels);snapshots=[];observations=[];seen=set()
    for row in raw['online']['snapshots']:
        fresh=[id for id in row['assignments'] if id not in seen]
        if len(fresh)!=1:raise ValueError('Require exactly one arriving observation per prefix')
        id=fresh[0];seen.add(id);observations.append({'id':id,'atMs':row['atMs']});snapshots.append({'observationId':id,**row})
    labels={id:None for id in seen}
    for row in review['labels']:
        if row['observationId'] not in labels:raise ValueError('Unknown reviewed image')
        if row['kind']=='core' and len(row['regions'])==1:labels[row['observationId']]=row['regions'][0]
    result=score(observations,snapshots,labels)
    result['evidence']={'predictions':str(a.prefixReport),'labels':str(a.reviewedLabels),'reviewer':review['reviewer'],'blind':review['blind'],'type':'existing executed online output; partial AI-reviewed development labels, not fresh raw-image replay'}
    with a.output.open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({key:result[key] for key in ['grouping','classification','verdict','failures','blockers']},ensure_ascii=True,indent=2))

if __name__=='__main__':main()
