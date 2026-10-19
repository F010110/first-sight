"""Render source-aligned prediction sheets. No model calls or hidden truth labels."""
import argparse
import json
from pathlib import Path
from PIL import Image,ImageDraw

def render(source,report,output):
    output.mkdir(parents=True,exist_ok=False)
    rows=[json.loads(l) for l in (source/'observations.jsonl').read_text().splitlines()]
    result=json.loads(report.read_text(encoding='utf8')) if str(report)!='-' else {'observations':[{'id':r['id'],'assignment':None,'gate':{'reason':'source-unlabeled'}} for r in rows],'places':[]}
    pred={r['id']:r for r in result['observations']}
    ids=sorted({r['assignment']['placeId'] for r in result['observations'] if r['assignment'] and r['assignment']['placeId']})
    labels={pid:'P'+str(i+1) for i,pid in enumerate(ids)}
    for start in range(0,len(rows),10):
        sheet=Image.new('RGB',(480,150*len(rows[start:start+10])),'white');draw=ImageDraw.Draw(sheet)
        for offset,row in enumerate(rows[start:start+10]):
            record=pred[row['id']];assignment=record['assignment'];label=labels.get(assignment['placeId'],'unknown') if assignment else 'SKIP / unclassified'
            for col,view in enumerate(['front','left','right']):
                with Image.open(source/row['cameras'][view]) as original:
                    image=original.convert('RGB');image.thumbnail((160,120));sheet.paste(image,(col*160,offset*150))
            draw.text((2,offset*150+122),f"t={row['atMs']/1000:g}s frame={row['sourceFrameIndex']} {label} {record['gate']['reason']}",fill='black')
        sheet.save(output/f'sheet-{start//10:02d}.jpg')
    (output/'labels.json').write_text(json.dumps({'labels':labels,'places':result['places'],'note':'Predicted IDs only, not human room truth.'},ensure_ascii=False,indent=2),encoding='utf8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('report',type=Path);p.add_argument('output',type=Path);a=p.parse_args();render(a.source,a.report,a.output)
