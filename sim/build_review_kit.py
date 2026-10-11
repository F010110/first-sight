"""Freeze a balanced review inventory, not automatic activity-region truth.

Oracle pose/room fields are confined to this annotation tool. Image hashes and
event provenance let reviewers audit candidates; none enter recognition.
"""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('captures',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    index=json.loads((args.captures/'capture-index.json').read_text())
    datasets=[]
    pages=[]
    for job in index['jobs']:
        if job['status']!='recorded':continue
        base=args.captures/job['id']
        rows=[json.loads(x) for x in (base/'observations.jsonl').read_text().splitlines()]
        locations={}
        for row in rows[1:]:
            if not row['success']:raise ValueError('Failed action requires separate review')
            key=(row['x'],row['z'])
            locations.setdefault(key,[]).append(row)
        buckets={}
        for key,group in locations.items():
            turns=[row for row in group if row['action'] in ['RotateRight','RotateLeft']]
            if len(turns)>=3:buckets.setdefault(group[0]['room'],[]).append((key,group))
        selected=[]
        # Round-robin physical-room strata are only selection metadata, not
        # inferred region labels. Do not claim independent events from duplicates.
        for slot in range(12):
            for room in sorted(buckets):
                if slot<len(buckets[room]) and len(selected)<12:selected.append(buckets[room][slot])
        candidates=[]
        for n,(_,group) in enumerate(selected):
            turns=[r for r in group if r['action'] in ['RotateRight','RotateLeft']]
            first=turns[0]
            rotated=next((r for r in turns[1:] if r['yaw']!=first['yaw']),None)
            revisit=next((r for r in reversed(group) if r['tick']-first['tick']>=20),None)
            for kind,last in [('rotation',rotated),('revisit',revisit)]:
                if last is None:continue
                frames=[first['tick'],last['tick']]
                candidates.append({'id':f'{job["id"]}-footprint{n}-{kind}','kind':kind,'a':f'observation-{frames[0]}','b':f'observation-{frames[1]}','expected':'same','source':'audited-simulator-same-footprint-necessary-constraint','spatialRegionLabel':None,'reviewStatus':'pending','ticks':frames})
        transitions=[]
        for before,after in zip(rows,rows[1:]):
            if before['room']!=after['room']:
                transitions.append({'candidateTick':after['tick'],'reviewStatus':'pending','warning':'Room polygon change is a review candidate, not automatic activity boundary truth.'})
        hashes={}
        for name in ['manifest.json','observations.jsonl','windows.jsonl']:
            hashes[name]=hashlib.sha256((base/name).read_bytes()).hexdigest()
        frame_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((base/'frames').glob('*.jpg'))}
        datasets.append({'id':job['id'],'split':job['split'],'source':str(base),'hashes':hashes,'frameHashes':frame_hashes,'sameFootprintCandidates':candidates,'transitionCandidates':transitions,'regionLabelsStatus':'pending','selectedFootprints':len(selected)})
        blocks=[]
        for event in candidates:
            pictures=''.join(f'<figure><img loading="lazy" src="{html.escape(os.path.relpath(base/"frames"/f"{tick:04d}.jpg",args.output).replace(os.sep,"/"))}"><figcaption>tick {tick}</figcaption></figure>' for tick in event['ticks'])
            blocks.append(f'<section><h3>{html.escape(event["id"])}</h3>{pictures}</section>')
        # Full actual chronology is available, not only picked endpoint pairs.
        chronological=''.join(f'<figure><img loading="lazy" src="{html.escape(os.path.relpath(base/"frames"/f"{r["tick"]:04d}.jpg",args.output).replace(os.sep,"/"))}"><figcaption>tick {r["tick"]}: {html.escape(r["action"])} yaw={r["yaw"]} GT room={html.escape(r["room"])} (review only)</figcaption></figure>' for r in rows)
        page=f'{job["id"]}.html'
        (args.output/page).write_text('<!doctype html><meta charset="utf-8"><style>body{background:#222;color:white;font-family:sans-serif}figure{display:inline-block;width:300px}img{width:100%}section{border:1px solid #888}</style><h1>Review only — NOT recognition input</h1>'+''.join(blocks)+'<h2>Complete actual chronology</h2>'+chronological,encoding='utf8')
        pages.append(page)
    (args.output/'manifest.json').write_text(json.dumps({'protocol':'review-inventory-v1','frozenSelection':True,'reviewed':False,'note':'Necessary motion-fact candidates only; semantic boundaries and region identities pending. Same-house recordings correlated. Oracle labels isolated from inference.','datasets':datasets},indent=2),encoding='utf8')
    (args.output/'index.html').write_text('<!doctype html><meta charset="utf-8"><h1>Annotation review inventory</h1>'+''.join(f'<p><a href="{p}">{p}</a></p>' for p in pages),encoding='utf8')
    print(json.dumps({'datasets':len(datasets),'footprints':sum(d['selectedFootprints'] for d in datasets),'necessarySameCandidates':sum(len(d['sameFootprintCandidates']) for d in datasets),'boundaryCandidates':sum(len(d['transitionCandidates']) for d in datasets),'reviewed':False}))

if __name__=='__main__':main()
