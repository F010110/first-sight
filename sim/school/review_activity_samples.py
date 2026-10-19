"""Evaluation-only paginated visual review; never marks labels as reviewed."""
import argparse
import html
import json
from pathlib import Path
from PIL import Image,ImageDraw

def review(sample, output, stride=10):
    if stride<1:raise ValueError('Stride must be positive')
    rows=[json.loads(line) for line in (sample/'observations.jsonl').read_text().splitlines()]
    episodes=json.loads((sample/'evaluation-only'/'episodes.json').read_text())
    output.mkdir(parents=True,exist_ok=False);pages=[];cards=[]
    for episode in episodes:
        selected=[r for r in rows if r['episodeId']==episode['id']]
        # Always include both endpoints, without claiming sparse review is exhaustive.
        selected=selected[::stride]+([selected[-1]] if selected and selected[-1] not in selected[::stride] else [])
        for start in range(0,len(selected),8):
            batch=selected[start:start+8];sheet=Image.new('RGB',(960,200*len(batch)), 'white');draw=ImageDraw.Draw(sheet)
            for i,row in enumerate(batch):
                for j,view in enumerate(('left','front','right')):
                    with Image.open(sample/row['cameras'][view]) as image:
                        image.thumbnail((320,170));sheet.paste(image,(j*320,i*200+30))
                draw.text((5,i*200+5),f"{row['id']}  activity={row['atMs']/1000:.1f}s source={row['sourceAtMs']/1000:.1f}s",fill='black')
                cards.append({'observationId':row['id'],'episodeId':episode['id'],'indoorOutdoor':'unreviewed','physicalPlace':None,'floor':None,'reviewStatus':'unreviewed'})
            name=f'sheet-{len(pages):04d}.jpg';sheet.save(output/name,quality=88)
            pages.append(f'<h2>{html.escape(episode["worldInstanceId"])} / {html.escape(episode["sourceTrajectory"])}</h2><p>{html.escape(episode["continuity"])}</p><a href="{name}"><img loading="lazy" width="960" src="{name}"></a>')
    (output/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Activity sample review</title><h1>Evaluation-only visual review</h1><p>Sparse contact sheets; not complete labels or human-reviewed truth. Left / front / right. Source and activity clocks differ.</p>'+''.join(pages),encoding='utf8')
    (output/'annotation-draft.json').write_text(json.dumps({'sampleId':sample.name,'stride':stride,'completeObservationCount':len(rows),'reviewed':False,'cards':cards},indent=2))
    print(f'{sample.name}: {len(rows)} observations; {len(cards)} visual cards; {len(pages)} sheets')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('sample',type=Path);p.add_argument('output',type=Path);p.add_argument('--stride',type=int,default=10);a=p.parse_args();review(a.sample,a.output,a.stride)
