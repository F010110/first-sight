"""Independent pose-proxy retrieval check; not room recognition accuracy."""
import argparse
import json
from pathlib import Path
from sim.spatial.spatial_visual_features import descriptor

def distance(a,b):
    def directed(x,y):return sum(min(sum((v-w)**2 for v,w in zip(p,q))/len(p) for q in y) for p in x)/len(x)
    return (directed(a,b)+directed(b,a))/2

def evaluate(dataset,output):
    rows=[json.loads(line) for line in (dataset/'observations.jsonl').read_text().splitlines()]
    features={r['sourceFrameIndex']:[descriptor(str(dataset/r['cameras'][v])) for v in ['front','left','right']] for r in rows}
    pairs=json.loads((dataset/'evaluation-only'/'coverage.json').read_text())['geometricRevisitPairs']
    results=[]
    for pair in pairs:
        earlier,later=pair['earlierFrame'],pair['laterFrame']
        # Exclude the previous 30s: test older appearance rather than adjacent frames.
        ranked=sorted((distance(features[later],features[r['sourceFrameIndex']]),r['sourceFrameIndex']) for r in rows if r['atMs']<later*100-30000)
        rank=next((i+1 for i,(_,index) in enumerate(ranked) if index==earlier),None)
        results.append({**pair,'earlierFrameRank':rank,'top2':[{'frame':i,'distance':s} for s,i in ranked[:2]],'candidateCount':len(ranked)})
    report={'method':'rgb-layout-v1','pairs':results,'measured':'pose-proxy observation retrieval, not place identity','limitations':'Tiny single-route sample. No independent room labels, no cross-day/similar-room accuracy claim. Query features use RGB only; poses define evaluation pairs, not retrieval.'}
    with output.open('x') as stream:json.dump(report,stream,indent=2)
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('output',type=Path);a=p.parse_args();evaluate(a.dataset,a.output)
